package fr.kiza.basemod.menu;

import fr.kiza.basemod.render.KizaCanvas;
import fr.kiza.basemod.render.KizaGlass;
import fr.kiza.basemod.render.KizaText;
import java.awt.AlphaComposite;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.FontMetrics;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.font.TextAttribute;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * The Kiza menu button, and the wordmark above the buttons.
 *
 * <p>A button is painted whole in Java2D -- the dark surface, the rim, the
 * accent that fills it under the pointer, the icon and the spaced capitals --
 * and handed to Minecraft as one texture. Minecraft's own text is a bitmap
 * font that cannot be spaced or smoothed, and the look depends on both.
 *
 * <p>{@link #paint} is pure Java2D and knows nothing of the game, so the menu
 * preview draws exactly what the game draws. {@link #texture} is the same
 * picture uploaded and cached; what changes with time arrives here already
 * cut into steps by {@link Animations}, so the cache holds a handful of
 * pictures per button rather than one per frame.
 */
public final class Buttons {
    private Buttons() {}

    /** Steps a hover is drawn in, and steps an arrival fades in. */
    public static final int HOVER_STEPS = 8;
    public static final int FADE_STEPS = 6;
    /** Positions of the light crossing the emblem. */
    public static final int SWEEP_STEPS = 12;
    /** Room around the emblem for its halo, in GUI pixels. */
    public static final int EMBLEM_GLOW = 10;

    private static final int MAX_CACHED = 160;
    private static final Map<String, Object> CACHE =
        new LinkedHashMap<String, Object>(32, 0.75F, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, Object> eldest) {
                return size() > MAX_CACHED;
            }
        };

    /**
     * The button as a texture identifier to blit, or null where the game
     * cannot take one -- the caller then leaves Minecraft's button showing.
     */
    public static Object texture(
        String label,
        MenuDesign.Role role,
        int width,
        int height,
        int hoverStep,
        int fadeStep
    ) {
        return texture(label, role, width, height, hoverStep, fadeStep, true);
    }

    /** The same, dimmed when the button cannot be pressed. */
    public static Object texture(
        String label,
        MenuDesign.Role role,
        int width,
        int height,
        int hoverStep,
        int fadeStep,
        boolean enabled
    ) {
        if (KizaCanvas.isUnavailable() || width <= 0 || height <= 0) return null;
        String key = "b|" + label + "|" + role + "|" + width + "x" + height + "|" + hoverStep + "|"
            + fadeStep + "|" + enabled;
        Object cached = CACHE.get(key);
        if (cached != null) return cached;
        BufferedImage image = paint(
            label,
            role,
            width,
            height,
            hoverStep / (float) HOVER_STEPS,
            fadeStep / (float) FADE_STEPS,
            supersample(),
            enabled
        );
        Object identifier = KizaCanvas.upload("menu_" + Integer.toHexString(key.hashCode()), image);
        if (identifier != null) CACHE.put(key, identifier);
        return identifier;
    }

    /** Image pixels per GUI pixel, shared with the rest of Kiza's surfaces. */
    public static int supersample() {
        return KizaGlass.supersample();
    }

    /**
     * Paints one button.
     *
     * @param hover how far the accent has filled it, 0 to 1
     * @param alpha how far it has faded in, 0 to 1
     */
    public static BufferedImage paint(
        String label,
        MenuDesign.Role role,
        int width,
        int height,
        float hover,
        float alpha,
        int scale
    ) {
        return paint(label, role, width, height, hover, alpha, scale, true);
    }

    /** @param enabled false draws the button greyed, as vanilla does one that cannot be pressed */
    public static BufferedImage paint(
        String label,
        MenuDesign.Role role,
        int width,
        int height,
        float hover,
        float alpha,
        int scale,
        boolean enabled
    ) {
        int w = width * scale;
        int h = height * scale;
        BufferedImage image = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        quality(g);

        float radius = MenuDesign.RADIUS * scale * 2F;
        RoundRectangle2D.Float shape = new RoundRectangle2D.Float(0, 0, w, h, radius, radius);

        // The surface, then the accent poured over it.
        g.setColor(new Color(MenuDesign.SURFACE, true));
        g.fill(shape);
        if (hover > 0F) {
            g.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, hover));
            g.setPaint(new GradientPaint(
                0, 0, new Color(MenuDesign.ACCENT_FROM, true),
                w, 0, new Color(MenuDesign.ACCENT_TO, true)
            ));
            g.fill(shape);
            g.setComposite(AlphaComposite.SrcOver);
        }

        // The rim: an edge catching light along the top and losing it below.
        // Brighter under the pointer, where the surface comes forward.
        int rimTop = MenuDesign.mix(MenuDesign.EDGE, 0x66FFFFFF, hover);
        int rimBottom = (Math.max(0, (rimTop >>> 24) / 3) << 24) | (rimTop & 0xFFFFFF);
        float line = Math.max(1F, scale * 0.75F);
        g.setStroke(new BasicStroke(line));
        g.setPaint(new GradientPaint(
            0, 0, new Color(rimTop, true),
            0, h, new Color(rimBottom, true)
        ));
        g.draw(new RoundRectangle2D.Float(line / 2F, line / 2F, w - line, h - line, radius, radius));

        // What it says, and what it is.
        String text = label == null ? "" : label.trim().toUpperCase(Locale.ROOT);
        int textColour = enabled
            ? MenuDesign.mix(MenuDesign.TEXT_SOFT, 0xFFFFFFFF, hover)
            : MenuDesign.TEXT_DISABLED;
        boolean withIcon = MenuIcons.has(role);
        int iconSize = MenuDesign.ICON_SIZE * scale;
        int iconGap = withIcon ? MenuDesign.ICON_GAP * scale : 0;

        int room = w - 8 * scale - (withIcon ? iconSize + iconGap : 0);
        // The spacing gives way before the words do: a settings button that
        // says "RENDER DISTANCE: 12" has to fit a half-width button, and losing
        // the letter spacing costs less than losing the number.
        Font base = labelFont(MenuDesign.LABEL_SIZE * scale);
        Font font = spaced(base, MenuDesign.LABEL_TRACKING);
        if (g.getFontMetrics(font).stringWidth(text) > room) font = spaced(base, 0.05F);
        if (g.getFontMetrics(font).stringWidth(text) > room) font = spaced(base, 0F);
        text = fitted(g, font, text, room);
        g.setFont(font);
        FontMetrics metrics = g.getFontMetrics();
        int textWidth = text.isEmpty() ? 0 : metrics.stringWidth(text);
        int group = textWidth + (withIcon ? iconSize + iconGap : 0);
        int x = (w - group) / 2;
        if (withIcon) {
            MenuIcons.draw(g, role, x, (h - iconSize) / 2, iconSize, new Color(textColour, true), scale);
            x += iconSize + iconGap;
        }
        if (!text.isEmpty()) {
            // Centred on the capitals, not on the line: the spaced capitals
            // have no descenders, and centring the line box sat them high.
            int capital = Math.round(metrics.getAscent() * 0.72F);
            int baseline = (h + capital) / 2;
            g.setColor(new Color(textColour, true));
            g.drawString(text, x, baseline);
        }
        g.dispose();

        if (alpha < 1F) fade(image, alpha);
        return image;
    }

    /**
     * Paints KIZA CLIENT: spaced, bold, white, on a soft shadow so it holds
     * over a bright sky as well as a night.
     */
    public static BufferedImage paintWordmark(int scale, float alpha) {
        Font font = spaced(labelFont(MenuDesign.WORDMARK_SIZE * scale), MenuDesign.WORDMARK_TRACKING);
        BufferedImage probe = new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB);
        Graphics2D measure = probe.createGraphics();
        measure.setFont(font);
        FontMetrics metrics = measure.getFontMetrics();
        int textWidth = metrics.stringWidth(MenuDesign.WORDMARK);
        measure.dispose();

        int pad = 3 * scale;
        int w = textWidth + pad * 2;
        int h = MenuDesign.WORDMARK_SIZE * scale + pad * 2;
        BufferedImage image = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        quality(g);
        g.setFont(font);
        int capital = Math.round(metrics.getAscent() * 0.72F);
        int baseline = (h + capital) / 2;
        // The shadow, a few soft passes rather than one hard one.
        for (int ring = 3; ring >= 1; ring -= 1) {
            g.setColor(new Color(0, 0, 0, 28));
            int spread = ring * scale / 2;
            g.drawString(MenuDesign.WORDMARK, pad, baseline + spread);
            g.drawString(MenuDesign.WORDMARK, pad - spread, baseline);
            g.drawString(MenuDesign.WORDMARK, pad + spread, baseline);
        }
        g.setColor(new Color(MenuDesign.TEXT, true));
        g.drawString(MenuDesign.WORDMARK, pad, baseline);
        g.dispose();
        if (alpha < 1F) fade(image, alpha);
        return image;
    }

    private static final Map<String, Object> WORDMARKS = new HashMap<String, Object>();
    private static final Map<String, int[]> WORDMARK_SIZES = new HashMap<String, int[]>();

    /** The wordmark texture and its size in GUI pixels, or null. */
    public static Object wordmark(int fadeStep, int[] sizeOut) {
        if (KizaCanvas.isUnavailable()) return null;
        String key = "w|" + fadeStep;
        Object cached = WORDMARKS.get(key);
        if (cached == null) {
            int scale = supersample();
            BufferedImage image = paintWordmark(scale, fadeStep / (float) FADE_STEPS);
            cached = KizaCanvas.upload("menu_wordmark_" + fadeStep, image);
            if (cached == null) return null;
            WORDMARKS.put(key, cached);
            WORDMARK_SIZES.put(key, new int[] {image.getWidth(), image.getHeight()});
        }
        int[] size = WORDMARK_SIZES.get(key);
        if (sizeOut != null && size != null) {
            sizeOut[0] = size[0];
            sizeOut[1] = size[1];
        }
        return cached;
    }

    /**
     * The emblem as a texture: the logo, the violet halo behind it, and the
     * light crossing it, at this size and step. Null where the game cannot
     * take a texture.
     */
    public static Object emblem(int size, int fadeStep, int glowStep, int sweepStep) {
        if (KizaCanvas.isUnavailable() || size <= 0) return null;
        String key = "e|" + size + "|" + fadeStep + "|" + glowStep + "|" + sweepStep;
        Object cached = CACHE.get(key);
        if (cached != null) return cached;
        BufferedImage source = emblemSource();
        if (source == null) return null;
        BufferedImage image = paintEmblem(
            source,
            size,
            supersample(),
            glowStep / (float) HOVER_STEPS,
            sweepStep == 0 ? -1F : (sweepStep - 1) / (float) (SWEEP_STEPS - 1),
            fadeStep / (float) FADE_STEPS
        );
        Object identifier = KizaCanvas.upload("menu_" + Integer.toHexString(key.hashCode()), image);
        if (identifier != null) CACHE.put(key, identifier);
        return identifier;
    }

    private static BufferedImage emblemSource;
    private static boolean emblemMissing;

    private static BufferedImage emblemSource() {
        if (emblemSource != null || emblemMissing) return emblemSource;
        try {
            java.io.InputStream stream = Buttons.class.getResourceAsStream(MenuDesign.EMBLEM);
            if (stream != null) {
                try {
                    emblemSource = javax.imageio.ImageIO.read(stream);
                } finally {
                    stream.close();
                }
            }
        } catch (Exception error) {
            emblemSource = null;
        }
        emblemMissing = emblemSource == null;
        return emblemSource;
    }

    /**
     * Paints the emblem with its halo and its light.
     *
     * @param glow  how strong the violet halo is, 0 to 1
     * @param sweep where the light is across the emblem, 0 to 1, or below 0 for none
     */
    public static BufferedImage paintEmblem(
        BufferedImage source,
        int size,
        int scale,
        float glow,
        float sweep,
        float alpha
    ) {
        int pad = EMBLEM_GLOW * scale;
        int inner = size * scale;
        int full = inner + pad * 2;

        // The logo alone, resampled once to the size it is drawn at.
        BufferedImage logo = new BufferedImage(inner, inner, BufferedImage.TYPE_INT_ARGB);
        Graphics2D lg = logo.createGraphics();
        quality(lg);
        lg.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        lg.drawImage(source, 0, 0, inner, inner, null);

        // The light: a slanted band of pale violet, laid only where the logo is.
        if (sweep >= 0F) {
            lg.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_ATOP, 1F));
            float band = inner * 0.16F;
            float centre = -band + sweep * (inner + band * 2);
            Color clear = new Color(MenuDesign.SHINE & 0xFFFFFF, true);
            Color bright = new Color(MenuDesign.SHINE, true);
            lg.setPaint(new java.awt.LinearGradientPaint(
                centre - band, 0, centre + band, inner * 0.35F,
                new float[] {0F, 0.5F, 1F},
                new Color[] {clear, bright, clear}
            ));
            lg.fillRect(0, 0, inner, inner);
            // And a violet wash under it, so the light reads as Kiza's colour.
            lg.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_ATOP, 0.55F));
            Color violet = new Color(MenuDesign.GLOW, true);
            Color none = new Color(MenuDesign.GLOW & 0xFFFFFF, true);
            lg.setPaint(new java.awt.LinearGradientPaint(
                centre - band * 1.6F, 0, centre + band * 1.6F, inner * 0.35F,
                new float[] {0F, 0.5F, 1F},
                new Color[] {none, violet, none}
            ));
            lg.fillRect(0, 0, inner, inner);
        }
        lg.dispose();

        BufferedImage image = new BufferedImage(full, full, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        quality(g);
        if (glow > 0F) {
            // The halo: the logo's own silhouette in violet, blurred at a
            // quarter of the size and drawn back up, which is cheap and soft.
            BufferedImage silhouette = tinted(logo, MenuDesign.GLOW);
            int small = Math.max(8, full / 4);
            BufferedImage halo = new BufferedImage(small, small, BufferedImage.TYPE_INT_ARGB);
            Graphics2D hg = halo.createGraphics();
            hg.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            int offset = pad * small / full;
            hg.drawImage(silhouette, offset, offset, small - offset * 2, small - offset * 2, null);
            hg.dispose();
            // Grown a little first, so the glow starts outside the edge
            // instead of being swallowed by the logo drawn over it.
            halo = blur(blur(halo, 1), 1);
            halo = spread(halo, 3F);
            int radius = Math.max(2, pad * small / full / 3);
            halo = blur(blur(halo, radius), radius);
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            g.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, Math.min(1F, glow)));
            g.drawImage(halo, 0, 0, full, full, null);
            g.drawImage(halo, 0, 0, full, full, null);
            g.drawImage(halo, 0, 0, full, full, null);
            g.setComposite(AlphaComposite.SrcOver);
        }
        g.drawImage(logo, pad, pad, null);
        g.dispose();
        if (alpha < 1F) fade(image, alpha);
        return image;
    }

    /** A box blur, across then down: soft enough for a halo, and cheap. */
    private static BufferedImage blur(BufferedImage image, int radius) {
        int size = radius * 2 + 1;
        float[] weights = new float[size];
        java.util.Arrays.fill(weights, 1F / size);
        java.awt.image.ConvolveOp across = new java.awt.image.ConvolveOp(
            new java.awt.image.Kernel(size, 1, weights), java.awt.image.ConvolveOp.EDGE_ZERO_FILL, null);
        java.awt.image.ConvolveOp down = new java.awt.image.ConvolveOp(
            new java.awt.image.Kernel(1, size, weights), java.awt.image.ConvolveOp.EDGE_ZERO_FILL, null);
        BufferedImage first = across.filter(image, null);
        return down.filter(first, null);
    }

    /** Every pixel's alpha multiplied and capped: a soft edge made bolder. */
    private static BufferedImage spread(BufferedImage image, float gain) {
        int[] pixels = image.getRGB(0, 0, image.getWidth(), image.getHeight(), null, 0, image.getWidth());
        for (int index = 0; index < pixels.length; index += 1) {
            int a = Math.min(255, Math.round((pixels[index] >>> 24) * gain));
            pixels[index] = (a << 24) | (pixels[index] & 0xFFFFFF);
        }
        image.setRGB(0, 0, image.getWidth(), image.getHeight(), pixels, 0, image.getWidth());
        return image;
    }

    /** The picture's shape, every pixel in one colour. */
    private static BufferedImage tinted(BufferedImage picture, int colour) {
        BufferedImage out = new BufferedImage(picture.getWidth(), picture.getHeight(), BufferedImage.TYPE_INT_ARGB);
        int[] pixels = picture.getRGB(0, 0, picture.getWidth(), picture.getHeight(), null, 0, picture.getWidth());
        int rgb = colour & 0xFFFFFF;
        for (int index = 0; index < pixels.length; index += 1) {
            pixels[index] = (pixels[index] & 0xFF000000) | rgb;
        }
        out.setRGB(0, 0, picture.getWidth(), picture.getHeight(), pixels, 0, picture.getWidth());
        return out;
    }

    /** The face Kiza's labels are set in, or the platform's own bold sans. */
    private static Font labelFont(int sizePx) {
        Font face = KizaText.face(sizePx, true);
        return face != null ? face : new Font(Font.SANS_SERIF, Font.BOLD, sizePx);
    }

    private static Font spaced(Font font, float tracking) {
        Map<TextAttribute, Object> attributes = new HashMap<TextAttribute, Object>();
        attributes.put(TextAttribute.TRACKING, tracking);
        return font.deriveFont(attributes);
    }

    /**
     * Shortens a label to its room: the spacing first, which costs nothing,
     * then the end of the word.
     */
    private static String fitted(Graphics2D g, Font font, String text, int room) {
        if (text.isEmpty() || room <= 0) return "";
        if (g.getFontMetrics(font).stringWidth(text) <= room) return text;
        String ellipsis = "...";
        int end = text.length();
        while (end > 0 && g.getFontMetrics(font).stringWidth(text.substring(0, end) + ellipsis) > room) {
            end -= 1;
        }
        return end == 0 ? "" : text.substring(0, end).trim() + ellipsis;
    }

    /** Multiplies every pixel's alpha, which fades the picture as one piece. */
    private static void fade(BufferedImage image, float alpha) {
        float a = Math.max(0F, Math.min(1F, alpha));
        int[] pixels = image.getRGB(0, 0, image.getWidth(), image.getHeight(), null, 0, image.getWidth());
        for (int index = 0; index < pixels.length; index += 1) {
            int pixel = pixels[index];
            int faded = Math.round((pixel >>> 24) * a);
            pixels[index] = (faded << 24) | (pixel & 0xFFFFFF);
        }
        image.setRGB(0, 0, image.getWidth(), image.getHeight(), pixels, 0, image.getWidth());
    }

    static void quality(Graphics2D g) {
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_FRACTIONALMETRICS, RenderingHints.VALUE_FRACTIONALMETRICS_ON);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
    }
}
