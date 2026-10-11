package fr.kiza.basemod.menu;

import fr.kiza.basemod.render.NativeFrames;
import fr.kiza.basemod.render.StreamingTexture;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.Map;
import java.util.concurrent.ConcurrentSkipListMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import javax.imageio.ImageIO;

/**
 * Plays a run of separately encoded frames -- a prepared video, a GIF -- on
 * the menu's clock, into one texture.
 *
 * <p>Who does what:
 * <ul>
 *   <li>A {@link Source} hands out each frame's encoded bytes and the time it
 *       is shown at, from the video's own timestamps.</li>
 *   <li>A {@link Clock}, shared by the sharp and the blurred copy, says where
 *       playback is. It runs on {@code System.nanoTime}, not on the game's
 *       ticks, and stops when no menu has drawn for a quarter of a second, so
 *       the video goes on from where it was left.</li>
 *   <li>One or two workers decode the frames about to be due, at most
 *       {@value #LOOKAHEAD} ahead, into native memory. A worker that finds
 *       itself behind the clock jumps to the frame that is due rather than
 *       decoding the ones already late; when the game draws slower than the
 *       video, they decode only the frames that will be shown. Without a
 *       draw for a second they stop, and their memory goes with them.</li>
 *   <li>The render thread, each frame the menu is drawn, takes the newest
 *       decoded frame that is due, copies it into the texture and uploads it,
 *       once per video frame, never waiting for one.</li>
 * </ul>
 */
final class FramePlayer {
    /** Frames decoded ahead of the clock, at most. */
    static final int LOOKAHEAD = 3;
    /** How far ahead of the clock a frame may be decoded. */
    private static final long LEAD_MICROS = 150_000L;
    /** A worker stops after this long without a draw. */
    private static final long IDLE_NANOS = 1_000_000_000L;

    /** Where the frames come from. */
    interface Source {
        int count();

        int width();

        int height();

        /** When frame {@code index} is shown, from the start of the loop. */
        long start(int index);

        /** One loop. */
        long duration();

        /**
         * Frame {@code index}'s encoded bytes, from position 0 to the limit,
         * in {@code reuse} when it is direct and large enough.
         */
        ByteBuffer read(int index, ByteBuffer reuse) throws IOException;

        void close();
    }

    /** Playback time, paused while nothing is drawn. */
    static final class Clock {
        private static final long PAUSE_NANOS = 250_000_000L;
        private long origin = System.nanoTime();
        private long pausedAt = -1L;
        private long touched = origin;

        synchronized void touch(long now) {
            if (pausedAt >= 0L) {
                origin += now - pausedAt;
                pausedAt = -1L;
            }
            touched = now;
        }

        synchronized long micros(long now) {
            if (pausedAt < 0L && now - touched > PAUSE_NANOS) pausedAt = touched;
            return ((pausedAt >= 0L ? pausedAt : now) - origin) / 1000L;
        }
    }

    /** A decoded frame: native pixels, or Java's when stb_image is not there. */
    private static final class Decoded {
        final long pixels;
        final int[] abgr;

        Decoded(long pixels, int[] abgr) {
            this.pixels = pixels;
            this.abgr = abgr;
        }

        void free() {
            NativeFrames.free(pixels);
        }
    }

    /** Tests only: where frames go instead of a texture, to measure the player outside the game. */
    interface Sink {
        boolean accept(long pixels, int[] abgr);
    }

    static volatile Sink testSink;

    private final String name;
    private final Source source;
    private final Clock clock;
    private final int threads;
    private final long[] starts;
    private final long duration;
    private final int count;

    private volatile boolean running = true;
    private final ConcurrentSkipListMap<Long, Decoded> ready = new ConcurrentSkipListMap<Long, Decoded>();
    private final Semaphore slots = new Semaphore(LOOKAHEAD);
    private final AtomicLong next = new AtomicLong(-1L);
    private final AtomicInteger workers = new AtomicInteger();
    private volatile long lastPresent;
    private volatile long renderInterval;
    private volatile String failure;

    private StreamingTexture texture;
    private boolean refused;
    private long shown = -1L;

    // Measured, for the diagnostic line.
    private final AtomicLong decodeNanos = new AtomicLong();
    private final AtomicInteger decoded = new AtomicInteger();
    private final AtomicInteger skipped = new AtomicInteger();
    private long uploadNanos;
    private int uploads;
    /** Draws in the window, and those that showed an older frame than the one due. */
    private int ticks;
    private int lateTicks;
    private int presentedInWindow;
    private long windowStart;
    private String stats = "";

    FramePlayer(String name, Source source, Clock clock, int threads) {
        this.name = name;
        this.source = source;
        this.clock = clock;
        this.threads = Math.max(1, threads);
        this.count = source.count();
        this.starts = new long[count];
        for (int index = 0; index < count; index += 1) starts[index] = source.start(index);
        this.duration = Math.max(1L, source.duration());
    }

    int width() {
        return source.width();
    }

    int height() {
        return source.height();
    }

    /** Why this cannot play, or null. */
    String failure() {
        return failure;
    }

    // ---- Time -----------------------------------------------------------------

    /** The frame shown at {@code micros}, counted across loops. */
    private long sequenceAt(long micros) {
        long loop = micros / duration;
        long within = micros - loop * duration;
        int low = 0;
        int high = count - 1;
        while (low < high) {
            int middle = (low + high + 1) >>> 1;
            if (starts[middle] <= within) low = middle;
            else high = middle - 1;
        }
        return loop * count + low;
    }

    /** Frames apart the game draws: above one, the others need not be decoded. */
    private long stride() {
        long interval = renderInterval / 1000L;
        long frame = duration / count;
        if (interval <= 0L || frame <= 0L || interval < frame * 3L / 2L) return 1L;
        return Math.max(1L, Math.round(interval / (double) frame));
    }

    // ---- Workers --------------------------------------------------------------

    private void ensureWorkers() {
        while (running && failure == null) {
            int now = workers.get();
            if (now >= threads) return;
            if (!workers.compareAndSet(now, now + 1)) continue;
            Thread worker = new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        work();
                    } finally {
                        workers.decrementAndGet();
                        if (workers.get() == 0) drain();
                    }
                }
            }, "kiza-" + name + "-" + (now + 1));
            worker.setDaemon(true);
            worker.start();
        }
    }

    private void work() {
        ByteBuffer buffer = null;
        int[] size = new int[2];
        while (running) {
            long now = System.nanoTime();
            if (now - lastPresent > IDLE_NANOS) return;
            try {
                if (!slots.tryAcquire(20L, TimeUnit.MILLISECONDS)) continue;
            } catch (InterruptedException stop) {
                return;
            }
            boolean kept = false;
            try {
                long micros = clock.micros(now);
                long due = sequenceAt(micros);
                long ahead = sequenceAt(micros + LEAD_MICROS);
                long claim = -1L;
                while (true) {
                    long current = next.get();
                    long candidate = Math.max(current, due);
                    if (candidate > ahead) break;
                    if (next.compareAndSet(current, candidate + stride())) {
                        // Behind the clock: the frames between are not decoded at all.
                        if (current >= 0L && candidate > current) skipped.addAndGet((int) Math.min(Integer.MAX_VALUE, candidate - current));
                        claim = candidate;
                        break;
                    }
                }
                if (claim < 0L) {
                    try {
                        Thread.sleep(2L);
                    } catch (InterruptedException stop) {
                        return;
                    }
                    continue;
                }
                long began = System.nanoTime();
                buffer = source.read((int) (claim % count), buffer);
                Decoded frame = decode(buffer, size);
                decodeNanos.addAndGet(System.nanoTime() - began);
                decoded.incrementAndGet();
                if (frame == null) continue;
                ready.put(claim, frame);
                kept = true;
                if (!running) {
                    Decoded orphan = ready.remove(claim);
                    if (orphan != null) orphan.free();
                }
            } catch (Throwable broken) {
                // A frame that cannot be read is skipped; one that keeps
                // failing is said once, in the settings.
                if (failure == null && !(broken instanceof IOException)) failure = broken.getClass().getSimpleName();
            } finally {
                if (!kept) slots.release();
            }
        }
    }

    private Decoded decode(ByteBuffer encoded, int[] size) throws IOException {
        int width = source.width();
        int height = source.height();
        if (NativeFrames.available()) {
            long pixels = NativeFrames.decode(encoded, encoded.limit(), size);
            if (pixels == 0L) return null;
            if (size[0] != width || size[1] != height) {
                NativeFrames.free(pixels);
                return null;
            }
            return new Decoded(pixels, null);
        }
        byte[] bytes = new byte[encoded.limit()];
        encoded.get(bytes);
        BufferedImage image = ImageIO.read(new ByteArrayInputStream(bytes));
        if (image == null || image.getWidth() != width || image.getHeight() != height) return null;
        int[] pixels = image.getRGB(0, 0, width, height, null, 0, width);
        StreamingTexture.toAbgr(pixels);
        return new Decoded(0L, pixels);
    }

    /** Frees every decoded frame not yet shown. */
    private void drain() {
        for (Long key : ready.keySet()) {
            Decoded frame = ready.remove(key);
            if (frame != null) {
                frame.free();
                slots.release();
            }
        }
    }

    // ---- The render thread ------------------------------------------------------

    /**
     * Shows the frame that is due, if a newer one is decoded, and draws the
     * texture over the screen. False until there is a first frame.
     */
    boolean present(Object graphics, int screenWidth, int screenHeight) {
        long now = System.nanoTime();
        if (lastPresent > 0L) {
            long gap = Math.min(200_000_000L, now - lastPresent);
            renderInterval = renderInterval == 0L ? gap : (renderInterval * 7L + gap) / 8L;
        }
        lastPresent = now;
        clock.touch(now);
        ensureWorkers();

        long micros = clock.micros(now);
        long due = sequenceAt(micros);
        Map.Entry<Long, Decoded> newest = ready.floorEntry(due);
        if (newest != null && newest.getKey() > shown) {
            Decoded frame = ready.remove(newest.getKey());
            if (frame != null) {
                show(newest.getKey(), frame);
                frame.free();
                slots.release();
            }
        }
        // What is older than the frame due will never be shown.
        for (Long key : ready.headMap(due, true).keySet()) {
            Decoded stale = ready.remove(key);
            if (stale != null) {
                stale.free();
                slots.release();
                skipped.incrementAndGet();
            }
        }
        // Late: the frame on screen is older than the one the clock is at.
        ticks += 1;
        if (shown >= 0L && shown < due) lateTicks += 1;
        measure(now);
        if (testSink != null) return shown >= 0L;
        if (texture == null || shown < 0L) return false;
        MenuBackground.coverTexture(graphics, texture.identifier(), texture.width(), texture.height(), screenWidth, screenHeight);
        return true;
    }

    private void show(long sequence, Decoded frame) {
        Sink sink = testSink;
        if (sink != null) {
            long began = System.nanoTime();
            if (!sink.accept(frame.pixels, frame.abgr)) return;
            uploadNanos += System.nanoTime() - began;
            uploads += 1;
            presentedInWindow += 1;
            shown = sequence;
            return;
        }
        if (texture == null && !refused) {
            texture = StreamingTexture.create(name, source.width(), source.height());
            if (texture == null) {
                refused = true;
                failure = "texture";
            }
        }
        if (texture == null) return;
        long began = System.nanoTime();
        boolean sent = frame.abgr != null ? texture.write(frame.abgr) : texture.present(frame.pixels);
        if (!sent) return;
        uploadNanos += System.nanoTime() - began;
        uploads += 1;
        presentedInWindow += 1;
        shown = sequence;
    }

    private void measure(long now) {
        if (windowStart == 0L) windowStart = now;
        long span = now - windowStart;
        if (span < 1_000_000_000L) return;
        int decodedCount = decoded.getAndSet(0);
        long decodeTime = decodeNanos.getAndSet(0L);
        double fps = presentedInWindow * 1e9 / span;
        long frameBytes = (long) source.width() * source.height() * 4L;
        // Measurements, in the words such tools use everywhere: not translated.
        stats = String.format(java.util.Locale.ROOT,
            "%dx%d  %.1f fps  skipped %d  on time %.1f %%  decode %.1f ms  upload %.2f ms  buffer %d (%.0f MB)  GPU %.0f MB",
            source.width(), source.height(), fps, skipped.get(),
            ticks == 0 ? 100D : 100D * (ticks - lateTicks) / ticks,
            decodedCount == 0 ? 0D : decodeTime / 1e6 / decodedCount,
            uploads == 0 ? 0D : uploadNanos / 1e6 / uploads,
            ready.size(), ready.size() * frameBytes / 1e6,
            texture == null ? 0D : texture.bytes() / 1e6);
        presentedInWindow = 0;
        uploadNanos = 0L;
        uploads = 0;
        ticks = 0;
        lateTicks = 0;
        windowStart = now;
    }

    /** One line of measurements, renewed every second. */
    String stats() {
        return stats;
    }

    /** Stops the workers and frees what they decoded. The texture stays for the next player of this name. */
    void stop() {
        running = false;
        drain();
        source.close();
    }
}
