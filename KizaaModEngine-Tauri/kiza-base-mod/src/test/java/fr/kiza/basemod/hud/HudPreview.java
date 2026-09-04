package fr.kiza.basemod.hud;

import fr.kiza.basemod.render.KizaLens;
import fr.kiza.basemod.render.KizaText;
import java.awt.Color;
import java.awt.Font;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import javax.imageio.ImageIO;

/**
 * Renders the HUD to a PNG so it can be looked at without launching Minecraft.
 *
 * <p>The glass and the layout are the real ones: {@link KizaGlass#paint} draws
 * the panels and {@link HudLayout} places them, exactly as in the game. What is
 * faked is Minecraft — the background is painted here, and the labels go
 * straight onto the image instead of through the texture upload the game needs.
 * So this answers "does it look right" and not "does it run", which is the
 * question a screenshot can answer and a unit test cannot.
 *
 * <p>The background is deliberately awkward: a bright sky in one corner and a
 * cave in another. A translucent panel tuned against one of them is unreadable
 * against the other, and that is the failure this exists to catch.
 *
 *     node kiza-base-mod/build.mjs --preview
 */
public final class HudPreview {
    private static final int HUD_WIDTH = 640;
    private static final int HUD_HEIGHT = 360;
    /** The GUI scale a player on a 1280x720 window would be using. */
    private static final int SCALE = 2;

    private HudPreview() {}

    public static void main(String[] arguments) throws Exception {
        File output = new File(arguments.length > 0 ? arguments[0] : "hud-preview.png");

        BufferedImage image = new BufferedImage(
            HUD_WIDTH * SCALE, HUD_HEIGHT * SCALE, BufferedImage.TYPE_INT_RGB
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

        paintFakeWorld(graphics);

        List<HudLayout.Placement> placements =
            HudLayout.arrange(sampleCards(), HUD_WIDTH, HUD_HEIGHT, MEASURER);
        for (HudLayout.Placement placement : placements) {
            paintCard(graphics, image, placement);
        }

        graphics.dispose();
        ImageIO.write(image, "PNG", output);

        // A panel is judged at the size a panel is: the difference between a
        // rim that reads as glass and one that reads as a border is a couple of
        // pixels, and it disappears in a full screenshot.
        File detail = new File(output.getParentFile(), "hud-preview-detail.png");
        ImageIO.write(magnify(image, 0, 0, 260, 180, 3), "PNG", detail);
        System.out.println(
            "HUD preview: " + placements.size() + " panels -> " + output.getAbsolutePath()
        );
        System.out.println("HUD detail:  " + detail.getAbsolutePath());
    }

    /** A region of the render, blown up with no smoothing so edges stay honest. */
    private static BufferedImage magnify(
        BufferedImage source, int x, int y, int width, int height, int factor
    ) {
        BufferedImage crop = source.getSubimage(x, y, width, height);
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
     * The panels the game draws, plus the ones it will draw next.
     *
     * <p>{@link HudRenderer#cards} is asked first, so what is previewed is what
     * ships. The extras below are marked as such: they are the cards waiting on
     * the player being read through each loader's mappings, and they are here so
     * the layout can be judged with a realistic number of panels on screen
     * rather than two.
     */
    static List<HudCard> sampleCards() {
        HudSession session = new HudSession(System.nanoTime() - 6_128_000_000_000L);
        // Enough frames in one window that the counter has a rate to report.
        long base = System.nanoTime() - 1_100_000_000L;
        for (int frame = 0; frame < 142; frame += 1) {
            session.frame(base + frame);
        }
        session.frame(System.nanoTime());

        List<HudCard> cards = new ArrayList<HudCard>(
            HudRenderer.cards(session, System.nanoTime())
        );

        cards.add(HudCard.at("coordinates", HudCorner.TOP_LEFT)
            .row("X", "113")
            .row("Y", "235")
            .row("Z", "493")
            .build());

        cards.add(HudCard.at("effects", HudCorner.TOP_RIGHT)
            .title("Effects")
            .row("Strength II", "1:07")
            .row("Speed II", "1:00")
            .row("Fire Resistance", "6:53", HudTheme.ACCENT_SOFT)
            .build());

        return cards;
    }

    /**
     * Measured with the real measurer: {@link KizaText#width} needs no Minecraft
     * and is what the game uses whenever the canvas is available.
     */
    static final HudCard.Measurer MEASURER = new HudCard.Measurer() {
        @Override
        public int width(String text, int sizePx) {
            if (text == null || text.isEmpty()) return 0;
            int measured = KizaText.width(text, sizePx);
            return measured > 0 ? measured : text.length() * 6;
        }
    };

    private static void paintCard(
        Graphics2D graphics, BufferedImage canvas, HudLayout.Placement placement
    ) {
        HudCard card = placement.card();
        // The pane reads the scene it is standing in front of. Drawn in order,
        // so a panel over another panel refracts that one too -- which is what
        // glass over glass actually does.
        BufferedImage pane = KizaLens.refract(
            canvas,
            placement.x() * SCALE,
            placement.y() * SCALE,
            placement.width() * SCALE,
            placement.height() * SCALE,
            HudTheme.LENS_RADIUS * SCALE,
            HudTheme.PANEL,
            card.accented() ? HudTheme.PANEL_EDGE_ACCENT : HudTheme.PANEL_EDGE
        );
        if (pane != null) {
            graphics.drawImage(pane, placement.x() * SCALE, placement.y() * SCALE, null);
        }

        int x = placement.x() + HudTheme.PADDING_X;
        int y = placement.y() + HudTheme.PADDING_Y;

        if (card.title() != null) {
            label(graphics, card.title(), x, y, HudTheme.TITLE_SIZE, HudTheme.TEXT);
            y += HudTheme.ROW_HEIGHT + 1;
        }
        int right = placement.x() + placement.width() - HudTheme.PADDING_X;
        for (HudCard.Row row : card.rows()) {
            label(graphics, row.label(), x, y, HudTheme.TEXT_SIZE, HudTheme.TEXT_MUTED);
            if (row.value() != null) {
                int width = MEASURER.width(row.value(), HudTheme.TEXT_SIZE);
                label(
                    graphics, row.value(), right - width, y,
                    HudTheme.TEXT_SIZE, row.valueColor()
                );
            }
            y += HudTheme.ROW_HEIGHT;
        }
    }

    private static void label(
        Graphics2D graphics, String text, int x, int y, int sizePx, int argb
    ) {
        Font font = KizaText.face(sizePx * SCALE);
        if (font == null) return;
        graphics.setFont(font);
        graphics.setColor(new Color(argb, true));
        graphics.drawString(
            text, x * SCALE, y * SCALE + graphics.getFontMetrics().getAscent()
        );
    }

    /**
     * A scene with enough in it to bend.
     *
     * <p>Refraction is invisible against a flat colour: a pane over an even sky
     * bends an even sky into an even sky. So this is deliberately busy — a sun
     * low enough to sit behind the top-left stack, a blocky horizon, a dark cave
     * mouth under the right-hand one. If the edges do not light up against this,
     * they will not light up in a game either.
     */
    private static void paintFakeWorld(Graphics2D graphics) {
        int width = HUD_WIDTH * SCALE;
        int height = HUD_HEIGHT * SCALE;
        int horizon = (int) (height * 0.58F);

        graphics.setPaint(new GradientPaint(
            0, 0, new Color(0x2B3F6B),
            0, horizon, new Color(0xF0A65C)
        ));
        graphics.fillRect(0, 0, width, height);

        // A low sun, right behind the watermark, which is the hardest thing a
        // translucent panel can be asked to sit in front of.
        for (int ring = 9; ring >= 1; ring -= 1) {
            int size = ring * 58;
            graphics.setColor(new Color(255, 226, 170, 16));
            graphics.fillOval(150 - size / 2, horizon - 40 - size / 2, size, size);
        }
        graphics.setColor(new Color(0xFFF3D0));
        graphics.fillOval(150 - 38, horizon - 40 - 38, 76, 76);

        // Clouds: long soft bands, the detail a lens smears most visibly.
        for (int band = 0; band < 7; band += 1) {
            graphics.setColor(new Color(255, 255, 255, 26 + band * 5));
            int y = 40 + band * 46;
            graphics.fillRoundRect(-120 + band * 190, y, 520 - band * 30, 26, 26, 26);
        }

        // Blocky ground, because this is Minecraft and straight edges are what
        // a lens distorts most legibly.
        graphics.setColor(new Color(0x2E4A22));
        graphics.fillRect(0, horizon, width, height - horizon);
        for (int column = 0; column * 48 < width; column += 1) {
            graphics.setColor(new Color(column % 2 == 0 ? 0x3A5C2A : 0x335124));
            graphics.fillRect(column * 48, horizon - (column % 3) * 16, 48, 48);
        }
        graphics.setColor(new Color(0x101A0C));
        for (int row = 0; row * 44 + horizon < height; row += 1) {
            for (int column = 0; column * 44 < width; column += 1) {
                if ((row + column) % 3 != 0) continue;
                graphics.fillRect(column * 44, horizon + 40 + row * 44, 44, 44);
            }
        }

        // The cave, under the right-hand stack.
        graphics.setColor(new Color(0x0B0910));
        graphics.fillRoundRect(
            (int) (width * 0.62F), 0, (int) (width * 0.36F), (int) (height * 0.42F), 70, 70
        );
    }
}
