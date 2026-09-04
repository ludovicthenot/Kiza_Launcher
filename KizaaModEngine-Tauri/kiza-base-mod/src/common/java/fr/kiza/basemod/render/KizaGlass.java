package fr.kiza.basemod.render;

import java.awt.AlphaComposite;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.awt.image.ConvolveOp;
import java.awt.image.Kernel;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The frosted panel the in-game HUD is built from, rasterised with Java2D and
 * uploaded once as a texture.
 *
 * <p>Say plainly what this is not: it does not blur what is behind it. A real
 * backdrop blur means sampling the framebuffer, and the framebuffer is reached
 * differently on every one of the four loader generations this jar has to run
 * on — the one place where a version guess costs a crash rather than a missing
 * feature. So the glass is built from what a panel can carry by itself:
 *
 * <ul>
 *   <li>a dark translucent body, so the world still moves underneath;
 *   <li>light gathered along the top and falling off, which is what a pane of
 *       glass actually does with a sky above it;
 *   <li>a bright hairline rim, brightest across the top;
 *   <li>a soft shadow cast underneath, so the panel keeps an outline over snow
 *       as well as over a cave.
 * </ul>
 *
 * <p>Those four together read as glass. The blur is the part nobody misses; the
 * rim is the part everybody would.
 *
 * <p>The shadow falls <em>inside</em> the requested image rather than bleeding
 * past it, so a caller blits one rectangle and never has to know the shadow is
 * there. {@link fr.kiza.basemod.hud.HudTheme#SHADOW_PAD} is that inset.
 *
 * <p>Java 8 syntax: this compiles into the legacy jar as well as the modern one.
 */
public final class KizaGlass {
    private static final int MAX_CACHED = 64;
    /** Rasterise larger than drawn so the GUI scale upscales something smooth. */
    private static final int SUPERSAMPLE = 3;
    /** Radius of the shadow's blur, in supersampled pixels. */
    private static final int BLUR = 3 * SUPERSAMPLE;

    private static final Map<String, Object> CACHE =
        new LinkedHashMap<String, Object>(16, 0.75F, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, Object> eldest) {
                return size() > MAX_CACHED;
            }
        };

    private KizaGlass() {}

    public static boolean isAvailable() {
        return !KizaCanvas.isUnavailable();
    }

    /**
     * The texture for a glass panel whose image is {@code width} by
     * {@code height}, with the glass itself inset by {@code pad} on every side.
     *
     * <p>Returns null when the canvas is unsupported; the caller then falls back
     * to a flat filled rectangle, which is not glass but is legible, and legible
     * is the part that matters.
     */
    public static Object texture(
        int width,
        int height,
        int pad,
        int radius,
        int fillArgb,
        int edgeArgb,
        int sheenArgb,
        int shadowArgb
    ) {
        if (!isAvailable()) return null;
        if (width <= pad * 2 || height <= pad * 2) return null;
        if (width > 1024 || height > 512) return null;

        String key = width + "x" + height + "p" + pad + "r" + radius
            + "f" + Integer.toHexString(fillArgb)
            + "e" + Integer.toHexString(edgeArgb)
            + "s" + Integer.toHexString(sheenArgb)
            + "d" + Integer.toHexString(shadowArgb);
        Object cached = CACHE.get(key);
        if (cached != null) return cached;

        BufferedImage painted =
            paint(width, height, pad, radius, fillArgb, edgeArgb, sheenArgb, shadowArgb);
        if (painted == null) return null;
        Object built = KizaCanvas.upload("glass_" + Integer.toHexString(key.hashCode()), painted);
        if (built == null) return null;
        CACHE.put(key, built);
        return built;
    }

    /**
     * The drawing on its own, with no Minecraft anywhere near it.
     *
     * <p>Separated from {@link #texture} so the look can be rendered to a file
     * and looked at. A HUD that can only be judged by launching Minecraft is a
     * HUD nobody checks.
     */
    public static BufferedImage paint(
        int width,
        int height,
        int pad,
        int radius,
        int fillArgb,
        int edgeArgb,
        int sheenArgb,
        int shadowArgb
    ) {
        try {
            int imageWidth = width * SUPERSAMPLE;
            int imageHeight = height * SUPERSAMPLE;
            float inset = pad * SUPERSAMPLE;
            float glassWidth = imageWidth - inset * 2.0F;
            float glassHeight = imageHeight - inset * 2.0F;
            float arc = radius * SUPERSAMPLE * 2.0F;

            RoundRectangle2D glass =
                new RoundRectangle2D.Float(inset, inset, glassWidth, glassHeight, arc, arc);

            BufferedImage image =
                new BufferedImage(imageWidth, imageHeight, BufferedImage.TYPE_INT_ARGB);
            Graphics2D graphics = image.createGraphics();
            quality(graphics);

            if ((shadowArgb >>> 24) != 0) {
                drawShadow(graphics, imageWidth, imageHeight, glass, shadowArgb);
            }

            graphics.setColor(new Color(fillArgb, true));
            graphics.fill(glass);

            if ((sheenArgb >>> 24) != 0) {
                drawSheen(graphics, glass, inset, glassHeight, sheenArgb);
            }

            if ((edgeArgb >>> 24) != 0) {
                drawRim(graphics, glass, inset, glassHeight, edgeArgb);
            }

            graphics.dispose();
            return image;
        } catch (RuntimeException | LinkageError error) {
            return null;
        }
    }

    /** How many image pixels one GUI pixel becomes while painting. */
    public static int supersample() {
        return SUPERSAMPLE;
    }

    /**
     * The panel's own silhouette, blurred and dropped a little below it.
     *
     * <p>Drawn into its own image and convolved, because Java2D has no shadow of
     * its own. Cheap enough: this happens once per distinct panel size and never
     * again, and the HUD has a handful of sizes.
     */
    private static void drawShadow(
        Graphics2D graphics,
        int imageWidth,
        int imageHeight,
        RoundRectangle2D glass,
        int shadowArgb
    ) {
        BufferedImage layer =
            new BufferedImage(imageWidth, imageHeight, BufferedImage.TYPE_INT_ARGB);
        Graphics2D shadow = layer.createGraphics();
        quality(shadow);
        shadow.setColor(new Color(shadowArgb, true));
        // Down by a third of the blur: the light in the scene is above, so the
        // shadow belongs below. Straight down rather than off to one side,
        // because a HUD panel has no fixed side to be lit from.
        shadow.translate(0, BLUR / 3.0);
        shadow.fill(glass);
        shadow.dispose();

        BufferedImage blurred = blur(layer);
        graphics.drawImage(blurred, 0, 0, null);
    }

    /** Light along the top, dying out before the middle. */
    private static void drawSheen(
        Graphics2D graphics,
        RoundRectangle2D glass,
        float inset,
        float glassHeight,
        int sheenArgb
    ) {
        Color top = new Color(sheenArgb, true);
        Color bottom = new Color(sheenArgb & 0x00FFFFFF, true);
        graphics.setPaint(new GradientPaint(
            0, inset, top,
            0, inset + glassHeight * 0.55F, bottom
        ));
        graphics.fill(glass);
        graphics.setPaint(null);
    }

    /**
     * The rim, brightest across the top and fading towards the bottom.
     *
     * <p>A rim of one flat colour looks printed on. Real glass catches the light
     * on the edge facing it and loses it on the edge facing away, and that
     * gradient is most of the difference between a panel that looks like glass
     * and a panel that looks like a rectangle with a border.
     */
    private static void drawRim(
        Graphics2D graphics,
        RoundRectangle2D glass,
        float inset,
        float glassHeight,
        int edgeArgb
    ) {
        // Stroked half a width inside the glass rather than centred on its
        // outline. A centred stroke puts half of itself over the shadow, where
        // it is invisible -- which is how a rim set to a third alpha ended up
        // reading as no rim at all.
        float stroke = SUPERSAMPLE;
        float half = stroke / 2.0F;
        RoundRectangle2D path = new RoundRectangle2D.Float(
            (float) glass.getX() + half,
            (float) glass.getY() + half,
            (float) glass.getWidth() - stroke,
            (float) glass.getHeight() - stroke,
            (float) Math.max(0.0, glass.getArcWidth() - stroke),
            (float) Math.max(0.0, glass.getArcHeight() - stroke)
        );

        int alpha = edgeArgb >>> 24;
        Color bright = new Color(edgeArgb, true);
        // Not to nothing: an edge that disappears entirely along the bottom
        // makes the panel look like it is dissolving rather than lit from above.
        Color dim = new Color(
            (edgeArgb & 0x00FFFFFF) | (Math.max(0, alpha / 3) << 24), true
        );
        graphics.setPaint(new GradientPaint(
            0, inset, bright,
            0, inset + glassHeight, dim
        ));
        graphics.setStroke(new BasicStroke(stroke));
        graphics.draw(path);
        graphics.setPaint(null);
    }

    /** A separable box blur run three times, which is a Gaussian close enough. */
    private static BufferedImage blur(BufferedImage source) {
        BufferedImage image = source;
        float[] horizontal = new float[BLUR];
        java.util.Arrays.fill(horizontal, 1.0F / BLUR);
        ConvolveOp across =
            new ConvolveOp(new Kernel(BLUR, 1, horizontal), ConvolveOp.EDGE_ZERO_FILL, null);
        ConvolveOp down =
            new ConvolveOp(new Kernel(1, BLUR, horizontal), ConvolveOp.EDGE_ZERO_FILL, null);
        for (int pass = 0; pass < 3; pass += 1) {
            image = down.filter(across.filter(image, null), null);
        }
        return image;
    }

    private static void quality(Graphics2D graphics) {
        graphics.setRenderingHint(
            RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON
        );
        graphics.setRenderingHint(
            RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE
        );
        graphics.setRenderingHint(
            RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY
        );
        graphics.setComposite(AlphaComposite.SrcOver);
    }
}
