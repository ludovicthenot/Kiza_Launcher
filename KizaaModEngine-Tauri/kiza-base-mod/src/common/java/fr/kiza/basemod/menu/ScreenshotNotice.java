package fr.kiza.basemod.menu;

import fr.kiza.basemod.render.KizaCanvas;
import fr.kiza.basemod.render.KizaText;
import java.awt.AlphaComposite;
import java.awt.Color;
import java.awt.Font;
import java.awt.FontMetrics;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.File;
import java.util.HashSet;
import java.util.Set;
import javax.imageio.ImageIO;

/**
 * A small card over the game when a screenshot is saved: the picture, and
 * where to find it -- the launcher's Screenshots, for this instance.
 *
 * <p>Minecraft saves F2's pictures to {@code screenshots} in the game folder,
 * which is the working directory the launcher starts the game in. A thread of
 * its own looks there twice a second, waits for a new picture to be written
 * whole, and paints the card, its thumbnail made from the picture, off the
 * render thread. The render thread only sends the card up, once, and moves it.
 *
 * <p>It slides in from past the right edge on a critically damped spring,
 * stays three seconds, and slides back the way it came, gathering speed:
 * where it came from is where it goes, and it needs no transparency, so it
 * moves the same on every version. Only over the game itself, never in
 * a menu, and not at all with the switch for it off.
 */
public final class ScreenshotNotice {
    private static final long LOOK_EVERY_MILLIS = 500L;
    private static final float HOLD_SECONDS = 3.2F;
    private static final float LEAVE_SECONDS = 0.28F;
    /** A card that could not be shown within this long is for a moment long gone. */
    private static final long STALE_NANOS = 6_000_000_000L;
    private static final int MARGIN = 8;

    private static boolean watching;
    /** The newest card, painted and waiting, and when its picture was found. */
    private static volatile BufferedImage waiting;
    private static volatile long foundAt;

    private static Object texture;
    private static int width;
    private static int height;
    private static long shownAt;
    /** How far out the card is, 0 hidden past the edge to 1 in place, and how fast it is going. */
    private static float slide;
    private static float speed;
    /** Where it was last drawn: a card arriving while another leaves starts from there. */
    private static float drawnAt;
    private static long lastFrame;

    private ScreenshotNotice() {}

    /** Over the HUD, each frame of play: the card, if one is due. */
    public static void render(Object graphics, int screenWidth, int screenHeight) {
        watch();
        long now = System.nanoTime();
        BufferedImage card = waiting;
        if (card != null) {
            waiting = null;
            if (now - foundAt < STALE_NANOS && ClientSettings.flag("menu.screenshot-notice")) {
                Object uploaded = KizaCanvas.upload("screenshot_notice", card);
                if (uploaded != null) {
                    texture = uploaded;
                    int scale = Buttons.supersample();
                    width = card.getWidth() / scale;
                    height = card.getHeight() / scale;
                    shownAt = now;
                    lastFrame = now;
                    // A card still out is taken over where it is, not sent back first.
                    slide = drawnAt;
                    speed = 0F;
                }
            }
        }
        if (texture == null || shownAt == 0L) return;
        float t = (now - shownAt) / 1e9F;
        float dt = Math.min(0.1F, (now - lastFrame) / 1e9F);
        lastFrame = now;
        if (t > HOLD_SECONDS + LEAVE_SECONDS) {
            shownAt = 0L;
            slide = 0F;
            drawnAt = 0F;
            return;
        }
        float out;
        if (t < HOLD_SECONDS) {
            // In: a spring toward fully out, from wherever it is.
            double omega = 2D * Math.PI / 0.45D;
            double offset = slide - 1D;
            double decay = Math.exp(-omega * dt);
            double carried = speed + omega * offset;
            slide = (float) (1D + (offset + carried * dt) * decay);
            speed = (float) ((speed - carried * omega * dt) * decay);
            out = slide;
        } else {
            // Away the way it came, gathering speed.
            float leaving = Math.min(1F, (t - HOLD_SECONDS) / LEAVE_SECONDS);
            out = slide * (1F - leaving * leaving);
        }
        drawnAt = out;
        int x = Math.round(screenWidth - (width + MARGIN) * out);
        int y = screenHeight - height - MARGIN;
        int scale = Buttons.supersample();
        fr.kiza.basemod.MenuLogoRenderer.blitTexture(graphics, texture, x, y, width, height, width * scale, height * scale);
    }

    // ---- Watching -----------------------------------------------------------------

    private static synchronized void watch() {
        if (watching) return;
        watching = true;
        Thread watcher = new Thread(ScreenshotNotice::lookWhilePlaying, "kiza-screenshot-notice");
        watcher.setDaemon(true);
        watcher.setPriority(Thread.MIN_PRIORITY);
        watcher.start();
    }

    private static void lookWhilePlaying() {
        File folder = new File(System.getProperty("user.dir", "."), "screenshots");
        // What is there already was seen before: only what comes after is news.
        Set<String> seen = new HashSet<String>(names(folder));
        File writing = null;
        long writingSize = -1L;
        try {
            while (true) {
                Thread.sleep(LOOK_EVERY_MILLIS);
                if (writing != null) {
                    // Whole once its size holds between two looks.
                    long size = writing.length();
                    if (size > 0L && size == writingSize) {
                        announce(writing);
                        writing = null;
                    } else {
                        writingSize = size;
                    }
                    continue;
                }
                for (String name : names(folder)) {
                    if (!seen.add(name)) continue;
                    writing = new File(folder, name);
                    writingSize = -1L;
                }
            }
        } catch (InterruptedException stop) {
            // The game is closing.
        }
    }

    private static Set<String> names(File folder) {
        Set<String> found = new HashSet<String>();
        String[] names = folder.list();
        if (names == null) return found;
        for (String name : names) {
            String lower = name.toLowerCase(java.util.Locale.ROOT);
            if (lower.endsWith(".png") || lower.endsWith(".jpg")) found.add(name);
        }
        return found;
    }

    private static void announce(File picture) {
        try {
            BufferedImage shot = ImageIO.read(picture);
            if (shot == null) return;
            waiting = paint(shot);
            foundAt = System.nanoTime();
        } catch (Exception | LinkageError unreadable) {
            // A picture that cannot be read gets no card; the game said where it is.
        }
    }

    // ---- The card -----------------------------------------------------------------

    /** The card at the menu's supersampling: the picture, the words, on Kiza's dark glass. */
    static BufferedImage paint(BufferedImage shot) {
        int scale = Buttons.supersample();
        String title = ClientText.get("kiza.screenshot.saved");
        String where = ClientText.get("kiza.screenshot.where");
        Font bold = KizaText.covering(Buttons.labelFont(9 * scale), title);
        Font plain = KizaText.covering(Buttons.plainFont(7 * scale), where);
        BufferedImage probe = new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB);
        Graphics2D measure = probe.createGraphics();
        Buttons.quality(measure);
        int textWidth = Math.max(
            (int) Math.ceil(bold.getStringBounds(title, measure.getFontRenderContext()).getWidth()),
            (int) Math.ceil(plain.getStringBounds(where, measure.getFontRenderContext()).getWidth())
        );
        measure.dispose();

        int pad = 4 * scale;
        int thumbHeight = 32 * scale;
        int thumbWidth = thumbHeight * 16 / 9;
        int w = Math.min(260 * scale, pad + thumbWidth + 7 * scale + textWidth + 8 * scale);
        int h = thumbHeight + pad * 2;
        BufferedImage card = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = card.createGraphics();
        Buttons.quality(g);
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);

        float radius = 9F * scale;
        RoundRectangle2D outline = new RoundRectangle2D.Float(0, 0, w, h, radius * 2F, radius * 2F);
        g.setColor(new Color(0xE81B1B21, true));
        g.fill(outline);
        // The edge catching the light along its top, as the settings' sheet has it.
        g.setColor(new Color(0x24FFFFFF, true));
        g.setStroke(new java.awt.BasicStroke(scale));
        g.draw(new RoundRectangle2D.Float(scale / 2F, scale / 2F, w - scale, h - scale, radius * 2F, radius * 2F));

        // The picture, filling its frame, rounded.
        BufferedImage thumb = new BufferedImage(thumbWidth, thumbHeight, BufferedImage.TYPE_INT_ARGB);
        Graphics2D tg = thumb.createGraphics();
        tg.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        tg.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        tg.fill(new RoundRectangle2D.Float(0, 0, thumbWidth, thumbHeight, 6F * scale, 6F * scale));
        tg.setComposite(AlphaComposite.SrcIn);
        double cover = Math.max(thumbWidth / (double) shot.getWidth(), thumbHeight / (double) shot.getHeight());
        int drawnWidth = (int) Math.ceil(shot.getWidth() * cover);
        int drawnHeight = (int) Math.ceil(shot.getHeight() * cover);
        tg.drawImage(shrunk(shot, drawnWidth, drawnHeight), (thumbWidth - drawnWidth) / 2, (thumbHeight - drawnHeight) / 2, null);
        tg.dispose();
        g.drawImage(thumb, pad, pad, null);

        int textX = pad + thumbWidth + 7 * scale;
        g.setFont(bold);
        g.setColor(new Color(0xFFF2F0F7, true));
        int middle = h / 2;
        g.drawString(title, textX, middle - scale);
        g.setFont(plain);
        FontMetrics plainMetrics = g.getFontMetrics();
        g.setColor(new Color(0xFFA9A4B8, true));
        g.drawString(where, textX, middle + plainMetrics.getAscent() + scale);
        g.dispose();
        return card;
    }

    /** The picture made smaller in halves, then once: a big step down at once would shimmer. */
    private static BufferedImage shrunk(BufferedImage picture, int width, int height) {
        BufferedImage step = picture;
        while (step.getWidth() / 2 >= width && step.getHeight() / 2 >= height) {
            BufferedImage half = new BufferedImage(step.getWidth() / 2, step.getHeight() / 2, BufferedImage.TYPE_INT_RGB);
            Graphics2D h = half.createGraphics();
            h.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            h.drawImage(step, 0, 0, half.getWidth(), half.getHeight(), null);
            h.dispose();
            step = half;
        }
        return step;
    }
}
