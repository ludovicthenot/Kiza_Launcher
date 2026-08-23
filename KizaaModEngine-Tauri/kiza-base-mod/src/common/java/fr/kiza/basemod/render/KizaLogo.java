package fr.kiza.basemod.render;

import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.imageio.ImageIO;

/**
 * Smoothly resampled brand textures.
 *
 * <p>The source art is authored large (1400x600) but drawn small — down to
 * 90x39 in the corner. Minecraft's GUI blit does not resample, so shrinking by
 * that much shows as aliasing. Here the texture is downscaled once with Java2D
 * bicubic filtering, at the size it is actually drawn, and cached.
 */
public final class KizaLogo {
    private static final int MAX_CACHED = 12;
    /** Cover the largest GUI scale so the blit never upscales the result. */
    private static final int OVERSAMPLE = 4;

    private static final Map<String, Object> CACHE =
        new LinkedHashMap<String, Object>(8, 0.75F, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, Object> eldest) {
                return size() > MAX_CACHED;
            }
        };
    private static final Map<String, BufferedImage> SOURCES = new LinkedHashMap<>();

    private KizaLogo() {}

    /**
     * Texture for {@code resource} resampled to {@code width}x{@code height},
     * or null when the caller should blit the raw texture instead.
     */
    public static Object texture(String resource, int width, int height) {
        if (KizaCanvas.isUnavailable() || width <= 0 || height <= 0) return null;
        if (width > 2048 || height > 2048) return null;

        String key = resource + "@" + width + "x" + height;
        Object cached = CACHE.get(key);
        if (cached != null) return cached;

        BufferedImage source = source(resource);
        if (source == null) return null;

        try {
            int targetWidth = width * OVERSAMPLE;
            int targetHeight = height * OVERSAMPLE;
            // Never upscale past the source: that would only soften the art.
            if (targetWidth > source.getWidth()) {
                targetWidth = source.getWidth();
                targetHeight = source.getHeight();
            }

            BufferedImage scaled =
                new BufferedImage(targetWidth, targetHeight, BufferedImage.TYPE_INT_ARGB);
            Graphics2D graphics = scaled.createGraphics();
            graphics.setRenderingHint(
                RenderingHints.KEY_INTERPOLATION,
                RenderingHints.VALUE_INTERPOLATION_BICUBIC
            );
            graphics.setRenderingHint(
                RenderingHints.KEY_RENDERING,
                RenderingHints.VALUE_RENDER_QUALITY
            );
            graphics.setRenderingHint(
                RenderingHints.KEY_ANTIALIASING,
                RenderingHints.VALUE_ANTIALIAS_ON
            );
            graphics.drawImage(source, 0, 0, targetWidth, targetHeight, null);
            graphics.dispose();

            Object identifier =
                KizaCanvas.upload("logo_" + Integer.toHexString(key.hashCode()), scaled);
            if (identifier == null) return null;
            CACHE.put(key, identifier);
            return identifier;
        } catch (RuntimeException | LinkageError error) {
            return null;
        }
    }

    private static BufferedImage source(String resource) {
        if (SOURCES.containsKey(resource)) return SOURCES.get(resource);

        BufferedImage image = null;
        try (InputStream stream = KizaLogo.class.getResourceAsStream(resource)) {
            if (stream != null) image = ImageIO.read(stream);
        } catch (Exception error) {
            image = null;
        }
        SOURCES.put(resource, image);
        return image;
    }
}
