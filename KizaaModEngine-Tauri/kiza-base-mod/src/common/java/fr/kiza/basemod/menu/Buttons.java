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
    /** Steps a slider's position is drawn in. */
    public static final int SLIDER_STEPS = 100;

    /** A texture, and the name it was uploaded under. */
    private static final class Held {
        final Object identifier;
        final int slot;

        Held(Object identifier, int slot) {
            this.identifier = identifier;
            this.slot = slot;
        }
    }

    /**
     * Every texture Kiza's menu holds, by what it shows, least recently drawn
     * first.
     *
     * <p>Uploaded under one of {@link #MAX_CACHED} names and no more. A slider
     * dragged from 0 to 100 paints a hundred labels; with a fresh name each,
     * that was a hundred textures on the graphics card that nothing ever
     * released. Minecraft closes the texture a name held when the name is
     * registered again, so reusing the least recently drawn one's name gives
     * its memory back.
     */
    private static final LinkedHashMap<String, Held> CACHE = new LinkedHashMap<String, Held>(64, 0.75F, true);
    private static int nextSlot;

    /** Every picture depends on the accent, so the accent is part of every key. */
    private static String keyed(String key) {
        ClientSettings.Accent accent = ClientSettings.accent();
        // A custom accent is many colours under one name: the colour is the key.
        String name = accent == ClientSettings.Accent.CUSTOM
            ? "CUSTOM-" + Integer.toHexString(ClientSettings.customColour())
            : accent.name();
        return name + "|" + key;
    }

    static Object cached(String key) {
        return lookup(keyed(key));
    }

    static Object store(String key, BufferedImage image) {
        return storeAs(keyed(key), image);
    }

    /**
     * For a picture the accent does not colour: kept when the accent
     * changes. Dragging across the custom colour's palette changed it every
     * frame, and every picture of the menu was painted again each time --
     * 16 ms a frame where 4 sufficed, measured.
     */
    static Object cachedPlain(String key) {
        return lookup("plain|" + key);
    }

    static Object storePlain(String key, BufferedImage image) {
        return storeAs("plain|" + key, image);
    }

    private static Object lookup(String fullKey) {
        Held held = CACHE.get(fullKey);
        return held == null ? null : held.identifier;
    }

    private static Object storeAs(String fullKey, BufferedImage image) {
        int slot;
        if (CACHE.size() >= MAX_CACHED) {
            java.util.Iterator<Map.Entry<String, Held>> eldest = CACHE.entrySet().iterator();
            slot = eldest.next().getValue().slot;
            eldest.remove();
        } else {
            slot = nextSlot++;
        }
        Object identifier = KizaCanvas.upload("menu_" + slot, image);
        if (identifier != null) CACHE.put(fullKey, new Held(identifier, slot));
        return identifier;
    }

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
        return texture(label, role, width, height, hoverStep, fadeStep, enabled, 0);
    }

    /**
     * The same, its label in {@code labelColour} (RGB) rather than Kiza's
     * white: a mod's "True" in green and "Reset" in red keep saying so.
     * 0 is Kiza's own colour.
     */
    public static Object texture(
        String label,
        MenuDesign.Role role,
        int width,
        int height,
        int hoverStep,
        int fadeStep,
        boolean enabled,
        int labelColour
    ) {
        if (KizaCanvas.isUnavailable() || width <= 0 || height <= 0) return null;
        String key = "b|" + label + "|" + role + "|" + width + "x" + height + "|" + hoverStep + "|"
            + fadeStep + "|" + enabled + "|" + Integer.toHexString(labelColour);
        Object cached = cached(key);
        if (cached != null) return cached;
        BufferedImage image = paint(
            label,
            role,
            width,
            height,
            hoverStep / (float) HOVER_STEPS,
            fadeStep / (float) FADE_STEPS,
            supersample(),
            enabled,
            labelColour
        );
        return store(key, image);
    }

    /**
     * A slider as a texture: the surface, the part of it the value fills,
     * the handle, and the label over them.
     *
     * @param valueStep where the handle is, 0 to {@link #SLIDER_STEPS}
     */
    public static Object slider(
        String label,
        int width,
        int height,
        int valueStep,
        int hoverStep,
        boolean enabled
    ) {
        if (KizaCanvas.isUnavailable() || width <= 0 || height <= 0) return null;
        String key = "s|" + label + "|" + width + "x" + height + "|" + valueStep + "|" + hoverStep + "|" + enabled;
        Object cached = cached(key);
        if (cached != null) return cached;
        BufferedImage image = paintSlider(
            label,
            width,
            height,
            valueStep / (float) SLIDER_STEPS,
            hoverStep / (float) HOVER_STEPS,
            supersample(),
            enabled
        );
        return store(key, image);
    }

    /**
     * Paints one slider.
     *
     * <p>The value is the violet: it fills the surface from the left up to
     * the handle, so how far along a setting is reads at a glance, from across
     * the screen, before the number does. The handle is a thin pale line at
     * the end of the violet: thin, because the label runs across it, and a
     * bar wide enough to grab hid the letters under it.
     */
    public static BufferedImage paintSlider(
        String label,
        int width,
        int height,
        float value,
        float hover,
        int scale,
        boolean enabled
    ) {
        int w = width * scale;
        int h = height * scale;
        float v = Math.max(0F, Math.min(1F, value));
        BufferedImage image = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        quality(g);
        float radius = MenuDesign.RADIUS * scale * 2F;
        RoundRectangle2D.Float shape = new RoundRectangle2D.Float(0, 0, w, h, radius, radius);
        g.setColor(new Color(MenuDesign.SURFACE, true));
        g.fill(shape);

        // The filled part, clipped to the rounded surface.
        int handleWidth = Math.round((2F + hover) * scale);
        int handleX = Math.round(v * (w - handleWidth));
        if (enabled && handleX > 0) {
            java.awt.Shape before = g.getClip();
            g.clip(shape);
            g.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, 0.55F + hover * 0.3F));
            g.setPaint(new GradientPaint(
                0, 0, new Color(ClientSettings.accent().from, true),
                Math.max(1, handleX + handleWidth / 2F), 0, new Color(ClientSettings.accent().to, true)
            ));
            g.fillRect(0, 0, handleX + handleWidth / 2, h);
            g.setComposite(AlphaComposite.SrcOver);
            g.setClip(before);
        }

        // The rim, as on a button.
        int rimTop = MenuDesign.mix(MenuDesign.EDGE, 0x66FFFFFF, hover);
        int rimBottom = (Math.max(0, (rimTop >>> 24) / 3) << 24) | (rimTop & 0xFFFFFF);
        float line = Math.max(1F, scale * 0.75F);
        g.setStroke(new BasicStroke(line));
        g.setPaint(new GradientPaint(0, 0, new Color(rimTop, true), 0, h, new Color(rimBottom, true)));
        g.draw(new RoundRectangle2D.Float(line / 2F, line / 2F, w - line, h - line, radius, radius));

        // The handle.
        int inset = 2 * scale;
        int handleColour = enabled ? MenuDesign.mix(0xCCE9E4F7, 0xFFFFFFFF, hover) : 0x66A8A3B8;
        g.setColor(new Color(handleColour, true));
        g.fill(new RoundRectangle2D.Float(handleX, inset, handleWidth, h - inset * 2, handleWidth, handleWidth));

        // The label, over everything, with a soft shadow so it reads on the violet too.
        String text = label == null ? "" : label.trim().toUpperCase(Locale.ROOT);
        int room = w - 10 * scale;
        Font base = KizaText.covering(labelFont(MenuDesign.LABEL_SIZE * scale), text);
        Font font = spaced(base, MenuDesign.LABEL_TRACKING);
        if (g.getFontMetrics(font).stringWidth(text) > room) font = spaced(base, 0.05F);
        if (g.getFontMetrics(font).stringWidth(text) > room) font = spaced(base, 0F);
        text = fitted(g, font, text, room);
        if (!text.isEmpty()) {
            g.setFont(font);
            FontMetrics metrics = g.getFontMetrics();
            int x = (w - metrics.stringWidth(text)) / 2;
            int capital = Math.round(metrics.getAscent() * 0.72F);
            int baseline = (h + capital) / 2;
            // Two passes of shadow, so a letter crossing the handle or the
            // violet still has an edge.
            g.setColor(new Color(0, 0, 0, 110));
            g.drawString(text, x, baseline + Math.max(1, scale / 2));
            g.drawString(text, x + Math.max(1, scale / 2), baseline);
            g.setColor(new Color(enabled ? MenuDesign.mix(MenuDesign.TEXT_SOFT, 0xFFFFFFFF, hover) : MenuDesign.TEXT_DISABLED, true));
            g.drawString(text, x, baseline);
        }
        g.dispose();
        return image;
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
        return paint(label, role, width, height, hover, alpha, scale, enabled, 0);
    }

    /** @param labelColour the label's own colour, RGB, or 0 for Kiza's */
    public static BufferedImage paint(
        String label,
        MenuDesign.Role role,
        int width,
        int height,
        float hover,
        float alpha,
        int scale,
        boolean enabled,
        int labelColour
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
                0, 0, new Color(ClientSettings.accent().from, true),
                w, 0, new Color(ClientSettings.accent().to, true)
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
        int textColour;
        if (!enabled) {
            textColour = MenuDesign.TEXT_DISABLED;
        } else if (labelColour != 0) {
            textColour = MenuDesign.mix(0xFF000000 | labelColour, 0xFFFFFFFF, hover * 0.35F);
        } else {
            textColour = MenuDesign.mix(MenuDesign.TEXT_SOFT, 0xFFFFFFFF, hover);
        }
        boolean withIcon = MenuIcons.has(role);
        int iconSize = MenuDesign.ICON_SIZE * scale;
        int iconGap = withIcon ? MenuDesign.ICON_GAP * scale : 0;

        int room = w - 8 * scale - (withIcon ? iconSize + iconGap : 0);
        // The spacing gives way before the words do: a settings button that
        // says "RENDER DISTANCE: 12" has to fit a half-width button, and losing
        // the letter spacing costs less than losing the number.
        Font base = KizaText.covering(labelFont(MenuDesign.LABEL_SIZE * scale), text);
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
     * Paints the words Kiza Client at {@code height} GUI pixels tall, on a soft
     * shadow so they hold over a bright sky as well as a night.
     *
     * <p>The lettering is a picture, not a font: the rounded face chosen for
     * the name is not one every Windows has, and a font file shipped in a mod
     * is a licence to read. The picture is the name as it was chosen, white,
     * and is resampled once to the size it is drawn at.
     */
    public static BufferedImage paintWordmark(int scale, float alpha, int height) {
        BufferedImage source = wordmarkSource();
        if (source == null) return paintWordmarkText(scale, alpha, height);

        int glyphHeight = Math.max(1, height * scale);
        int glyphWidth = Math.max(1, Math.round(source.getWidth() * glyphHeight / (float) source.getHeight()));
        int pad = 3 * scale;
        int w = glyphWidth + pad * 2;
        int h = glyphHeight + pad * 2;

        BufferedImage glyphs = new BufferedImage(glyphWidth, glyphHeight, BufferedImage.TYPE_INT_ARGB);
        Graphics2D gg = glyphs.createGraphics();
        quality(gg);
        gg.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        gg.drawImage(source, 0, 0, glyphWidth, glyphHeight, null);
        gg.dispose();

        BufferedImage image = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        quality(g);
        // The shadow: the words' own shape in black, softened and dropped a
        // little, rather than an outline that would thicken the letters.
        BufferedImage shadow = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D sg = shadow.createGraphics();
        sg.drawImage(tinted(glyphs, 0xFF000000), pad, pad + Math.max(1, scale / 2), null);
        sg.dispose();
        shadow = blur(blur(shadow, Math.max(1, scale)), Math.max(1, scale));
        g.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, 0.55F));
        g.drawImage(shadow, 0, 0, null);
        g.setComposite(AlphaComposite.SrcOver);
        g.drawImage(glyphs, pad, pad, null);
        g.dispose();
        if (alpha < 1F) fade(image, alpha);
        return image;
    }

    /** The same words set in the label face, if the picture cannot be read. */
    private static BufferedImage paintWordmarkText(int scale, float alpha, int height) {
        Font font = spaced(labelFont(height * scale), MenuDesign.WORDMARK_TRACKING);
        BufferedImage probe = new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB);
        Graphics2D measure = probe.createGraphics();
        measure.setFont(font);
        FontMetrics metrics = measure.getFontMetrics();
        int textWidth = metrics.stringWidth(MenuDesign.WORDMARK);
        measure.dispose();

        int pad = 3 * scale;
        BufferedImage image = new BufferedImage(textWidth + pad * 2, height * scale + pad * 2, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        quality(g);
        g.setFont(font);
        int baseline = (image.getHeight() + Math.round(metrics.getAscent() * 0.72F)) / 2;
        g.setColor(new Color(0, 0, 0, 70));
        g.drawString(MenuDesign.WORDMARK, pad, baseline + scale / 2);
        g.setColor(new Color(MenuDesign.TEXT, true));
        g.drawString(MenuDesign.WORDMARK, pad, baseline);
        g.dispose();
        if (alpha < 1F) fade(image, alpha);
        return image;
    }

    private static BufferedImage wordmarkSource;
    private static boolean wordmarkMissing;

    private static synchronized BufferedImage wordmarkSource() {
        if (wordmarkSource != null || wordmarkMissing) return wordmarkSource;
        try {
            java.io.InputStream stream = Buttons.class.getResourceAsStream(MenuDesign.WORDMARK_PICTURE);
            if (stream != null) {
                try {
                    wordmarkSource = javax.imageio.ImageIO.read(stream);
                } finally {
                    stream.close();
                }
            }
        } catch (Exception error) {
            wordmarkSource = null;
        }
        wordmarkMissing = wordmarkSource == null;
        return wordmarkSource;
    }

    /** Room the wordmark's texture keeps around the words, in GUI pixels. */
    public static final int WORDMARK_PAD = 3;

    private static final Map<String, Object> WORDMARKS = new HashMap<String, Object>();
    private static final Map<String, int[]> WORDMARK_SIZES = new HashMap<String, int[]>();

    /**
     * The wordmark texture at {@code height} GUI pixels tall, and its size in
     * texture pixels through {@code sizeOut}, or null.
     */
    public static Object wordmark(int fadeStep, int height, int[] sizeOut) {
        if (KizaCanvas.isUnavailable()) return null;
        String key = "w|" + fadeStep + "|" + height;
        Object cached = WORDMARKS.get(key);
        if (cached == null) {
            int scale = supersample();
            BufferedImage image = paintWordmark(scale, fadeStep / (float) FADE_STEPS, height);
            cached = KizaCanvas.upload("menu_wordmark_" + fadeStep + "_" + height, image);
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
        Object cached = cached(key);
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
        return store(key, image);
    }


    private static BufferedImage emblemSource;
    private static boolean emblemMissing;

    private static synchronized BufferedImage emblemSource() {
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

        BufferedImage logo = resampled(source, inner);

        // The light: a slanted band of pale violet, laid only where the logo is.
        if (sweep >= 0F) {
            Graphics2D lg = logo.createGraphics();
            quality(lg);
            paintLightBand(lg, inner, sweep, AlphaComposite.SRC_ATOP);
            lg.dispose();
        }

        BufferedImage image = new BufferedImage(full, full, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        quality(g);
        if (glow > 0F) drawHalo(g, logo, full, pad, glow);
        g.drawImage(logo, pad, pad, null);
        g.dispose();
        if (alpha < 1F) fade(image, alpha);
        return image;
    }

    /** The logo alone, resampled once to the size it is drawn at. */
    private static BufferedImage resampled(BufferedImage source, int inner) {
        BufferedImage logo = new BufferedImage(inner, inner, BufferedImage.TYPE_INT_ARGB);
        Graphics2D lg = logo.createGraphics();
        quality(lg);
        lg.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        lg.drawImage(source, 0, 0, inner, inner, null);
        lg.dispose();
        return logo;
    }

    /**
     * The light at {@code sweep}, 0 to 1 across: a pale band, and a violet
     * wash under it so it reads as Kiza's colour, each laid with {@code rule}.
     */
    private static void paintLightBand(Graphics2D lg, int inner, float sweep, int rule) {
        float band = inner * 0.16F;
        float centre = -band + sweep * (inner + band * 2);
        Color clear = new Color(MenuDesign.SHINE & 0xFFFFFF, true);
        Color bright = new Color(MenuDesign.SHINE, true);
        lg.setComposite(AlphaComposite.getInstance(rule, 1F));
        lg.setPaint(new java.awt.LinearGradientPaint(
            centre - band, 0, centre + band, inner * 0.35F,
            new float[] {0F, 0.5F, 1F},
            new Color[] {clear, bright, clear}
        ));
        lg.fillRect(0, 0, inner, inner);
        lg.setComposite(AlphaComposite.getInstance(rule, 0.55F));
        Color violet = new Color(ClientSettings.accent().glow(), true);
        Color none = new Color(ClientSettings.accent().glow() & 0xFFFFFF, true);
        lg.setPaint(new java.awt.LinearGradientPaint(
            centre - band * 1.6F, 0, centre + band * 1.6F, inner * 0.35F,
            new float[] {0F, 0.5F, 1F},
            new Color[] {none, violet, none}
        ));
        lg.fillRect(0, 0, inner, inner);
    }

    /**
     * The halo: the logo's own silhouette in violet, blurred at a quarter of
     * the size and drawn back up, which is cheap and soft.
     */
    private static void drawHalo(Graphics2D g, BufferedImage logo, int full, int pad, float glow) {
        BufferedImage silhouette = tinted(logo, ClientSettings.accent().glow());
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

    // ---- The loading screen's pictures: layers the GPU fades each on its own ------

    /** The emblem with no halo and no light, on the canvas {@link #paintEmblem} gives it. Any thread. */
    public static BufferedImage paintEmblemAlone(int size, int scale) {
        BufferedImage source = emblemSource();
        return source == null ? null : paintEmblem(source, size, scale, 0F, -1F, 1F);
    }

    /** The emblem's halo alone, at full strength, on the same canvas: to breathe with an opacity. Any thread. */
    public static BufferedImage paintHaloAlone(int size, int scale) {
        BufferedImage source = emblemSource();
        if (source == null) return null;
        int pad = EMBLEM_GLOW * scale;
        int full = size * scale + pad * 2;
        BufferedImage image = new BufferedImage(full, full, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        quality(g);
        drawHalo(g, resampled(source, size * scale), full, pad, 1F);
        g.dispose();
        return image;
    }

    /**
     * The light alone at {@code sweep}, on the logo's own square with no
     * margin, kept only where the logo is: laid over the emblem, it makes the
     * emblem {@link #paintEmblem} paints with that light. Any thread.
     */
    public static BufferedImage paintLightAlone(int size, int scale, float sweep) {
        BufferedImage source = emblemSource();
        if (source == null) return null;
        int inner = size * scale;
        BufferedImage light = new BufferedImage(inner, inner, BufferedImage.TYPE_INT_ARGB);
        Graphics2D lg = light.createGraphics();
        quality(lg);
        paintLightBand(lg, inner, sweep, AlphaComposite.SRC_OVER);
        lg.setComposite(AlphaComposite.DstIn);
        lg.drawImage(resampled(source, inner), 0, 0, null);
        lg.dispose();
        return light;
    }

    /**
     * A line of text {@code size} GUI pixels tall, left-aligned in a box
     * {@code size + 4} tall, its capitals centred in it: as {@link #text}
     * draws, uncached. Any thread.
     */
    public static BufferedImage paintLine(String text, int size, int colour, boolean bold, int scale) {
        Font font = KizaText.covering(bold ? labelFont(size * scale) : plainFont(size * scale), text);
        BufferedImage probe = new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB);
        Graphics2D measure = probe.createGraphics();
        quality(measure);
        int width = Math.max(1, (int) Math.ceil(font.getStringBounds(text, measure.getFontRenderContext()).getWidth()) + scale * 3);
        measure.dispose();
        int w = ((width + scale - 1) / scale) * scale;
        int h = (size + 4) * scale;
        BufferedImage image = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        quality(g);
        g.setFont(font);
        g.setColor(new Color(colour, true));
        int baseline = (h + Math.round(g.getFontMetrics().getAscent() * 0.72F)) / 2;
        g.drawString(text, scale, baseline);
        g.dispose();
        return image;
    }

    /**
     * Each of {@code characters} as a picture of its own, the digits all as
     * wide as the widest, so a number counting up does not shuffle sideways.
     * In {@link #paintLine}'s box. Any thread.
     */
    public static BufferedImage[] paintTabular(String characters, int size, int colour, int scale) {
        Font font = KizaText.covering(plainFont(size * scale), characters);
        BufferedImage probe = new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB);
        Graphics2D measure = probe.createGraphics();
        quality(measure);
        java.awt.font.FontRenderContext context = measure.getFontRenderContext();
        float digit = 0F;
        for (char c = '0'; c <= '9'; c += 1) {
            digit = Math.max(digit, (float) font.getStringBounds(String.valueOf(c), context).getWidth());
        }
        measure.dispose();
        BufferedImage[] glyphs = new BufferedImage[characters.length()];
        int h = (size + 4) * scale;
        for (int index = 0; index < characters.length(); index += 1) {
            String glyph = String.valueOf(characters.charAt(index));
            float own = (float) font.getStringBounds(glyph, context).getWidth();
            float cell = Character.isDigit(characters.charAt(index)) ? digit : own;
            int w = Math.max(scale, (int) Math.ceil(cell));
            BufferedImage image = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
            Graphics2D g = image.createGraphics();
            quality(g);
            g.setFont(font);
            g.setColor(new Color(colour, true));
            int baseline = (h + Math.round(g.getFontMetrics().getAscent() * 0.72F)) / 2;
            g.drawString(glyph, (w - own) / 2F, baseline);
            g.dispose();
            glyphs[index] = image;
        }
        return glyphs;
    }

    /**
     * A pill {@code width} by {@code height} GUI pixels, in the buttons'
     * materials: the track their surface and rim, the fill the accent poured
     * across, lit along its top. Drawn three-sliced, its ends kept round at
     * any length. Any thread.
     */
    public static BufferedImage paintPill(int width, int height, int scale, boolean fill) {
        int w = width * scale;
        int h = height * scale;
        BufferedImage image = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        quality(g);
        RoundRectangle2D.Float shape = new RoundRectangle2D.Float(0, 0, w, h, h, h);
        float line = Math.max(1F, scale * 0.75F);
        if (fill) {
            g.setPaint(new GradientPaint(0, 0, new Color(ClientSettings.accent().from, true), w, 0, new Color(ClientSettings.accent().to, true)));
            g.fill(shape);
            g.setPaint(new GradientPaint(0, 0, new Color(0x40FFFFFF, true), 0, h * 0.6F, new Color(0x00FFFFFF, true)));
            g.fill(shape);
        } else {
            g.setColor(new Color(MenuDesign.SURFACE, true));
            g.fill(shape);
            // The rim a little brighter than a button's: the bar is thin, and
            // on the dark it would otherwise not be told from the background.
            g.setStroke(new BasicStroke(line));
            g.setPaint(new GradientPaint(0, 0, new Color(0x42FFFFFF, true), 0, h, new Color(0x16FFFFFF, true)));
            g.draw(new RoundRectangle2D.Float(line / 2F, line / 2F, w - line, h - line, h - line, h - line));
        }
        g.dispose();
        return image;
    }

    /**
     * What lies behind the loading screen, at a fraction of the screen's
     * size and drawn up smoothly: the accent's light pooled behind the
     * emblem at {@code (cx, cy)}, 0 to 1 across, and the corners darkened.
     * Dithered, so the slow gradients show no bands. Any thread.
     */
    public static BufferedImage paintBackdrop(int width, int height, float cx, float cy) {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        int glow = ClientSettings.accent().glow();
        int gr = (glow >> 16) & 0xFF;
        int gg = (glow >> 8) & 0xFF;
        int gb = glow & 0xFF;
        java.util.Random noise = new java.util.Random(7L);
        float reach = width * 0.42F;
        for (int y = 0; y < height; y += 1) {
            for (int x = 0; x < width; x += 1) {
                float dx = x - cx * width;
                float dy = (y - cy * height) * 1.25F;
                float pool = (float) Math.exp(-(dx * dx + dy * dy) / (2F * reach * reach * 0.35F)) * 0.30F;
                float ex = x / (float) width - 0.5F;
                float ey = y / (float) height - 0.5F;
                float corner = Math.max(0F, (float) Math.sqrt(ex * ex + ey * ey) * 1.55F - 0.35F);
                float dark = Math.min(0.55F, corner * corner);
                // Light over dark: the pool's colour where it is, black toward the corners.
                float alpha = pool + dark * (1F - pool);
                float dither = (noise.nextFloat() - 0.5F) / 255F;
                float share = alpha <= 0F ? 0F : pool * (1F - dark) / alpha;
                int r = Math.round(gr * share);
                int gch = Math.round(gg * share);
                int b = Math.round(gb * share);
                int a = Math.max(0, Math.min(255, Math.round((alpha + dither) * 255F)));
                image.setRGB(x, y, (a << 24) | (r << 16) | (gch << 8) | b);
            }
        }
        return image;
    }

    /**
     * Takes a picture painted elsewhere as the title screen's own emblem at
     * {@code size}, fully shown, so the title screen does not paint it on the
     * frame it first draws. Render thread.
     */
    public static void adoptTitleEmblem(int size, BufferedImage image) {
        String key = "e|" + size + "|" + FADE_STEPS + "|0|0";
        if (image != null && cached(key) == null) store(key, image);
    }

    /** The same for the title screen's wordmark at {@code height}. Render thread. */
    public static void adoptTitleWordmark(int height, BufferedImage image) {
        String key = "w|" + FADE_STEPS + "|" + height;
        if (image == null || WORDMARKS.containsKey(key) || KizaCanvas.isUnavailable()) return;
        Object uploaded = KizaCanvas.upload("menu_wordmark_" + FADE_STEPS + "_" + height, image);
        if (uploaded == null) return;
        WORDMARKS.put(key, uploaded);
        WORDMARK_SIZES.put(key, new int[] {image.getWidth(), image.getHeight()});
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

    // ---- The settings panel's parts --------------------------------------------

    /**
     * How wide each line of text was measured, in texture pixels: measuring
     * makes an image and a graphics context, which every line drawn did every
     * frame before its texture was even looked up.
     */
    private static final Map<String, Integer> TEXT_WIDTHS = new HashMap<String, Integer>();

    /** Text, left-aligned, as a texture: its width comes back in {@code sizeOut} (GUI px). */
    public static Object text(String text, int size, int colour, boolean bold, int[] sizeOut) {
        String key = "t|" + text + "|" + size + "|" + colour + "|" + bold;
        int scale = supersample();
        Font font = null;
        String measured = text + "|" + size + "|" + bold + "|" + scale;
        Integer known = TEXT_WIDTHS.get(measured);
        if (known == null) {
            font = KizaText.covering(bold ? labelFont(size * scale) : plainFont(size * scale), text);
            BufferedImage probe = new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB);
            Graphics2D measure = probe.createGraphics();
            // Measured as it is drawn: with fractional metrics, a line is wider
            // than the plain measure says, and its last letters were cut off.
            quality(measure);
            known = Math.max(1, (int) Math.ceil(font.getStringBounds(text, measure.getFontRenderContext()).getWidth()) + scale * 3);
            measure.dispose();
            if (TEXT_WIDTHS.size() > 1024) TEXT_WIDTHS.clear();
            TEXT_WIDTHS.put(measured, known);
        }
        int width = known;
        if (sizeOut != null) {
            sizeOut[0] = (width + scale - 1) / scale;
            sizeOut[1] = size + 4;
        }
        Object cached = cachedPlain(key);
        if (cached != null) return cached;
        if (font == null) font = KizaText.covering(bold ? labelFont(size * scale) : plainFont(size * scale), text);
        int w = ((width + scale - 1) / scale) * scale;
        int h = (size + 4) * scale;
        BufferedImage image = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        quality(g);
        g.setFont(font);
        g.setColor(new Color(colour, true));
        FontMetrics drawn = g.getFontMetrics();
        int baseline = (h + Math.round(drawn.getAscent() * 0.72F)) / 2;
        g.drawString(text, scale, baseline);
        g.dispose();
        return storePlain(key, image);
    }

    static Font plainFont(int sizePx) {
        Font face = KizaText.face(sizePx, false);
        return face != null ? face : new Font(Font.SANS_SERIF, Font.PLAIN, sizePx);
    }

    /** The face Kiza's labels are set in, or the platform's own bold sans. */
    static Font labelFont(int sizePx) {
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
