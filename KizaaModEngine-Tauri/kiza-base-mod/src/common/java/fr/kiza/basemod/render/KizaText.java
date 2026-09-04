package fr.kiza.basemod.render;

import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.font.FontRenderContext;
import java.awt.geom.Rectangle2D;
import java.awt.image.BufferedImage;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * TrueType text for the Kiza Launcher UI, rasterised with Java2D antialiasing instead
 * of Minecraft's bitmap font. Each distinct label is rasterised once, uploaded
 * as a texture and cached; frames after that are a plain blit.
 *
 * <p>Callers must treat {@link #isAvailable()} as authoritative and fall back
 * to the vanilla font renderer when it reports false.
 */
public final class KizaText {
    /**
     * The launcher's own typeface, with portable fallbacks.
     *
     * <p>"Segoe UI Variable Text" used to lead this list and never resolved:
     * Java matches on family names, and that is an optical-size face name, not
     * a family. It was silently skipped on every machine. CSS does match it,
     * which is how the launcher ended up set in one face and the menu it draws
     * inside Minecraft in another, with a comment on each saying they matched.
     *
     * <p>Segoe UI is the name both worlds resolve, so it is the name both use.
     */
    private static final String[] FONT_FAMILIES = {"Segoe UI", "Inter", "SansSerif"};
    /**
     * The heavier face, for the text a menu is made of.
     *
     * <p>Semibold rather than bold, and named rather than derived. Asking Java
     * for {@code Font.BOLD} on a family that has no bold face gets a synthetic
     * one -- the same glyphs smeared sideways -- which at ten pixels turns into
     * mud. These are real faces where they exist, and the derive below is the
     * fallback for where they do not.
     */
    private static final String[] BOLD_FAMILIES = {
        "Segoe UI Semibold", "Inter SemiBold", "Inter"
    };
    private static final int MAX_CACHED = 192;
    /** Rasterise well above the drawn size: the GUI scale (up to 4x) upscales the
     * blit afterwards, so a low factor would show as soft, pixelated glyphs. */
    private static final int SUPERSAMPLE = 5;
    private static final int PADDING = 2;

    /** Java 8 syntax throughout: the legacy jar targets Minecraft 1.8-1.16. */
    private static final class Label {
        private final Object identifier;
        private final int width;
        private final int height;

        Label(Object identifier, int width, int height) {
            this.identifier = identifier;
            this.width = width;
            this.height = height;
        }

        Object identifier() {
            return identifier;
        }

        int width() {
            return width;
        }

        int height() {
            return height;
        }
    }

    private static final Map<String, Label> CACHE =
        new LinkedHashMap<String, Label>(64, 0.75F, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, Label> eldest) {
                return size() > MAX_CACHED;
            }
        };

    private static Font baseFont;
    private static Font boldFont;
    private static boolean unavailable;

    private KizaText() {}

    public static boolean isAvailable() {
        return !unavailable && !KizaCanvas.isUnavailable() && font() != null;
    }

    /**
     * The face labels are rasterised in, at a size, or null when unavailable.
     *
     * <p>Exposed so the menu preview draws the glyphs the game will draw. A
     * preview in a different font is a preview of a different menu.
     */
    public static Font face(int sizePx) {
        return face(sizePx, false);
    }

    public static Font face(int sizePx, boolean bold) {
        Font font = bold ? boldFont() : font();
        return font == null ? null : font.deriveFont((float) sizePx);
    }

    /** Width the label will occupy at {@code sizePx}, in GUI pixels. */
    public static int width(String text, int sizePx) {
        return width(text, sizePx, false);
    }

    public static int width(String text, int sizePx, boolean bold) {
        Font font = bold ? boldFont() : font();
        if (font == null || text == null || text.isEmpty()) return 0;
        Rectangle2D bounds = font.deriveFont((float) (sizePx * SUPERSAMPLE))
            .getStringBounds(text, new FontRenderContext(null, true, true));
        return (int) Math.ceil(bounds.getWidth() / SUPERSAMPLE);
    }

    /**
     * Prepares the texture for a label. Returns the blit geometry, or null when
     * the caller must fall back to the vanilla font.
     */
    public static int[] prepare(String text, int sizePx, int argb) {
        return prepare(text, sizePx, argb, false);
    }

    public static int[] prepare(String text, int sizePx, int argb, boolean bold) {
        if (!isAvailable() || text == null || text.isEmpty()) return null;

        String key = key(text, sizePx, argb, bold);
        Label cached = CACHE.get(key);
        if (cached == null) {
            cached = rasterise(key, text, sizePx, argb, bold);
            if (cached == null) return null;
            CACHE.put(key, cached);
        }
        return new int[] {cached.width(), cached.height()};
    }

    /** Texture identifier for a label already passed to {@link #prepare}. */
    public static Object identifier(String text, int sizePx, int argb) {
        return identifier(text, sizePx, argb, false);
    }

    public static Object identifier(String text, int sizePx, int argb, boolean bold) {
        Label cached = CACHE.get(key(text, sizePx, argb, bold));
        return cached == null ? null : cached.identifier();
    }

    /** The weight is part of the key, or bold and plain would share a texture. */
    private static String key(String text, int sizePx, int argb, boolean bold) {
        return sizePx + "|" + Integer.toHexString(argb) + "|" + (bold ? "b|" : "p|") + text;
    }

    private static Label rasterise(String key, String text, int sizePx, int argb, boolean bold) {
        try {
            Font base = bold ? boldFont() : font();
            if (base == null) return null;
            Font font = base.deriveFont((float) (sizePx * SUPERSAMPLE));
            FontRenderContext context = new FontRenderContext(null, true, true);
            Rectangle2D bounds = font.getStringBounds(text, context);

            int imageWidth = (int) Math.ceil(bounds.getWidth()) + PADDING * 2;
            int imageHeight = (int) Math.ceil(bounds.getHeight()) + PADDING * 2;
            if (imageWidth <= 0 || imageHeight <= 0 || imageWidth > 4096) return null;

            BufferedImage image =
                new BufferedImage(imageWidth, imageHeight, BufferedImage.TYPE_INT_ARGB);
            Graphics2D graphics = image.createGraphics();
            graphics.setRenderingHint(
                RenderingHints.KEY_TEXT_ANTIALIASING,
                RenderingHints.VALUE_TEXT_ANTIALIAS_ON
            );
            graphics.setRenderingHint(
                RenderingHints.KEY_ANTIALIASING,
                RenderingHints.VALUE_ANTIALIAS_ON
            );
            graphics.setRenderingHint(
                RenderingHints.KEY_FRACTIONALMETRICS,
                RenderingHints.VALUE_FRACTIONALMETRICS_ON
            );
            graphics.setFont(font);
            graphics.setColor(new Color(argb, true));
            graphics.drawString(
                text,
                PADDING,
                PADDING + graphics.getFontMetrics().getAscent()
            );
            graphics.dispose();

            Object identifier = KizaCanvas.upload("text_" + Integer.toHexString(key.hashCode()), image);
            if (identifier == null) return null;
            return new Label(
                identifier,
                Math.max(1, imageWidth / SUPERSAMPLE),
                Math.max(1, imageHeight / SUPERSAMPLE)
            );
        } catch (RuntimeException | LinkageError error) {
            unavailable = true;
            return null;
        }
    }

    /**
     * The semibold face, or the plain one made bold if none is installed.
     *
     * <p>The derive is the last resort and it looks like one. It is still
     * better than plain: the ask was for weight, and a synthetic bold carries
     * weight even when it carries it badly.
     */
    private static Font boldFont() {
        if (boldFont != null) return boldFont;
        Font plain = font();
        if (plain == null) return null;
        try {
            for (String family : BOLD_FAMILIES) {
                Font candidate = new Font(family, Font.PLAIN, 16);
                // Java silently substitutes Dialog for unknown families, and
                // getFamily on a semibold face reports the family it belongs
                // to -- so the name is checked against both.
                String resolved = candidate.getFamily();
                if (resolved.equalsIgnoreCase(family) || family.startsWith(resolved)) {
                    boldFont = candidate;
                    return boldFont;
                }
            }
            boldFont = plain.deriveFont(Font.BOLD);
            return boldFont;
        } catch (RuntimeException | LinkageError error) {
            boldFont = plain;
            return boldFont;
        }
    }

    private static Font font() {
        if (baseFont != null) return baseFont;
        if (unavailable) return null;
        try {
            for (String family : FONT_FAMILIES) {
                Font candidate = new Font(family, Font.PLAIN, 16);
                // Java silently substitutes Dialog for unknown families.
                if (candidate.getFamily().equalsIgnoreCase(family)
                    || family.equals("SansSerif")) {
                    baseFont = candidate;
                    return baseFont;
                }
            }
            baseFont = new Font(Font.SANS_SERIF, Font.PLAIN, 16);
            return baseFont;
        } catch (RuntimeException | LinkageError error) {
            // Headless or stripped JRE: no java.desktop, keep the vanilla font.
            unavailable = true;
            return null;
        }
    }
}
