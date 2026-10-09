package fr.kiza.basemod.menu;

import fr.kiza.basemod.render.KizaCanvas;
import java.awt.AlphaComposite;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.metadata.IIOMetadata;
import javax.imageio.stream.ImageInputStream;
import org.w3c.dom.NamedNodeMap;
import org.w3c.dom.Node;

/**
 * The picture behind the title menu, when the player chose one: an image, a
 * GIF or a video.
 *
 * <p>Everything slow happens on a thread of its own: reading the file, putting
 * a GIF's frames together, decoding the video. What reaches the render thread
 * is a finished PNG per frame, uploaded under one texture name that each new
 * frame replaces -- a background playing all evening holds one texture.
 *
 * <p>The frames are made small, at most 960 by 540. The menu is behind a veil
 * and under the buttons; a larger picture would cost memory and decoding time
 * to show detail nobody looks at.
 *
 * <p>Anything wrong with the file -- unreadable, a codec that is not H.264,
 * an image Java cannot open -- is reported once and leaves Kiza's own
 * background in place. It never reaches the game as a crash.
 */
public final class MenuBackground {
    private MenuBackground() {}

    private static final int MAX_WIDTH = 960;
    private static final int MAX_HEIGHT = 540;
    private static final int MAX_GIF_FRAMES = 400;
    private static final long MAX_GIF_BYTES = 120L * 1024L * 1024L;

    /** One frame, ready to upload, and how long it stays on screen. */
    private static final class Frame {
        final byte[] png;
        final int width;
        final int height;
        final long millis;
        /** The same frame, small and blurred, for the menus after the title; null until made. */
        volatile Frame blurred;

        Frame(byte[] png, int width, int height, long millis) {
            this.png = png;
            this.width = width;
            this.height = height;
            this.millis = millis;
        }
    }

    /** What is playing, and for which choice it was loaded. */
    private static String loadedFor;
    private static volatile List<Frame> still;
    private static volatile String problem;
    private static PreparedVideo video;

    private static Object texture;
    private static Frame shown;
    private static long started;
    private static Object blurredTexture;
    private static Frame blurredShown;
    /** When a menu last asked for the blurred picture: a video makes it only while one does. */
    private static volatile long blurWanted;

    /** Why the chosen background is not showing, or how far a video's preparation is. Said in the settings. */
    public static String problem() {
        PreparedVideo playing = video;
        if (problem == null && playing != null && playing.preparing >= 0F) {
            return "Préparation de la vidéo : " + Math.round(playing.preparing * 100F) + " %";
        }
        return problem;
    }

    /**
     * Draws the chosen background over the whole screen, or answers false so
     * the caller draws Kiza's own.
     */
    public static synchronized boolean draw(Object graphics, int width, int height) {
        ClientSettings.Background kind = ClientSettings.background();
        File file = ClientSettings.backgroundFile();
        if (kind == ClientSettings.Background.KIZA || file == null) {
            stop();
            return false;
        }
        String choice = kind + "|" + file.getAbsolutePath() + "|" + file.lastModified();
        if (!choice.equals(loadedFor)) start(kind, file, choice);
        if (video != null) return video.draw(graphics, width, height, false);

        Frame next = current();
        if (next == null) return false;
        if (next != shown) {
            Object uploaded = KizaCanvas.uploadPng("menu_background", next.png);
            if (uploaded == null) return shown != null && drawShown(graphics, width, height);
            texture = uploaded;
            shown = next;
        }
        return drawShown(graphics, width, height);
    }

    /**
     * The chosen background, blurred, for a menu after the title; false when
     * Kiza's own should be drawn instead.
     */
    public static synchronized boolean drawBlurred(Object graphics, int width, int height) {
        ClientSettings.Background kind = ClientSettings.background();
        File file = ClientSettings.backgroundFile();
        if (kind == ClientSettings.Background.KIZA || file == null) return false;
        String choice = kind + "|" + file.getAbsolutePath() + "|" + file.lastModified();
        if (!choice.equals(loadedFor)) start(kind, file, choice);
        blurWanted = System.nanoTime();
        if (video != null) return video.draw(graphics, width, height, true);

        Frame next = current();
        Frame soft = next == null ? null : next.blurred;
        if (soft == null) {
            // Not blurred yet -- the first frames of a video: the plain one.
            if (next == null) return blurredShown != null && cover(graphics, blurredTexture, blurredShown, width, height);
            soft = next;
        }
        if (soft != blurredShown) {
            Object uploaded = KizaCanvas.uploadPng("menu_background_blur", soft.png);
            if (uploaded == null) return blurredShown != null && cover(graphics, blurredTexture, blurredShown, width, height);
            blurredTexture = uploaded;
            blurredShown = soft;
        }
        return cover(graphics, blurredTexture, blurredShown, width, height);
    }

    private static boolean drawShown(Object graphics, int width, int height) {
        return cover(graphics, texture, shown, width, height);
    }

    private static boolean cover(Object graphics, Object texture, Frame shown, int width, int height) {
        if (texture == null || shown == null) return false;
        // Covering, not stretching: the picture is cropped to the screen's
        // shape and centred, as the static background is.
        double screenAspect = width / (double) height;
        double frameAspect = shown.width / (double) shown.height;
        int sourceWidth = shown.width;
        int sourceHeight = shown.height;
        int sourceX = 0;
        int sourceY = 0;
        if (screenAspect > frameAspect) {
            sourceHeight = Math.max(1, (int) Math.round(shown.width / screenAspect));
            sourceY = (shown.height - sourceHeight) / 2;
        } else {
            sourceWidth = Math.max(1, (int) Math.round(shown.height * screenAspect));
            sourceX = (shown.width - sourceWidth) / 2;
        }
        fr.kiza.basemod.MenuLogoRenderer.blitRegion(
            graphics, texture, 0, 0, width, height,
            sourceX, sourceY, sourceWidth, sourceHeight, shown.width, shown.height
        );
        return true;
    }

    /** The frame due now: the still's own, by the clock. */
    private static Frame current() {
        List<Frame> frames = still;
        if (frames == null || frames.isEmpty()) return null;
        if (frames.size() == 1) return frames.get(0);
        long total = 0;
        for (Frame frame : frames) total += frame.millis;
        if (total <= 0) return frames.get(0);
        long at = ((System.nanoTime() - started) / 1_000_000L) % total;
        for (Frame frame : frames) {
            if (at < frame.millis) return frame;
            at -= frame.millis;
        }
        return frames.get(frames.size() - 1);
    }

    private static void start(final ClientSettings.Background kind, final File file, String choice) {
        stop();
        loadedFor = choice;
        problem = null;
        started = System.nanoTime();
        if (kind == ClientSettings.Background.VIDEO) {
            video = new PreparedVideo(file);
            video.start();
            return;
        }
        Thread loader = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    List<Frame> frames = kind == ClientSettings.Background.GIF ? readGif(file) : readImage(file);
                    if (frames.isEmpty()) throw new IllegalStateException("no picture in the file");
                    still = frames;
                } catch (Throwable failure) {
                    problem = "Ce fichier ne peut pas être lu (" + failure.getClass().getSimpleName() + ").";
                    System.err.println("[Kiza Client] The menu background could not be read: " + failure);
                }
            }
        }, "kiza-menu-background");
        loader.setDaemon(true);
        loader.start();
    }

    private static void stop() {
        if (video != null) video.stop();
        video = null;
        still = null;
        loadedFor = null;
        shown = null;
        texture = null;
        blurredShown = null;
        blurredTexture = null;
    }

    // ---- Images and GIFs ------------------------------------------------------

    private static List<Frame> readImage(File file) throws Exception {
        BufferedImage image = ImageIO.read(file);
        if (image == null) throw new IllegalStateException("not an image Java can open");
        List<Frame> frames = new ArrayList<Frame>();
        BufferedImage fitted = fit(image);
        Frame frame = frame(fitted, 0, false);
        frame.blurred = frame(blur(fitted), 0, true);
        frames.add(frame);
        return frames;
    }

    /**
     * Every frame of a GIF, put together the way a browser shows them.
     *
     * <p>A GIF frame is often only the part of the picture that changed,
     * placed at an offset, with a rule for what happens to it after: stay,
     * be cleared to the background, or be put back to what was under it.
     * Reading frames one by one without that gives a flicker of fragments.
     */
    private static List<Frame> readGif(File file) throws Exception {
        List<Frame> frames = new ArrayList<Frame>();
        ImageInputStream input = ImageIO.createImageInputStream(file);
        if (input == null) throw new IllegalStateException("unreadable");
        try {
            java.util.Iterator<ImageReader> readers = ImageIO.getImageReadersByFormatName("gif");
            if (!readers.hasNext()) throw new IllegalStateException("no GIF reader");
            ImageReader reader = readers.next();
            reader.setInput(input, false);
            int count = Math.min(MAX_GIF_FRAMES, reader.getNumImages(true));
            int width = reader.getWidth(0);
            int height = reader.getHeight(0);
            BufferedImage canvas = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
            long bytes = 0;
            for (int index = 0; index < count; index += 1) {
                BufferedImage part = reader.read(index);
                IIOMetadata metadata = reader.getImageMetadata(index);
                Node root = metadata.getAsTree("javax_imageio_gif_image_1.0");
                int left = attribute(root, "ImageDescriptor", "imageLeftPosition", 0);
                int top = attribute(root, "ImageDescriptor", "imageTopPosition", 0);
                int delay = attribute(root, "GraphicControlExtension", "delayTime", 10);
                String disposal = text(root, "GraphicControlExtension", "disposalMethod", "none");

                BufferedImage before = "restoreToPrevious".equals(disposal) ? copy(canvas) : null;
                Graphics2D g = canvas.createGraphics();
                g.drawImage(part, left, top, null);
                g.dispose();

                // A delay of 0 or 1 hundredths is what most tools write for
                // "as fast as possible"; browsers play those at 100 ms.
                long millis = delay <= 1 ? 100L : delay * 10L;
                BufferedImage fitted = fit(canvas);
                Frame frame = frame(fitted, millis, true);
                frame.blurred = frame(blur(fitted), millis, true);
                bytes += frame.png.length;
                frames.add(frame);
                if (bytes > MAX_GIF_BYTES) break;

                if ("restoreToBackgroundColor".equals(disposal)) {
                    Graphics2D clear = canvas.createGraphics();
                    clear.setComposite(AlphaComposite.Clear);
                    clear.fillRect(left, top, part.getWidth(), part.getHeight());
                    clear.dispose();
                } else if (before != null) {
                    canvas = before;
                }
            }
            reader.dispose();
        } finally {
            input.close();
        }
        return frames;
    }

    private static int attribute(Node root, String element, String name, int fallback) {
        String raw = text(root, element, name, null);
        if (raw == null) return fallback;
        try {
            return Integer.parseInt(raw);
        } catch (NumberFormatException wrong) {
            return fallback;
        }
    }

    private static String text(Node root, String element, String name, String fallback) {
        for (Node child = root.getFirstChild(); child != null; child = child.getNextSibling()) {
            if (!element.equals(child.getNodeName())) continue;
            NamedNodeMap attributes = child.getAttributes();
            Node value = attributes == null ? null : attributes.getNamedItem(name);
            if (value != null) return value.getNodeValue();
        }
        return fallback;
    }

    private static BufferedImage copy(BufferedImage image) {
        BufferedImage copy = new BufferedImage(image.getWidth(), image.getHeight(), BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = copy.createGraphics();
        g.drawImage(image, 0, 0, null);
        g.dispose();
        return copy;
    }

    /**
     * A light blur, the menus' version of the picture: a quarter of the size,
     * three box passes, drawn back up by the game. Small on purpose -- a blur
     * hides detail, so there is no detail worth the pixels.
     */
    static BufferedImage blur(BufferedImage image) {
        int w = Math.max(1, image.getWidth() / 2);
        int h = Math.max(1, image.getHeight() / 2);
        BufferedImage small = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = small.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.drawImage(image, 0, 0, w, h, null);
        g.dispose();
        int radius = Math.max(2, w / 160);
        float[] line = new float[radius * 2 + 1];
        java.util.Arrays.fill(line, 1F / line.length);
        java.awt.image.ConvolveOp across = new java.awt.image.ConvolveOp(
            new java.awt.image.Kernel(line.length, 1, line), java.awt.image.ConvolveOp.EDGE_NO_OP, null);
        java.awt.image.ConvolveOp down = new java.awt.image.ConvolveOp(
            new java.awt.image.Kernel(1, line.length, line), java.awt.image.ConvolveOp.EDGE_NO_OP, null);
        BufferedImage out = small;
        for (int pass = 0; pass < 3; pass += 1) out = down.filter(across.filter(out, null), null);
        return out;
    }

    /** At most 960 by 540, opaque, keeping the picture's shape. */
    static BufferedImage fit(BufferedImage image) {
        double scale = Math.min(1D, Math.min(MAX_WIDTH / (double) image.getWidth(), MAX_HEIGHT / (double) image.getHeight()));
        int w = Math.max(1, (int) Math.round(image.getWidth() * scale));
        int h = Math.max(1, (int) Math.round(image.getHeight() * scale));
        BufferedImage out = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.drawImage(image, 0, 0, w, h, null);
        g.dispose();
        return out;
    }

    /** A frame as PNG; {@code compress} trades encoding time for memory. */
    static Frame frame(BufferedImage image, long millis, boolean compress) throws Exception {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream(image.getWidth() * image.getHeight());
        javax.imageio.ImageWriter writer = ImageIO.getImageWritersByFormatName("png").next();
        javax.imageio.ImageWriteParam param = writer.getDefaultWriteParam();
        if (!compress && param.canWriteCompressed()) {
            // Video frames are encoded twenty times a second and thrown away;
            // the least compression is the fastest, and they are never stored.
            param.setCompressionMode(javax.imageio.ImageWriteParam.MODE_EXPLICIT);
            param.setCompressionQuality(1F);
        }
        javax.imageio.stream.ImageOutputStream output = ImageIO.createImageOutputStream(buffer);
        try {
            writer.setOutput(output);
            writer.write(null, new javax.imageio.IIOImage(image, null, null), param);
        } finally {
            output.close();
            writer.dispose();
        }
        return new Frame(buffer.toByteArray(), image.getWidth(), image.getHeight(), millis);
    }

    // ---- Video ----------------------------------------------------------------

    /**
     * A video as the menu plays it: prepared once into JPEG frames beside the
     * file, then played from them.
     *
     * <p>Two threads decode the frames ahead of the clock, a few at most, and
     * jump straight to the one that is due when they fall behind -- each JPEG
     * stands alone, which is what an H.264 frame does not. The render thread
     * writes the due frame into one texture and sends it up; nothing is made
     * or freed per frame, and the arrays the frames arrive in are reused.
     *
     * <p>When no menu has asked for a frame for half a second -- in a world --
     * the threads wait rather than decode a video nobody is looking at.
     */
    private static final class PreparedVideo {
        private static final int LOOKAHEAD = 4;

        private final File source;
        private final File frames;
        private volatile boolean running = true;
        /** How far the preparation is, 0 to 1, or below 0 when there is none. */
        volatile float preparing = -1F;
        private volatile boolean ready;

        private int count;
        private double fps;
        private int width;
        private int height;
        private long clock;
        private volatile long lastDrawn;

        private final java.util.concurrent.ConcurrentHashMap<Long, int[]> sharp =
            new java.util.concurrent.ConcurrentHashMap<Long, int[]>();
        private final java.util.concurrent.ConcurrentHashMap<Long, int[]> soft =
            new java.util.concurrent.ConcurrentHashMap<Long, int[]>();
        private final java.util.concurrent.atomic.AtomicLong next = new java.util.concurrent.atomic.AtomicLong();
        private final java.util.ArrayDeque<int[]> pool = new java.util.ArrayDeque<int[]>();

        private fr.kiza.basemod.render.StreamingTexture sharpTexture;
        private fr.kiza.basemod.render.StreamingTexture softTexture;
        private long shownSharp = -1L;
        private long shownSoft = -1L;
        private boolean streamingRefused;

        PreparedVideo(File source) {
            this.source = source;
            this.frames = new File(source.getParentFile(), source.getName() + ".frames");
        }

        void start() {
            Thread thread = new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (!readIndex()) {
                            prepare();
                            if (!running || !readIndex()) return;
                        }
                        clock = System.nanoTime();
                        ready = true;
                        startWorker();
                        decodeLoop();
                    } catch (Throwable failure) {
                        if (!running) return;
                        problem = failure instanceof ClassNotFoundException
                            ? "La vidéo n'est pas disponible sur cette version de Minecraft."
                            : "Cette vidéo ne peut pas être lue : seul le MP4 en H.264 est pris en charge.";
                        System.err.println("[Kiza Client] The menu video could not be prepared: " + failure);
                    }
                }
            }, "kiza-menu-video");
            thread.setDaemon(true);
            thread.start();
        }

        void stop() {
            running = false;
        }

        /** The frames from before, if they were made from this very file. */
        private boolean readIndex() {
            File index = new File(frames, "index.properties");
            if (!index.isFile()) return false;
            java.util.Properties values = new java.util.Properties();
            java.io.InputStream input = null;
            try {
                input = new java.io.FileInputStream(index);
                values.load(input);
            } catch (java.io.IOException unreadable) {
                return false;
            } finally {
                if (input != null) {
                    try {
                        input.close();
                    } catch (java.io.IOException ignored) {
                        // Nothing more to do.
                    }
                }
            }
            if (!String.valueOf(source.length()).equals(values.getProperty("source.size"))
                || !String.valueOf(source.lastModified()).equals(values.getProperty("source.modified"))) {
                return false;
            }
            try {
                count = Integer.parseInt(values.getProperty("frames"));
                fps = Double.parseDouble(values.getProperty("fps"));
                width = Integer.parseInt(values.getProperty("width"));
                height = Integer.parseInt(values.getProperty("height"));
            } catch (RuntimeException wrong) {
                return false;
            }
            return count > 0 && fps > 0 && width > 0 && height > 0;
        }

        /** Makes the frames, into a folder of its own that only replaces the old one once whole. */
        private void prepare() throws Exception {
            preparing = 0F;
            File staging = new File(frames.getParentFile(), frames.getName() + ".part");
            delete(staging);
            java.lang.reflect.Method prepare = Class.forName("fr.kiza.basemod.menu.VideoPreparation")
                .getMethod("prepare", File.class, File.class, VideoProgress.class);
            try {
                prepare.invoke(null, source, staging, new VideoProgress() {
                    @Override
                    public boolean running() {
                        return running;
                    }

                    @Override
                    public void progress(float done) {
                        preparing = done;
                    }
                });
            } catch (java.lang.reflect.InvocationTargetException failure) {
                throw failure.getCause() instanceof Exception ? (Exception) failure.getCause() : failure;
            }
            if (!running) {
                delete(staging);
                return;
            }
            // Stamped with the file it was made from, so a new video in its
            // place is prepared again rather than played from the old frames.
            File index = new File(staging, "index.properties");
            java.util.Properties values = new java.util.Properties();
            java.io.InputStream input = new java.io.FileInputStream(index);
            try {
                values.load(input);
            } finally {
                input.close();
            }
            values.setProperty("source.size", String.valueOf(source.length()));
            values.setProperty("source.modified", String.valueOf(source.lastModified()));
            java.io.OutputStream output = new java.io.FileOutputStream(index);
            try {
                values.store(output, "Frames of the menu video, prepared by Kiza Client");
            } finally {
                output.close();
            }
            delete(frames);
            if (!staging.renameTo(frames)) throw new IllegalStateException("the frames could not be kept");
            preparing = -1F;
        }

        private void startWorker() {
            Thread second = new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        decodeLoop();
                    } catch (Throwable ignored) {
                        // The first thread carries on alone.
                    }
                }
            }, "kiza-menu-video-2");
            second.setDaemon(true);
            second.start();
        }

        /** The frame the clock has reached, counted from the start, looping. */
        private long due() {
            return (long) ((System.nanoTime() - clock) / 1_000_000_000D * fps);
        }

        private void decodeLoop() throws Exception {
            while (running) {
                if (System.nanoTime() - lastDrawn > 500_000_000L) {
                    Thread.sleep(50L);
                    // Coming back from a world starts the loop where the clock is.
                    continue;
                }
                long due = due();
                long index = next.get();
                if (index < due) {
                    next.compareAndSet(index, due);
                    continue;
                }
                if (index > due + LOOKAHEAD) {
                    Thread.sleep(2L);
                    continue;
                }
                if (!next.compareAndSet(index, index + 1)) continue;
                File file = new File(frames, String.format("frame_%05d.jpg", (int) (index % count)));
                BufferedImage image = ImageIO.read(file);
                if (image == null) continue;
                int[] pixels = take(width * height);
                image.getRGB(0, 0, width, height, pixels, 0, width);
                fr.kiza.basemod.render.StreamingTexture.toAbgr(pixels);
                sharp.put(index, pixels);
                if (System.nanoTime() - blurWanted < 1_000_000_000L) {
                    BufferedImage blurred = blur(image);
                    int[] small = blurred.getRGB(0, 0, blurred.getWidth(), blurred.getHeight(), null, 0, blurred.getWidth());
                    fr.kiza.basemod.render.StreamingTexture.toAbgr(small);
                    soft.put(index, small);
                }
            }
        }

        private int[] take(int size) {
            synchronized (pool) {
                int[] reused = pool.poll();
                if (reused != null && reused.length == size) return reused;
            }
            return new int[size];
        }

        private void give(int[] pixels) {
            synchronized (pool) {
                if (pool.size() < LOOKAHEAD * 3) pool.add(pixels);
            }
        }

        /** Draws the frame that is due, the newest one ready at or before it. */
        boolean draw(Object graphics, int screenWidth, int screenHeight, boolean blurred) {
            lastDrawn = System.nanoTime();
            if (!ready) return false;
            long due = due();
            java.util.concurrent.ConcurrentHashMap<Long, int[]> map = blurred && !soft.isEmpty() ? soft : sharp;
            boolean small = map == soft;
            long best = -1L;
            for (Long key : map.keySet()) {
                if (key <= due && key > best) best = key;
            }
            int frameWidth = small ? Math.max(1, width / 2) : width;
            int frameHeight = small ? Math.max(1, height / 2) : height;
            fr.kiza.basemod.render.StreamingTexture texture = small ? softTexture : sharpTexture;
            long shown = small ? shownSoft : shownSharp;
            if (best >= 0 && best != shown) {
                int[] pixels = map.get(best);
                if (pixels != null && pixels.length >= frameWidth * frameHeight) {
                    if (texture == null && !streamingRefused) {
                        texture = fr.kiza.basemod.render.StreamingTexture.create(
                            small ? "menu_video_blur" : "menu_video", frameWidth, frameHeight
                        );
                        if (texture == null) streamingRefused = true;
                        if (small) softTexture = texture;
                        else sharpTexture = texture;
                    }
                    if (texture != null && texture.write(pixels)) {
                        if (small) shownSoft = best;
                        else shownSharp = best;
                    }
                }
            }
            // What is behind the frame drawn is no longer wanted.
            for (Long key : map.keySet()) {
                if (key < (best >= 0 ? best : due - LOOKAHEAD)) {
                    int[] old = map.remove(key);
                    if (old != null && !small) give(old);
                }
            }
            if (texture == null || (small ? shownSoft : shownSharp) < 0) return false;
            return coverTexture(graphics, texture.identifier(), frameWidth, frameHeight, screenWidth, screenHeight);
        }

        private static void delete(File file) {
            if (file.isDirectory()) {
                File[] children = file.listFiles();
                if (children != null) {
                    for (File child : children) delete(child);
                }
            }
            if (file.exists()) file.delete();
        }
    }

    /** Covers the screen with a texture of the given size, cropped to its shape. */
    private static boolean coverTexture(Object graphics, Object identifier, int frameWidth, int frameHeight, int width, int height) {
        double screenAspect = width / (double) height;
        double frameAspect = frameWidth / (double) frameHeight;
        int sourceWidth = frameWidth;
        int sourceHeight = frameHeight;
        int sourceX = 0;
        int sourceY = 0;
        if (screenAspect > frameAspect) {
            sourceHeight = Math.max(1, (int) Math.round(frameWidth / screenAspect));
            sourceY = (frameHeight - sourceHeight) / 2;
        } else {
            sourceWidth = Math.max(1, (int) Math.round(frameHeight * screenAspect));
            sourceX = (frameWidth - sourceWidth) / 2;
        }
        fr.kiza.basemod.MenuLogoRenderer.blitRegion(
            graphics, identifier, 0, 0, width, height,
            sourceX, sourceY, sourceWidth, sourceHeight, frameWidth, frameHeight
        );
        return true;
    }
}
