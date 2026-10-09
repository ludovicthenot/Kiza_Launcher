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
    private static VideoPlayer video;

    private static Object texture;
    private static Frame shown;
    private static long started;

    /** Why the chosen background is not showing, or null. Said in the settings. */
    public static String problem() {
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

    private static boolean drawShown(Object graphics, int width, int height) {
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

    /** The frame due now: the still's own, by the clock, or the video's latest. */
    private static Frame current() {
        if (video != null) return video.latest();
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
            video = new VideoPlayer(file, MAX_WIDTH, MAX_HEIGHT);
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
    }

    // ---- Images and GIFs ------------------------------------------------------

    private static List<Frame> readImage(File file) throws Exception {
        BufferedImage image = ImageIO.read(file);
        if (image == null) throw new IllegalStateException("not an image Java can open");
        List<Frame> frames = new ArrayList<Frame>();
        frames.add(frame(fit(image), 0, false));
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
                Frame frame = frame(fit(canvas), millis, true);
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
     * Plays an MP4 on a thread of its own, keeping the frame that is due.
     *
     * <p>The decoder runs ahead by one frame at most and waits for the clock,
     * so a 60 frames-a-second video costs what it shows, not what it holds.
     * At the end it starts over: a background is a loop.
     */
    private static final class VideoPlayer implements Runnable, VideoSink {
        private final File file;
        private final int maxWidth;
        private final int maxHeight;
        private volatile boolean running = true;
        private volatile Frame latest;
        private Thread thread;

        VideoPlayer(File file, int maxWidth, int maxHeight) {
            this.file = file;
            this.maxWidth = maxWidth;
            this.maxHeight = maxHeight;
        }

        void start() {
            thread = new Thread(this, "kiza-menu-video");
            thread.setDaemon(true);
            thread.setPriority(Thread.MIN_PRIORITY + 1);
            thread.start();
        }

        void stop() {
            running = false;
            if (thread != null) thread.interrupt();
        }

        Frame latest() {
            return latest;
        }

        @Override
        public void run() {
            try {
                // Found by name: the decoder ships in the modern jars only, and
                // on a Minecraft old enough to lack it the answer is a message.
                java.lang.reflect.Method play;
                try {
                    play = Class.forName("fr.kiza.basemod.menu.VideoDecoding")
                        .getMethod("play", File.class, VideoSink.class);
                } catch (ClassNotFoundException absent) {
                    problem = "La vidéo n'est pas disponible sur cette version de Minecraft.";
                    return;
                }
                while (running) {
                    Object again = play.invoke(null, file, this);
                    if (!Boolean.TRUE.equals(again)) break;
                }
            } catch (Throwable failure) {
                // Stopped on purpose -- another background chosen -- is not a fault.
                if (!running) return;
                problem = "Cette vidéo ne peut pas être lue : seul le MP4 en H.264 est pris en charge.";
                System.err.println("[Kiza Client] The menu video could not be played: " + failure);
            }
        }

        @Override
        public boolean running() {
            return running;
        }

        @Override
        public void show(BufferedImage image) throws Exception {
            latest = frame(fit(image), 0, false);
        }
    }
}
