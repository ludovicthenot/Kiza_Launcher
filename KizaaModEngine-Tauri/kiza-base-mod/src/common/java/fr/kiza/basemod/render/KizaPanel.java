package fr.kiza.basemod.render;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Antialiased rounded panels for the client UI.
 *
 * <p>The vanilla primitives can only fill axis-aligned rectangles, so rounded
 * corners built from them show visible stair-stepping. Here the shape is
 * rasterised once with Java2D antialiasing, cached by geometry and colours, and
 * reused as a texture on later frames.
 */
public final class KizaPanel {
    private static final int MAX_CACHED = 96;
    /** Rasterise larger than drawn so upscaling by the GUI scale stays smooth. */
    private static final int SUPERSAMPLE = 3;

    private static final class Panel {
        private final Object identifier;
        private final int width;
        private final int height;

        Panel(Object identifier, int width, int height) {
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

    private static final Map<String, Panel> CACHE =
        new LinkedHashMap<String, Panel>(32, 0.75F, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, Panel> eldest) {
                return size() > MAX_CACHED;
            }
        };

    private KizaPanel() {}

    public static boolean isAvailable() {
        return !KizaCanvas.isUnavailable();
    }

    /**
     * Returns the texture for a rounded panel of this size and styling, or null
     * when the caller must fall back to the vanilla rectangle fills.
     */
    public static Object texture(
        int width,
        int height,
        int radius,
        int fillArgb,
        int borderArgb
    ) {
        if (!isAvailable() || width <= 0 || height <= 0) return null;
        if (width > 1024 || height > 512) return null;

        String key = width + "x" + height + "r" + radius
            + "f" + Integer.toHexString(fillArgb)
            + "b" + Integer.toHexString(borderArgb);
        Panel cached = CACHE.get(key);
        if (cached != null) return cached.identifier();

        Panel built = rasterise(key, width, height, radius, fillArgb, borderArgb);
        if (built == null) return null;
        CACHE.put(key, built);
        return built.identifier();
    }

    private static Panel rasterise(
        String key,
        int width,
        int height,
        int radius,
        int fillArgb,
        int borderArgb
    ) {
        try {
            int imageWidth = width * SUPERSAMPLE;
            int imageHeight = height * SUPERSAMPLE;
            BufferedImage image =
                new BufferedImage(imageWidth, imageHeight, BufferedImage.TYPE_INT_ARGB);
            Graphics2D graphics = image.createGraphics();
            graphics.setRenderingHint(
                RenderingHints.KEY_ANTIALIASING,
                RenderingHints.VALUE_ANTIALIAS_ON
            );
            graphics.setRenderingHint(
                RenderingHints.KEY_STROKE_CONTROL,
                RenderingHints.VALUE_STROKE_PURE
            );

            float stroke = SUPERSAMPLE;
            float inset = stroke / 2.0F;
            RoundRectangle2D shape = new RoundRectangle2D.Float(
                inset,
                inset,
                imageWidth - stroke,
                imageHeight - stroke,
                radius * SUPERSAMPLE * 2.0F,
                radius * SUPERSAMPLE * 2.0F
            );

            graphics.setColor(new Color(fillArgb, true));
            graphics.fill(shape);
            if ((borderArgb >>> 24) != 0) {
                graphics.setColor(new Color(borderArgb, true));
                graphics.setStroke(new BasicStroke(stroke));
                graphics.draw(shape);
            }
            graphics.dispose();

            Object identifier =
                KizaCanvas.upload("panel_" + Integer.toHexString(key.hashCode()), image);
            if (identifier == null) return null;
            return new Panel(identifier, imageWidth, imageHeight);
        } catch (RuntimeException | LinkageError error) {
            return null;
        }
    }
}
