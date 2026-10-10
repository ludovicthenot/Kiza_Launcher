package fr.kiza.basemod.menu;

import fr.kiza.basemod.render.KizaCanvas;
import java.awt.AlphaComposite;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.util.ArrayList;
import java.util.List;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.metadata.IIOMetadata;
import javax.imageio.stream.ImageInputStream;
import org.w3c.dom.NamedNodeMap;
import org.w3c.dom.Node;

/**
 * The picture behind the menus, when the player chose one: an image, a GIF
 * or a video.
 *
 * <p>An image is read once and uploaded once, up to 2560 by 1440 -- reduced
 * by halves when it is larger, so the reduction averages rather than skips
 * pixels -- and sampled smoothly, so it is not drawn in squares when the
 * screen is larger than it. A GIF's frames and a prepared video's are played
 * by {@link FramePlayer}, on a clock of their own, into one texture each.
 *
 * <p>Each kind keeps a small blurred copy for the menus after the title,
 * drawn back up smoothly, which is what a blur looks like anyway.
 *
 * <p>Anything wrong with the file -- unreadable, a codec that is not H.264,
 * an image Java cannot open -- is reported once and leaves Kiza's own
 * background in place. It never reaches the game as a crash.
 */
public final class MenuBackground {
    private MenuBackground() {}

    private static final int MAX_WIDTH = 2560;
    private static final int MAX_HEIGHT = 1440;
    private static final int GIF_WIDTH = 1920;
    private static final int GIF_HEIGHT = 1080;
    private static final int BLUR_WIDTH = 960;
    private static final int BLUR_HEIGHT = 540;
    private static final int MAX_GIF_FRAMES = 400;
    private static final long MAX_GIF_BYTES = 160L * 1024L * 1024L;

    /** One frame, encoded, and how long it stays on screen. */
    static final class Frame {
        final byte[] png;
        final int width;
        final int height;
        final long millis;
        /** The same frame, small and blurred, for the menus after the title. */
        volatile Frame blurred;

        Frame(byte[] png, int width, int height, long millis) {
            this.png = png;
            this.width = width;
            this.height = height;
            this.millis = millis;
        }
    }

    /** Something that moves: its sharp and its blurred frames, on one clock. */
    private static final class Animated {
        final FramePlayer.Source sharp;
        final FramePlayer.Source soft;
        final int sharpThreads;

        Animated(FramePlayer.Source sharp, FramePlayer.Source soft, int sharpThreads) {
            this.sharp = sharp;
            this.soft = soft;
            this.sharpThreads = sharpThreads;
        }
    }

    /** What is playing, and for which choice it was loaded. */
    private static String loadedFor;
    private static volatile Frame still;
    private static volatile Animated animated;
    private static volatile ClientText.Phrase problem;
    /** Counts the choices loaded, so a slow read for an older one is dropped. */
    private static volatile int generation;
    private static PreparedVideo video;

    private static FramePlayer sharpPlayer;
    private static FramePlayer softPlayer;
    private static FramePlayer.Clock clock;
    private static FramePlayer lastDrawn;

    private static Object texture;
    private static Frame shown;
    private static Object blurredTexture;
    private static Frame blurredShown;

    /** Why the chosen background is not showing, or how far a video's preparation is. Said in the settings. */
    public static String problem() {
        PreparedVideo playing = video;
        if (problem == null && playing != null && playing.preparing >= 0F) {
            int percent = Math.round(playing.preparing * 100F);
            return ClientText.t("Préparation de la vidéo : " + percent + " % (une seule fois)",
                "Preparing the video: " + percent + " % (only once)");
        }
        FramePlayer player = sharpPlayer;
        if (problem == null && player != null && player.failure() != null) {
            return ClientText.t("La vidéo ne peut pas être affichée sur cette version de Minecraft.",
                "The video cannot be shown on this version of Minecraft.");
        }
        return problem == null ? null : problem.toString();
    }

    /** Whether what {@link #problem} says is a preparation under way, not a fault. */
    public static boolean preparing() {
        PreparedVideo playing = video;
        return problem == null && playing != null && playing.preparing >= 0F;
    }

    /**
     * Draws the chosen background over the whole screen, or answers false so
     * the caller draws Kiza's own.
     */
    public static synchronized boolean draw(Object graphics, int width, int height) {
        if (!follow()) return false;
        Animated moving = animated;
        if (moving != null) return playing(moving, false).present(graphics, width, height) && drawn(sharpPlayer);
        Frame next = still;
        if (next == null) return false;
        if (next != shown) {
            Object uploaded = KizaCanvas.uploadPng("menu_background", next.png, true);
            if (uploaded == null) return shown != null && cover(graphics, texture, shown, width, height);
            texture = uploaded;
            shown = next;
        }
        return cover(graphics, texture, shown, width, height);
    }

    /**
     * The chosen background, blurred, for a menu after the title; false when
     * Kiza's own should be drawn instead.
     */
    public static synchronized boolean drawBlurred(Object graphics, int width, int height) {
        if (!follow()) return false;
        Animated moving = animated;
        if (moving != null) return playing(moving, true).present(graphics, width, height) && drawn(softPlayer);
        Frame next = still;
        Frame soft = next == null ? null : next.blurred;
        if (soft == null) return false;
        if (soft != blurredShown) {
            Object uploaded = KizaCanvas.uploadPng("menu_background_blur", soft.png, true);
            if (uploaded == null) return blurredShown != null && cover(graphics, blurredTexture, blurredShown, width, height);
            blurredTexture = uploaded;
            blurredShown = soft;
        }
        return cover(graphics, blurredTexture, blurredShown, width, height);
    }

    private static boolean drawn(FramePlayer player) {
        lastDrawn = player;
        return true;
    }

    /** Loads what the settings now say, if it is not what is loaded. False for Kiza's own. */
    private static boolean follow() {
        ClientSettings.Background kind = ClientSettings.background();
        File file = ClientSettings.backgroundFile();
        if (kind == ClientSettings.Background.KIZA || file == null) {
            stop();
            return false;
        }
        String choice = kind + "|" + file.getAbsolutePath() + "|" + file.lastModified()
            + (kind == ClientSettings.Background.VIDEO ? "|" + variant() : "");
        if (!choice.equals(loadedFor)) start(kind, file, choice);
        return true;
    }

    private static FramePlayer playing(Animated moving, boolean blurred) {
        if (clock == null) clock = new FramePlayer.Clock();
        if (blurred) {
            if (softPlayer == null) softPlayer = new FramePlayer(name("blur"), moving.soft, clock, 1);
            return softPlayer;
        }
        if (sharpPlayer == null) sharpPlayer = new FramePlayer(name("frame"), moving.sharp, clock, moving.sharpThreads);
        return sharpPlayer;
    }

    private static String name(String part) {
        return (video != null ? "menu_video_" : "menu_gif_") + part;
    }

    /**
     * The diagnostic line, when the player asked for it: what the video
     * really does, measured, over the last second. Drawn by the caller after
     * the veil.
     */
    public static synchronized void drawStats(Object graphics) {
        // A video's setting, in the video's section: an image or a GIF
        // behind the menu shows nothing, whatever it was left at.
        if (!ClientSettings.videoStats() || graphics == null || video == null) return;
        FramePlayer player = lastDrawn;
        if (player == null || (player != sharpPlayer && player != softPlayer)) return;
        String line = (player == softPlayer ? ClientText.t("Flou  ", "Blur  ") : ClientText.t("Vidéo  ", "Video  ")) + player.stats();
        if (player.stats().isEmpty()) return;
        int[] size = new int[2];
        Object text = Buttons.text(line, 8, 0xFFE8E4F5, false, size);
        if (text == null) return;
        int scale = Buttons.supersample();
        fr.kiza.basemod.MenuLogoRenderer.fill(graphics, 2, 2, size[0] + 8, size[1] + 4, 0xB0050409);
        fr.kiza.basemod.MenuLogoRenderer.blitTexture(graphics, text, 6, 4, size[0], size[1], size[0] * scale, size[1] * scale);
    }

    private static boolean cover(Object graphics, Object texture, Frame shown, int width, int height) {
        if (texture == null || shown == null) return false;
        return coverTexture(graphics, texture, shown.width, shown.height, width, height);
    }

    /**
     * Covers the screen with a texture of the given size, cropped to the
     * screen's shape and centred, as the static background is: never stretched.
     */
    static boolean coverTexture(Object graphics, Object identifier, int frameWidth, int frameHeight, int width, int height) {
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

    private static void start(final ClientSettings.Background kind, final File file, String choice) {
        stop();
        deleteForgotten();
        loadedFor = choice;
        problem = null;
        if (kind == ClientSettings.Background.VIDEO) {
            int[] wanted = variant();
            video = new PreparedVideo(file, wanted[0], wanted[1], wanted[2]);
            video.start();
            return;
        }
        final int mine = ++generation;
        Thread loader = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (kind == ClientSettings.Background.GIF) {
                        List<Frame> frames = readGif(file);
                        if (frames.isEmpty()) throw new IllegalStateException("no picture in the file");
                        // Read for a choice the player has since changed: dropped.
                        if (mine != generation) return;
                        if (frames.size() == 1) {
                            still = frames.get(0);
                        } else {
                            animated = new Animated(new MemorySource(frames, false), new MemorySource(frames, true), 1);
                        }
                    } else {
                        Frame image = readImage(file);
                        if (mine == generation) still = image;
                    }
                } catch (Throwable failure) {
                    problem = ClientText.of("Ce fichier ne peut pas être lu (" + failure.getClass().getSimpleName() + ").",
                        "This file cannot be read (" + failure.getClass().getSimpleName() + ").");
                    report("The menu background could not be read: " + failure);
                }
            }
        }, "kiza-menu-background");
        loader.setDaemon(true);
        loader.start();
    }

    private static void stop() {
        generation += 1;
        if (video != null) video.stop();
        video = null;
        if (sharpPlayer != null) sharpPlayer.stop();
        if (softPlayer != null) softPlayer.stop();
        sharpPlayer = null;
        softPlayer = null;
        lastDrawn = null;
        clock = null;
        Animated moving = animated;
        animated = null;
        if (moving != null) {
            moving.sharp.close();
            moving.soft.close();
        }
        still = null;
        loadedFor = null;
        shown = null;
        texture = null;
        blurredShown = null;
        blurredTexture = null;
    }

    private static final java.util.concurrent.ConcurrentLinkedQueue<File> FORGOTTEN = new java.util.concurrent.ConcurrentLinkedQueue<File>();

    /**
     * A background file replaced by another: deleted with any frames made
     * from it, once what played it has let go of it -- on Windows an open
     * file cannot be deleted.
     */
    static void forget(File file) {
        FORGOTTEN.add(file);
    }

    private static void deleteForgotten() {
        for (File file = FORGOTTEN.poll(); file != null; file = FORGOTTEN.poll()) deleteWithFrames(file);
    }

    private static void deleteWithFrames(File file) {
        File[] siblings = file.getParentFile() == null ? null : file.getParentFile().listFiles();
        if (siblings != null) {
            for (File sibling : siblings) {
                if (sibling.isDirectory() && (sibling.getName().startsWith(file.getName() + ".kiza-")
                    || sibling.getName().startsWith(file.getName() + ".frames"))) {
                    PreparedVideo.delete(sibling);
                }
            }
        }
        if (file.isFile() && !file.delete()) file.deleteOnExit();
    }

    /** A failure said once in the log, however many frames ask again. */
    private static String lastReported;

    static void report(String message) {
        if (message.equals(lastReported)) return;
        lastReported = message;
        System.err.println("[Kiza Client] " + message);
    }

    /**
     * What a video is prepared at: the tallest frame, the most frames a
     * second, and the decoding threads -- from the settings, and for
     * "automatic" from the screen and the machine. Performance mode is 720p
     * at 30, one thread.
     */
    static int[] variant() {
        int cores = Runtime.getRuntime().availableProcessors();
        if (ClientSettings.videoPerformance()) return new int[] {720, 30, 1};
        int height;
        switch (ClientSettings.videoQuality()) {
            case P720:
                height = 720;
                break;
            case P1080:
                height = 1080;
                break;
            case P1440:
                height = 1440;
                break;
            default:
                int screen = MenuInput.screenHeight();
                height = cores < 4 ? 720 : screen > 1200 ? 1440 : screen > 0 && screen <= 800 ? 720 : 1080;
                break;
        }
        int fps;
        switch (ClientSettings.videoFps()) {
            case F30:
                fps = 30;
                break;
            case F60:
                fps = 60;
                break;
            default:
                fps = cores < 4 ? 30 : 60;
                break;
        }
        // Measured: 1440p at 60 kept 93 % of frames on time with two
        // decoders and 97 % with three.
        int threads = cores < 4 ? 1 : height >= 1440 && fps >= 60 && cores >= 8 ? 3 : 2;
        return new int[] {height, fps, threads};
    }

    // ---- Images and GIFs ------------------------------------------------------

    private static Frame readImage(File file) throws Exception {
        BufferedImage image = ImageIO.read(file);
        if (image == null) throw new IllegalStateException("not an image Java can open");
        Frame frame = frame(fit(image, MAX_WIDTH, MAX_HEIGHT), 0, false);
        frame.blurred = frame(blur(fit(image, BLUR_WIDTH, BLUR_HEIGHT)), 0, true);
        return frame;
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
                Frame frame = frame(fit(canvas, GIF_WIDTH, GIF_HEIGHT), millis, true);
                frame.blurred = frame(blur(fit(canvas, BLUR_WIDTH, BLUR_HEIGHT)), millis, true);
                bytes += frame.png.length + frame.blurred.png.length;
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
     * A light blur, the menus' version of the picture: half the size it is
     * given, three box passes, drawn back up smoothly by the game. Small on
     * purpose -- a blur hides detail, so there is no detail worth the pixels.
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

    /**
     * At most {@code maxWidth} by {@code maxHeight}, opaque, keeping the
     * picture's shape. Larger pictures are halved until close, then drawn
     * once more: bilinear on its own skips pixels past a factor of two, which
     * is what makes a reduced photo shimmer and look coarse.
     */
    static BufferedImage fit(BufferedImage image, int maxWidth, int maxHeight) {
        double scale = Math.min(1D, Math.min(maxWidth / (double) image.getWidth(), maxHeight / (double) image.getHeight()));
        int targetWidth = Math.max(1, (int) Math.round(image.getWidth() * scale));
        int targetHeight = Math.max(1, (int) Math.round(image.getHeight() * scale));
        BufferedImage current = image;
        while (current.getWidth() / 2 >= targetWidth && current.getHeight() / 2 >= targetHeight) {
            current = scaled(current, current.getWidth() / 2, current.getHeight() / 2);
        }
        if (current.getWidth() == targetWidth && current.getHeight() == targetHeight && current.getType() == BufferedImage.TYPE_INT_RGB) {
            return current;
        }
        return scaled(current, targetWidth, targetHeight);
    }

    private static BufferedImage scaled(BufferedImage image, int width, int height) {
        BufferedImage out = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.drawImage(image, 0, 0, width, height, null);
        g.dispose();
        return out;
    }

    /** A frame as PNG; {@code compress} trades encoding time for memory. */
    static Frame frame(BufferedImage image, long millis, boolean compress) throws Exception {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream(image.getWidth() * image.getHeight());
        javax.imageio.ImageWriter writer = ImageIO.getImageWritersByFormatName("png").next();
        javax.imageio.ImageWriteParam param = writer.getDefaultWriteParam();
        if (!compress && param.canWriteCompressed()) {
            // A still is encoded once and uploaded once: the fastest encoding.
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

    /** A GIF's frames, held as PNGs in memory, for the player. */
    private static final class MemorySource implements FramePlayer.Source {
        private final List<Frame> frames;
        private final long[] starts;
        private final long duration;
        private final int width;
        private final int height;

        MemorySource(List<Frame> all, boolean blurred) {
            frames = new ArrayList<Frame>();
            for (Frame frame : all) frames.add(blurred ? frame.blurred : frame);
            starts = new long[frames.size()];
            long at = 0L;
            for (int index = 0; index < frames.size(); index += 1) {
                starts[index] = at;
                at += frames.get(index).millis * 1000L;
            }
            duration = Math.max(1L, at);
            width = frames.get(0).width;
            height = frames.get(0).height;
        }

        @Override
        public int count() {
            return frames.size();
        }

        @Override
        public int width() {
            return width;
        }

        @Override
        public int height() {
            return height;
        }

        @Override
        public long start(int index) {
            return starts[index];
        }

        @Override
        public long duration() {
            return duration;
        }

        @Override
        public ByteBuffer read(int index, ByteBuffer reuse) {
            byte[] png = frames.get(index).png;
            ByteBuffer buffer = reuse != null && reuse.capacity() >= png.length ? reuse : ByteBuffer.allocateDirect(png.length + (png.length >> 2));
            buffer.clear();
            buffer.put(png);
            buffer.flip();
            return buffer;
        }

        @Override
        public void close() {
            // Held in memory: the collector has it.
        }
    }

    // ---- Video ----------------------------------------------------------------

    /**
     * A video's prepared frames, read from their pack: one file, one channel
     * shared by the workers, each frame read where the index says it is.
     */
    private static final class PackSource implements FramePlayer.Source {
        private final FileChannel channel;
        private final long[] starts;
        private final long[] offsets;
        private final int[] lengths;
        private final long duration;
        private final int width;
        private final int height;

        PackSource(File pack, long[] starts, long[] offsets, int[] lengths, long duration, int width, int height) throws IOException {
            this.channel = new java.io.RandomAccessFile(pack, "r").getChannel();
            this.starts = starts;
            this.offsets = offsets;
            this.lengths = lengths;
            this.duration = duration;
            this.width = width;
            this.height = height;
        }

        @Override
        public int count() {
            return starts.length;
        }

        @Override
        public int width() {
            return width;
        }

        @Override
        public int height() {
            return height;
        }

        @Override
        public long start(int index) {
            return starts[index];
        }

        @Override
        public long duration() {
            return duration;
        }

        @Override
        public ByteBuffer read(int index, ByteBuffer reuse) throws IOException {
            int length = lengths[index];
            ByteBuffer buffer = reuse != null && reuse.capacity() >= length ? reuse : ByteBuffer.allocateDirect(length + (length >> 1));
            buffer.clear();
            buffer.limit(length);
            long at = offsets[index];
            while (buffer.hasRemaining()) {
                int read = channel.read(buffer, at);
                if (read < 0) throw new IOException("the frames end early");
                at += read;
            }
            buffer.flip();
            return buffer;
        }

        @Override
        public void close() {
            try {
                channel.close();
            } catch (IOException ignored) {
                // Nothing more to do.
            }
        }
    }

    /**
     * A video as the menu plays it: prepared once into JPEG frames beside the
     * file, at the quality and frame rate chosen, then played from them. A
     * change of either prepares it again; the frames of the old choice are
     * deleted once the new ones are whole.
     */
    private static final class PreparedVideo {
        /**
         * One preparation at a time. A choice changed while one runs stops it,
         * and the next waits for it to let go of its files rather than meet
         * it in the same folder.
         */
        private static final Object PREPARING = new Object();
        private final File source;
        private final File frames;
        private final int maxHeight;
        private final int maxFps;
        private final int threads;
        private volatile boolean running = true;
        /** How far the preparation is, 0 to 1, or below 0 when there is none. */
        volatile float preparing = -1F;

        PreparedVideo(File source, int maxHeight, int maxFps, int threads) {
            this.source = source;
            this.maxHeight = maxHeight;
            this.maxFps = maxFps;
            this.threads = threads;
            this.frames = new File(source.getParentFile(), source.getName() + ".kiza-" + maxHeight + "p" + maxFps);
        }

        void start() {
            Thread thread = new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Animated ready = open();
                        if (ready == null) {
                            synchronized (PREPARING) {
                                if (!running) return;
                                prepare();
                            }
                            if (!running) return;
                            ready = open();
                            if (ready == null) throw new IllegalStateException("the prepared frames cannot be read");
                        }
                        if (!running) {
                            ready.sharp.close();
                            ready.soft.close();
                            return;
                        }
                        animated = ready;
                    } catch (Throwable failure) {
                        if (!running) return;
                        problem = failure instanceof ClassNotFoundException
                            ? ClientText.of("La vidéo n'est pas disponible sur cette version de Minecraft.",
                                "Video is not available on this version of Minecraft.")
                            : ClientText.of("Cette vidéo ne peut pas être lue : seul le MP4 en H.264 est pris en charge.",
                                "This video cannot be played: only H.264 MP4 is supported.");
                        report("The menu video could not be prepared: " + failure);
                    } finally {
                        preparing = -1F;
                    }
                }
            }, "kiza-menu-video");
            thread.setDaemon(true);
            thread.start();
        }

        void stop() {
            running = false;
        }

        /** The frames from before, if they were made from this very file, at this quality. */
        private Animated open() {
            java.util.Properties values = new java.util.Properties();
            java.io.InputStream input = null;
            try {
                input = new java.io.FileInputStream(new File(frames, "index.properties"));
                values.load(input);
            } catch (IOException unreadable) {
                return null;
            } finally {
                close(input);
            }
            if (!String.valueOf(source.length()).equals(values.getProperty("source.size"))
                || !String.valueOf(source.lastModified()).equals(values.getProperty("source.modified"))
                || !"2".equals(values.getProperty("format"))) {
                return null;
            }
            DataInputStream index = null;
            try {
                int width = Integer.parseInt(values.getProperty("width"));
                int height = Integer.parseInt(values.getProperty("height"));
                int softWidth = Integer.parseInt(values.getProperty("blur.width"));
                int softHeight = Integer.parseInt(values.getProperty("blur.height"));
                long duration = Long.parseLong(values.getProperty("duration.micros"));
                index = new DataInputStream(new java.io.BufferedInputStream(new java.io.FileInputStream(new File(frames, "frames.idx"))));
                if (index.readInt() != 0x4B5A4656 || index.readInt() != 2) return null;
                int count = index.readInt();
                if (count <= 0 || count > 100_000) return null;
                long[] starts = new long[count];
                long[] offsets = new long[count];
                int[] lengths = new int[count];
                long[] softOffsets = new long[count];
                int[] softLengths = new int[count];
                for (int frame = 0; frame < count; frame += 1) {
                    starts[frame] = index.readLong();
                    offsets[frame] = index.readLong();
                    lengths[frame] = index.readInt();
                    softOffsets[frame] = index.readLong();
                    softLengths[frame] = index.readInt();
                }
                return new Animated(
                    new PackSource(new File(frames, "frames.bin"), starts, offsets, lengths, duration, width, height),
                    new PackSource(new File(frames, "blur.bin"), starts, softOffsets, softLengths, duration, softWidth, softHeight),
                    threads
                );
            } catch (IOException | RuntimeException damaged) {
                return null;
            } finally {
                close(index);
            }
        }

        /** Makes the frames, into a folder of its own that only replaces the old one once whole. */
        private void prepare() throws Exception {
            preparing = 0F;
            settle();
            if (!running) return;
            // Whatever an earlier run left half made: under the lock, no
            // preparation is using it.
            forgetUnfinished();
            File staging = new File(frames.getParentFile(), frames.getName() + ".part-" + Long.toString(System.nanoTime(), 36));
            java.lang.reflect.Method prepare = Class.forName("fr.kiza.basemod.menu.VideoPreparation")
                .getMethod("prepare", File.class, File.class, int.class, int.class, VideoProgress.class);
            try {
                prepare.invoke(null, source, staging, maxHeight, maxFps, new VideoProgress() {
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
                delete(staging);
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
            System.out.println("[Kiza Client] Menu video prepared: " + values.getProperty("frames") + " frames at "
                + values.getProperty("width") + "x" + values.getProperty("height") + ", "
                + values.getProperty("colour") + ", in " + values.getProperty("prepared.seconds") + " s.");
            forgetOthers();
        }

        /**
         * Waits until the file has not changed for a second: a video still
         * being copied in by something else is not prepared half written.
         */
        private void settle() throws InterruptedException {
            while (running) {
                if (System.currentTimeMillis() - source.lastModified() > 1000L) return;
                Thread.sleep(250L);
            }
        }

        private void forgetUnfinished() {
            File[] siblings = source.getParentFile().listFiles();
            if (siblings == null) return;
            for (File sibling : siblings) {
                if (sibling.isDirectory() && sibling.getName().startsWith(source.getName() + ".kiza-") && sibling.getName().contains(".part")) {
                    delete(sibling);
                }
            }
        }

        /** The frames of any other choice or older format, beside this video: they would only take disk. */
        private void forgetOthers() {
            File[] siblings = source.getParentFile().listFiles();
            if (siblings == null) return;
            for (File sibling : siblings) {
                String name = sibling.getName();
                if (!sibling.isDirectory() || sibling.equals(frames)) continue;
                if (name.startsWith(source.getName() + ".kiza-") || name.equals(source.getName() + ".frames")
                    || name.equals(source.getName() + ".frames.part")) {
                    delete(sibling);
                }
            }
        }

        private static void close(java.io.Closeable closeable) {
            if (closeable == null) return;
            try {
                closeable.close();
            } catch (IOException ignored) {
                // Nothing more to do.
            }
        }

        static void delete(File file) {
            if (file.isDirectory()) {
                File[] children = file.listFiles();
                if (children != null) {
                    for (File child : children) delete(child);
                }
            }
            if (file.exists()) file.delete();
        }
    }
}
