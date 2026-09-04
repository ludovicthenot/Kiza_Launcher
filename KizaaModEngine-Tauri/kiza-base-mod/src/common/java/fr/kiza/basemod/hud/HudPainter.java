package fr.kiza.basemod.hud;

import fr.kiza.basemod.MenuLogoRenderer;
import fr.kiza.basemod.render.KizaGlass;
import fr.kiza.basemod.render.KizaText;

/**
 * Draws a placed card into the game.
 *
 * <p>Two paths, and the second one matters. When the Java2D canvas is available
 * a card is a glass texture with TrueType labels blitted over it. When it is
 * not — a stripped JRE with no {@code java.desktop}, a Minecraft build whose
 * texture manager moved — it becomes flat rectangles and the vanilla font. That
 * is not glass and does not pretend to be, but it is legible, and the HUD
 * carries information the player is using. Losing the finish is a
 * disappointment; losing the coordinates in a cave is a problem.
 *
 * <p>Java 8 syntax: this compiles into the legacy jar as well as the modern one.
 */
public final class HudPainter {
    /** Measures with the same renderer that will draw, so layout is exact. */
    public static final HudCard.Measurer MEASURER = new HudCard.Measurer() {
        @Override
        public int width(String text, int sizePx) {
            if (text == null || text.isEmpty()) return 0;
            if (KizaText.isAvailable()) {
                int measured = KizaText.width(text, sizePx);
                if (measured > 0) return measured;
            }
            // Vanilla's font is six pixels a character including its spacing,
            // and it does not scale, so a smaller size still measures the same.
            return text.length() * 6;
        }
    };

    private HudPainter() {}

    public static void draw(Object graphics, Object screen, HudLayout.Placement placement) {
        HudCard card = placement.card();
        drawPanel(graphics, placement, card.accented());

        int x = placement.x() + HudTheme.PADDING_X;
        int y = placement.y() + HudTheme.PADDING_Y;

        if (card.title() != null) {
            drawText(graphics, screen, card.title(), x, y, HudTheme.TITLE_SIZE, HudTheme.TEXT);
            y += HudTheme.ROW_HEIGHT + 1;
        }

        int right = placement.x() + placement.width() - HudTheme.PADDING_X;
        for (HudCard.Row row : card.rows()) {
            drawText(graphics, screen, row.label(), x, y, HudTheme.TEXT_SIZE, HudTheme.TEXT_MUTED);
            if (row.value() != null) {
                int valueWidth = MEASURER.width(row.value(), HudTheme.TEXT_SIZE);
                // Set against the right edge rather than at a fixed column: the
                // rows of one card are not the same length and a column chosen
                // for the longest leaves the others adrift.
                drawText(
                    graphics, screen, row.value(),
                    right - valueWidth, y,
                    HudTheme.TEXT_SIZE, row.valueColor()
                );
            }
            y += HudTheme.ROW_HEIGHT;
        }
    }

    private static void drawPanel(
        Object graphics,
        HudLayout.Placement placement,
        boolean accented
    ) {
        int pad = HudTheme.SHADOW_PAD;
        int imageWidth = placement.width() + pad * 2;
        int imageHeight = placement.height() + pad * 2;
        int edge = accented ? HudTheme.PANEL_EDGE_ACCENT : HudTheme.FLAT_EDGE;

        Object texture = KizaGlass.texture(
            imageWidth,
            imageHeight,
            pad,
            HudTheme.RADIUS,
            HudTheme.FLAT_PANEL,
            edge,
            HudTheme.FLAT_SHEEN,
            HudTheme.FLAT_SHADOW
        );
        if (texture != null) {
            int supersample = KizaGlass.supersample();
            MenuLogoRenderer.blitTexture(
                graphics,
                texture,
                placement.x() - pad,
                placement.y() - pad,
                imageWidth,
                imageHeight,
                imageWidth * supersample,
                imageHeight * supersample
            );
            return;
        }

        // No canvas: a flat panel, and no shadow, because a shadow made of
        // stacked rectangles looks like a mistake rather than a shadow.
        MenuLogoRenderer.roundedFill(
            graphics,
            placement.x(),
            placement.y(),
            placement.x() + placement.width(),
            placement.y() + placement.height(),
            HudTheme.RADIUS,
            HudTheme.FLAT_PANEL
        );
    }

    private static void drawText(
        Object graphics,
        Object screen,
        String text,
        int x,
        int y,
        int sizePx,
        int argb
    ) {
        if (text == null || text.isEmpty()) return;
        if (KizaText.isAvailable()) {
            int[] size = KizaText.prepare(text, sizePx, argb);
            if (size != null) {
                Object identifier = KizaText.identifier(text, sizePx, argb);
                if (identifier != null) {
                    MenuLogoRenderer.blitTexture(
                        graphics, identifier, x, y, size[0], size[1], size[0], size[1]
                    );
                    return;
                }
            }
        }
        // The vanilla font ignores the size it was asked for. Nothing to be done
        // about that, and a HUD in one size is still a HUD.
        MenuLogoRenderer.drawText(graphics, screen, text, x, y, argb);
    }
}
