package fr.kiza.basemod.render;

import java.awt.Color;
import java.awt.Font;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

/**
 * Renders the in-game menu buttons to a PNG, so the material can be judged
 * without launching Minecraft.
 *
 * <p>The glass is the real one: {@link KizaGlass#paint} draws these panes
 * exactly as {@code TitleMenuController} draws them in the game, at the same
 * sizes and with the same colours. What is faked is Minecraft — the blurred
 * world behind the pause menu is painted here, and the labels go straight onto
 * the image instead of through the texture upload the game needs.
 *
 * <p>So this answers "does it look right" and not "does it run", which is the
 * question a screenshot can answer and a unit test cannot. A material that can
 * only be judged by starting a game, joining a world and pressing Escape is a
 * material nobody checks twice.
 *
 *     node kiza-base-mod/build.mjs --preview
 */
public final class MenuPreview {
    private static final int MENU_WIDTH = 640;
    private static final int MENU_HEIGHT = 360;
    /** The GUI scale a player on a 1280x720 window would be using. */
    private static final int SCALE = 2;

    private static final int BUTTON_WIDTH = 200;
    private static final int BUTTON_HEIGHT = 20;

    private MenuPreview() {}

    public static void main(String[] arguments) throws Exception {
        File output = new File(arguments.length > 0 ? arguments[0] : "menu-preview.png");

        BufferedImage image = new BufferedImage(
            MENU_WIDTH * SCALE, MENU_HEIGHT * SCALE, BufferedImage.TYPE_INT_RGB
        );
        Graphics2D graphics = image.createGraphics();
        graphics.setRenderingHint(
            RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON
        );
        graphics.setRenderingHint(
            RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR
        );
        graphics.setRenderingHint(
            RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON
        );

        paintPausedWorld(graphics);

        int left = (MENU_WIDTH - BUTTON_WIDTH) / 2;
        int top = 96;

        // The three states, in the order somebody meets them: the one the menu
        // wants you to take, the ones that are simply there, and the one under
        // the pointer. Shown together because the difference between them is
        // the rim, and a rim is only judged against another rim.
        button(graphics, left, top, "Back to Game", true, false);
        button(graphics, left, top + 28, "Advancements", false, false);
        button(graphics, left, top + 56, "Mods", false, true);
        button(graphics, left, top + 84, "Options...", false, false);
        button(graphics, left, top + 112, "Save and Quit to Title", false, false);

        graphics.dispose();
        ImageIO.write(image, "PNG", output);

        // A button is judged at the size a button is: the difference between a
        // rim that reads as an edge catching light and one that reads as a line
        // somebody drew is a couple of pixels, and it disappears in a full
        // screenshot.
        File detail = new File(output.getParentFile(), "menu-preview-detail.png");
        ImageIO.write(magnify(image, left * SCALE - 20, top * SCALE - 20, 260, 180, 3), "PNG", detail);

        System.out.println("Menu preview: " + output.getAbsolutePath());
        System.out.println("Menu detail:  " + detail.getAbsolutePath());
    }

    /** One button, drawn the way TitleMenuController draws it. */
    private static void button(
        Graphics2D graphics, int x, int y, String label, boolean primary, boolean hovered
    ) {
        int radius = Math.min(3, BUTTON_HEIGHT / 2);
        int fill = hovered
            ? KizaMaterial.SURFACE_HOVER
            : (primary ? KizaMaterial.SURFACE_PRIMARY : KizaMaterial.SURFACE);
        int edge = hovered
            ? KizaMaterial.EDGE_HOVER
            : (primary ? KizaMaterial.EDGE_PRIMARY : KizaMaterial.EDGE);

        BufferedImage pane = KizaGlass.paint(
            BUTTON_WIDTH, BUTTON_HEIGHT, 0, radius, fill, edge, KizaMaterial.SHEEN, 0
        );
        if (pane != null) {
            graphics.drawImage(
                pane,
                x * SCALE, y * SCALE,
                BUTTON_WIDTH * SCALE, BUTTON_HEIGHT * SCALE,
                null
            );
        }

        // What vanilla leaves behind, drawn so the preview is honest about it:
        // its own button is still under there and has to be covered by a square,
        // so four corners of that cover sit outside the rounded glass.
        graphics.setColor(new Color(0xFF08070D, true));
        int r = radius * SCALE;
        graphics.fillRect(x * SCALE, y * SCALE, r, r);
        graphics.fillRect((x + BUTTON_WIDTH) * SCALE - r, y * SCALE, r, r);
        graphics.fillRect(x * SCALE, (y + BUTTON_HEIGHT) * SCALE - r, r, r);
        graphics.fillRect((x + BUTTON_WIDTH) * SCALE - r, (y + BUTTON_HEIGHT) * SCALE - r, r, r);
        if (pane != null) {
            graphics.drawImage(
                pane,
                x * SCALE, y * SCALE,
                BUTTON_WIDTH * SCALE, BUTTON_HEIGHT * SCALE,
                null
            );
        }

        // The weight the game will use, or the preview is of a different menu.
        Font font = KizaText.face(10 * SCALE, true);
        if (font == null) return;
        graphics.setFont(font);
        graphics.setColor(new Color(0xFFF4F2FA, true));
        int textWidth = graphics.getFontMetrics().stringWidth(label);
        int ascent = graphics.getFontMetrics().getAscent();
        int descent = graphics.getFontMetrics().getDescent();
        graphics.drawString(
            label,
            x * SCALE + (BUTTON_WIDTH * SCALE - textWidth) / 2,
            y * SCALE + (BUTTON_HEIGHT * SCALE - ascent - descent) / 2 + ascent
        );
    }

    /** A region of the render, blown up with no smoothing so edges stay honest. */
    private static BufferedImage magnify(
        BufferedImage source, int x, int y, int width, int height, int factor
    ) {
        int clampedX = Math.max(0, Math.min(x, source.getWidth() - width));
        int clampedY = Math.max(0, Math.min(y, source.getHeight() - height));
        BufferedImage crop = source.getSubimage(clampedX, clampedY, width, height);
        BufferedImage large = new BufferedImage(
            width * factor, height * factor, BufferedImage.TYPE_INT_RGB
        );
        Graphics2D graphics = large.createGraphics();
        graphics.setRenderingHint(
            RenderingHints.KEY_INTERPOLATION,
            RenderingHints.VALUE_INTERPOLATION_NEAREST_NEIGHBOR
        );
        graphics.drawImage(crop, 0, 0, width * factor, height * factor, null);
        graphics.dispose();
        return large;
    }

    /**
     * What a pause menu actually sits on: the world, blurred by Minecraft's own
     * background effect, and darkened.
     *
     * <p>Deliberately not flat. A shadow and a rim are invisible against an even
     * colour, and every real pause screen has a horizon, a sky and some ground
     * behind it — light above the buttons and dark below, which is exactly the
     * arrangement a top-lit rim is tuned for.
     */
    private static void paintPausedWorld(Graphics2D graphics) {
        int width = MENU_WIDTH * SCALE;
        int height = MENU_HEIGHT * SCALE;
        int horizon = (int) (height * 0.52F);

        graphics.setPaint(new GradientPaint(
            0, 0, new Color(0x1B2A4A),
            0, horizon, new Color(0x6E7FA8)
        ));
        graphics.fillRect(0, 0, width, horizon);

        graphics.setPaint(new GradientPaint(
            0, horizon, new Color(0x40563A),
            0, height, new Color(0x1E2A1C)
        ));
        graphics.fillRect(0, horizon, width, height - horizon);

        // Blurry blocks, the shape a blurred world keeps.
        for (int row = 0; row < 6; row += 1) {
            for (int column = 0; column * 90 < width; column += 1) {
                if ((row + column) % 2 != 0) continue;
                graphics.setColor(new Color(255, 255, 255, 10));
                graphics.fillRoundRect(
                    column * 90, horizon - 60 + row * 70, 74, 54, 30, 30
                );
            }
        }

        // The scrim Minecraft lays over a paused world.
        graphics.setColor(new Color(0, 0, 0, 110));
        graphics.fillRect(0, 0, width, height);
    }
}
