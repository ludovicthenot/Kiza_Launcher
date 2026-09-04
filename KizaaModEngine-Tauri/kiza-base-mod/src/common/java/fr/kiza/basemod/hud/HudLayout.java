package fr.kiza.basemod.hud;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * Where each card goes, worked out with no drawing involved.
 *
 * <p>Kept apart from the painting on purpose. Placement is the part that has
 * rules worth checking — panels stack downwards from the top corners and
 * upwards from the bottom ones, they keep clear of the hotbar, they never leave
 * the screen — and it is the only part that can be checked without Minecraft.
 * A layout that can only be verified by squinting at a screenshot is a layout
 * that silently breaks on the first unusual window size.
 *
 * <p>Java 8 syntax: this compiles into the legacy jar as well as the modern one.
 */
public final class HudLayout {
    /** A card and the box it occupies, in GUI pixels. */
    public static final class Placement {
        private final HudCard card;
        private final int x;
        private final int y;
        private final int width;
        private final int height;

        Placement(HudCard card, int x, int y, int width, int height) {
            this.card = card;
            this.x = x;
            this.y = y;
            this.width = width;
            this.height = height;
        }

        public HudCard card() {
            return card;
        }

        public int x() {
            return x;
        }

        public int y() {
            return y;
        }

        public int width() {
            return width;
        }

        public int height() {
            return height;
        }
    }

    private HudLayout() {}

    /**
     * Places every card that has something to say.
     *
     * <p>Order within a corner is the order given. Empty cards are dropped
     * rather than drawn as a bare rim: a panel with nothing in it is worse than
     * no panel, because the player has to look at it to find that out.
     */
    public static List<Placement> arrange(
        List<HudCard> cards,
        int screenWidth,
        int screenHeight,
        HudCard.Measurer measurer
    ) {
        List<Placement> placed = new ArrayList<Placement>();
        if (screenWidth <= 0 || screenHeight <= 0) return placed;

        Map<HudCorner, Integer> consumed = new EnumMap<HudCorner, Integer>(HudCorner.class);
        for (HudCorner corner : HudCorner.values()) {
            consumed.put(corner, 0);
        }

        for (HudCard card : cards) {
            if (card == null || card.isEmpty()) continue;

            int width = card.contentWidth(measurer) + HudTheme.PADDING_X * 2;
            int height = card.contentHeight() + HudTheme.PADDING_Y * 2;

            // A card wider than the screen is a card with a very long server
            // name in it. Clamping is not pretty, but a panel that runs off the
            // edge takes its own text with it.
            int maxWidth = screenWidth - HudTheme.MARGIN * 2;
            if (maxWidth <= 0) continue;
            if (width > maxWidth) width = maxWidth;

            HudCorner corner = card.corner();
            int taken = consumed.get(corner);
            int x = corner.x(screenWidth, width);
            int y = corner.y(screenHeight, height, taken);

            // Stop stacking rather than draw over the opposite edge: on a short
            // window the last cards are the ones the player misses least.
            if (y < HudTheme.MARGIN || y + height > screenHeight - HudTheme.MARGIN) continue;

            placed.add(new Placement(card, x, y, width, height));
            consumed.put(corner, taken + height + HudTheme.GAP);
        }
        return placed;
    }
}
