package fr.kiza.basemod.render;

import java.awt.image.BufferedImage;

/**
 * A pane of glass with a thickness, worked out one pixel at a time.
 *
 * <p>This is the difference between glass and a picture of glass. A tinted
 * rounded rectangle with a white line round it is a decal: move the world
 * behind it and nothing about it changes. Real glass bends what is behind it,
 * and it bends it most where the pane curves away at its edge — which is why a
 * glass panel reads as an object with thickness rather than a sticker.
 *
 * <p>So every pixel inside the pane asks two questions. How far am I from the
 * edge, and which way is the edge? The first gives the thickness of glass the
 * light passed through; the second gives the direction it was bent. Near the
 * rim the answer is "a lot, outwards", and the backdrop there is squeezed into
 * a bright compressed band — the thing your eye actually reads as glass. In the
 * middle the answer is "almost none", and the world shows through nearly
 * straight, only softened.
 *
 * <p>The pane is frosted rather than polished, and every number here is set for
 * that. Clear glass bends a sharp image and you read the world through it;
 * frosted glass scatters, keeping the light and the colour of what was behind
 * and throwing the picture away. So the backdrop is scattered hard before the
 * pane shows any of it, the bending at the rim is small, and the highlight is
 * diffuse — a wide lift along the upper edge instead of one bright streak. That
 * is also what makes it readable: a frosted panel holds its text over a busy
 * scene where a clear one loses it.
 *
 * <p>This is the honest, expensive version: it reads and writes every pixel.
 * That is right for a still — a preview, a menu that redraws when something
 * changes — and wrong for a HUD at 240 frames a second, which needs the same
 * shape approximated on the GPU. The look is decided here first, because a
 * fast approximation of an effect nobody has seen is a fast approximation of
 * nothing.
 *
 * <p>Java 8 syntax: this compiles into the legacy jar as well as the modern one.
 */
public final class KizaLens {
    /** How far in from the rim the bending is still felt, in pixels. */
    private static final float EDGE = 11.0F;
    /**
     * How far the rim pulls its sample from, at its strongest, in pixels.
     *
     * <p>Small, because this pane is frosted. Polished glass bends a sharp image
     * and you can read the world through it; frosted glass scatters, so the edge
     * gathers light and shape rather than a picture. Winding this up is what
     * turns matte back into clear.
     */
    private static final float BEND = 5.0F;
    /** Where the soft edge light sits, in pixels in from the rim. */
    private static final float HAIRLINE_AT = 1.8F;
    /** And how far it spreads. Wide on purpose: a frosted edge has no hard line. */
    private static final float HAIRLINE_WIDTH = 2.6F;
    /**
     * How much the backdrop is scattered before the pane shows any of it.
     *
     * <p>This is the whole difference between the two materials. Clear glass
     * softens; frosted glass destroys the image and keeps only the light and the
     * colour of what was behind it, which is why a frosted panel is readable
     * over a busy scene where a clear one is not.
     */
    private static final int BODY_BLUR = 16;

    private KizaLens() {}

    /**
     * Draws the pane, backdrop and all.
     *
     * <p>{@code backdrop} is the scene the pane sits in front of, in the same
     * pixels; {@code originX} and {@code originY} say where in it the pane's
     * top-left corner falls. The returned image is the pane alone, ready to be
     * composited back at that origin.
     *
     * @param tintArgb   the glass's own colour, its alpha being how much of it
     *                   is glass rather than window
     * @param accentArgb the colour the edge carries
     */
    public static BufferedImage refract(
        BufferedImage backdrop,
        int originX,
        int originY,
        int width,
        int height,
        float radius,
        int tintArgb,
        int accentArgb
    ) {
        if (backdrop == null || width <= 0 || height <= 0) return null;

        BufferedImage softened = boxBlur(backdrop, BODY_BLUR);

        BufferedImage pane = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        float halfWidth = width / 2.0F;
        float halfHeight = height / 2.0F;
        float tintR = ((tintArgb >> 16) & 0xFF) / 255.0F;
        float tintG = ((tintArgb >> 8) & 0xFF) / 255.0F;
        float tintB = (tintArgb & 0xFF) / 255.0F;
        float tintA = ((tintArgb >>> 24) & 0xFF) / 255.0F;
        float accentR = ((accentArgb >> 16) & 0xFF) / 255.0F;
        float accentG = ((accentArgb >> 8) & 0xFF) / 255.0F;
        float accentB = (accentArgb & 0xFF) / 255.0F;
        float accentA = ((accentArgb >>> 24) & 0xFF) / 255.0F;

        for (int y = 0; y < height; y += 1) {
            for (int x = 0; x < width; x += 1) {
                float px = x + 0.5F - halfWidth;
                float py = y + 0.5F - halfHeight;
                float distance = roundedRectDistance(px, py, halfWidth, halfHeight, radius);

                // Outside the pane, with a pixel of feathering so the silhouette
                // is not a staircase.
                if (distance > 0.5F) continue;
                float coverage = clamp(0.5F - distance, 0.0F, 1.0F);

                // Which way "out" is, taken from how the distance changes. The
                // gradient of a distance field is the surface normal, and it is
                // exactly what a lens needs: the direction light gets bent.
                float nx = roundedRectDistance(px + 1.0F, py, halfWidth, halfHeight, radius)
                    - roundedRectDistance(px - 1.0F, py, halfWidth, halfHeight, radius);
                float ny = roundedRectDistance(px, py + 1.0F, halfWidth, halfHeight, radius)
                    - roundedRectDistance(px, py - 1.0F, halfWidth, halfHeight, radius);
                float length = (float) Math.sqrt(nx * nx + ny * ny);
                if (length > 0.0001F) {
                    nx /= length;
                    ny /= length;
                } else {
                    nx = 0.0F;
                    ny = 0.0F;
                }

                // 0 at the rim, 1 once the glass is flat again.
                float depth = clamp(-distance / EDGE, 0.0F, 1.0F);
                float curve = (1.0F - depth) * (1.0F - depth);
                float bend = curve * BEND;

                int sampleX = Math.round(originX + x + nx * bend);
                int sampleY = Math.round(originY + y + ny * bend);

                // Scattered everywhere, and only slightly less so at the very
                // rim. A frosted pane has no window in it: the sharp copy is
                // left a small say along the edge, where the glass is thickest
                // and the light passing through it still carries direction.
                int sharp = sample(backdrop, sampleX, sampleY);
                int soft = sample(softened, sampleX, sampleY);
                float mix = 0.78F + 0.22F * smoothstep(0.0F, 0.6F, depth);
                float r = mixChannel(sharp, soft, 16, mix);
                float g = mixChannel(sharp, soft, 8, mix);
                float b = mixChannel(sharp, soft, 0, mix);

                // The pane's own colour, laid over what came through it.
                r = r * (1.0F - tintA) + tintR * tintA;
                g = g * (1.0F - tintA) + tintG * tintA;
                b = b * (1.0F - tintA) + tintB * tintA;

                // Light through the thick part of the pane picks up its colour.
                float edgeGlow = curve * curve * accentA;
                r += accentR * edgeGlow;
                g += accentG * edgeGlow;
                b += accentB * edgeGlow;

                // Diffuse, not specular. A polished pane returns a tight
                // highlight because its surface is a mirror; a frosted one
                // scatters that same light over a wide band, so the exponent
                // comes down and the whole upper edge lifts instead of one
                // bright streak on it.
                float facingUp = clamp(-ny, 0.0F, 1.0F);
                float facingDown = clamp(ny, 0.0F, 1.0F);
                float specular = curve
                    * (float) (Math.pow(facingUp, 1.4) * 0.42 + Math.pow(facingDown, 2.5) * 0.16);

                // The edge light. Wide and soft rather than a hairline: on
                // frosted glass the rim is where the scattering is densest, and
                // it reads as a band of light, not as a drawn outline.
                float offEdge = (-distance - HAIRLINE_AT) / HAIRLINE_WIDTH;
                float hairline = (float) Math.exp(-offEdge * offEdge) * 0.3F;

                float light = specular + hairline;
                r += light;
                g += light;
                b += light;

                int alpha = Math.round(clamp(coverage, 0.0F, 1.0F) * 255.0F);
                pane.setRGB(x, y, (alpha << 24)
                    | (channel(r) << 16)
                    | (channel(g) << 8)
                    | channel(b));
            }
        }
        return pane;
    }

    /**
     * Distance from a rounded rectangle centred on the origin: negative inside,
     * positive outside, and the magnitude is how far.
     *
     * <p>The standard trick, and the only reason the rest of this is short. One
     * function answers both "am I in the pane" and "which way is its edge", and
     * it answers them the same way in the corners as along the sides — which is
     * where a hand-rolled version would go wrong first.
     */
    private static float roundedRectDistance(
        float x, float y, float halfWidth, float halfHeight, float radius
    ) {
        float dx = Math.abs(x) - (halfWidth - radius);
        float dy = Math.abs(y) - (halfHeight - radius);
        float outsideX = Math.max(dx, 0.0F);
        float outsideY = Math.max(dy, 0.0F);
        float outside = (float) Math.sqrt(outsideX * outsideX + outsideY * outsideY);
        float inside = Math.min(Math.max(dx, dy), 0.0F);
        return outside + inside - radius;
    }

    private static float mixChannel(int sharp, int soft, int shift, float mix) {
        float a = ((sharp >> shift) & 0xFF) / 255.0F;
        float b = ((soft >> shift) & 0xFF) / 255.0F;
        return a + (b - a) * mix;
    }

    private static int sample(BufferedImage image, int x, int y) {
        int clampedX = Math.min(Math.max(x, 0), image.getWidth() - 1);
        int clampedY = Math.min(Math.max(y, 0), image.getHeight() - 1);
        return image.getRGB(clampedX, clampedY);
    }

    private static int channel(float value) {
        int scaled = Math.round(clamp(value, 0.0F, 1.0F) * 255.0F);
        return Math.min(255, Math.max(0, scaled));
    }

    private static float clamp(float value, float low, float high) {
        return value < low ? low : (value > high ? high : value);
    }

    private static float smoothstep(float from, float to, float value) {
        float t = clamp((value - from) / (to - from), 0.0F, 1.0F);
        return t * t * (3.0F - 2.0F * t);
    }

    /** Two passes of a separable box, which is enough softening for a backdrop. */
    private static BufferedImage boxBlur(BufferedImage source, int radius) {
        BufferedImage image = source;
        for (int pass = 0; pass < 2; pass += 1) {
            image = blurAxis(image, radius, true);
            image = blurAxis(image, radius, false);
        }
        return image;
    }

    private static BufferedImage blurAxis(BufferedImage source, int radius, boolean horizontal) {
        int width = source.getWidth();
        int height = source.getHeight();
        BufferedImage out = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        int span = radius * 2 + 1;
        for (int major = 0; major < (horizontal ? height : width); major += 1) {
            for (int minor = 0; minor < (horizontal ? width : height); minor += 1) {
                int r = 0;
                int g = 0;
                int b = 0;
                for (int step = -radius; step <= radius; step += 1) {
                    int at = Math.min(
                        Math.max(minor + step, 0), (horizontal ? width : height) - 1
                    );
                    int rgb = horizontal
                        ? source.getRGB(at, major)
                        : source.getRGB(major, at);
                    r += (rgb >> 16) & 0xFF;
                    g += (rgb >> 8) & 0xFF;
                    b += rgb & 0xFF;
                }
                int rgb = ((r / span) << 16) | ((g / span) << 8) | (b / span);
                if (horizontal) {
                    out.setRGB(minor, major, rgb);
                } else {
                    out.setRGB(major, minor, rgb);
                }
            }
        }
        return out;
    }
}
