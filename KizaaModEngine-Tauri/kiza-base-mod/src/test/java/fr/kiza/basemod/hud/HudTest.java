package fr.kiza.basemod.hud;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * The HUD's arithmetic, checked without Minecraft.
 *
 * <p>What is worth holding here is what a screenshot would not show: a stack
 * that leaves the screen on an unusual window size, a panel drawn with nothing
 * in it, a frame counter that reports a drop the player never had. The look is
 * checked by {@link HudPreview}, which produces a picture; this checks the
 * decisions behind it, which a picture cannot.
 */
public final class HudTest {
    /** Measures like the vanilla font: six pixels a character, no scaling. */
    private static final HudCard.Measurer SIX_PER_CHARACTER = new HudCard.Measurer() {
        @Override
        public int width(String text, int sizePx) {
            return text == null ? 0 : text.length() * 6;
        }
    };

    public static void main(String[] arguments) {
        emptyCardsAreNotDrawn();
        topStacksDownAndBottomStacksUp();
        rightHandCardsEndAtTheMargin();
        theBottomStackClearsTheHotbar();
        aCardTooTallForTheWindowIsDroppedNotSquashed();
        valuesAreMeasuredIntoTheWidth();
        theFrameRateWaitsForAWholeSecond();
        theFrameRateIsScaledByTheWindowThatElapsed();
        playedForReadsAsAClock();
        System.out.println("Kiza HUD tests passed");
    }

    /**
     * A panel with nothing in it is worse than no panel: the player has to look
     * at it to discover that, and it costs them the same screen either way.
     */
    private static void emptyCardsAreNotDrawn() {
        HudCard empty = HudCard.at("empty", HudCorner.TOP_LEFT).build();
        assert empty.isEmpty();
        assert arrange(Arrays.asList(empty)).isEmpty();

        // A row whose label is blank is not a row.
        HudCard blank = HudCard.at("blank", HudCorner.TOP_LEFT).line("   ").build();
        assert blank.isEmpty() : "a card of blank rows is empty";
    }

    private static void topStacksDownAndBottomStacksUp() {
        HudCard first = HudCard.at("first", HudCorner.TOP_LEFT).line("one").build();
        HudCard second = HudCard.at("second", HudCorner.TOP_LEFT).line("two").build();
        List<HudLayout.Placement> top = arrange(Arrays.asList(first, second));
        assert top.size() == 2;
        assert top.get(0).y() < top.get(1).y() : "the top corner stacks downwards";
        assert top.get(1).y() >= top.get(0).y() + top.get(0).height()
            : "stacked panels do not overlap";

        HudCard low = HudCard.at("low", HudCorner.BOTTOM_LEFT).line("one").build();
        HudCard lower = HudCard.at("lower", HudCorner.BOTTOM_LEFT).line("two").build();
        List<HudLayout.Placement> bottom = arrange(Arrays.asList(low, lower));
        assert bottom.size() == 2;
        assert bottom.get(1).y() < bottom.get(0).y() : "the bottom corner stacks upwards";
    }

    private static void rightHandCardsEndAtTheMargin() {
        HudCard card = HudCard.at("right", HudCorner.TOP_RIGHT).row("Ping", "24 ms").build();
        HudLayout.Placement placed = arrange(Arrays.asList(card)).get(0);
        assert placed.x() + placed.width() == 640 - HudTheme.MARGIN
            : "a right-anchored card ends at the margin, whatever it holds";
    }

    /**
     * The hotbar, the health and the experience bar all live along the bottom
     * centre, and the health runs wider than the hotbar itself. A HUD that
     * covers them is a HUD the player turns off.
     */
    private static void theBottomStackClearsTheHotbar() {
        HudCard card = HudCard.at("low", HudCorner.BOTTOM_RIGHT).line("one").build();
        HudLayout.Placement placed = arrange(Arrays.asList(card)).get(0);
        assert placed.y() + placed.height() <= 360 - 44
            : "the bottom stack stops short of the vanilla bars";
    }

    private static void aCardTooTallForTheWindowIsDroppedNotSquashed() {
        List<HudCard> many = new ArrayList<HudCard>();
        for (int index = 0; index < 40; index += 1) {
            many.add(HudCard.at("card" + index, HudCorner.TOP_LEFT).line("row").build());
        }
        List<HudLayout.Placement> placed = arrange(many);
        assert placed.size() < many.size() : "a full corner stops taking cards";
        for (HudLayout.Placement placement : placed) {
            assert placement.y() >= HudTheme.MARGIN;
            assert placement.y() + placement.height() <= 360 - HudTheme.MARGIN
                : "nothing is placed off the bottom of the screen";
        }
    }

    /** Otherwise "Fire Resistance" and "6:53" overlap on the longest row. */
    private static void valuesAreMeasuredIntoTheWidth() {
        HudCard labelOnly = HudCard.at("a", HudCorner.TOP_LEFT).line("Strength II").build();
        HudCard withValue = HudCard.at("b", HudCorner.TOP_LEFT)
            .row("Strength II", "1:07")
            .build();
        assert withValue.contentWidth(SIX_PER_CHARACTER)
            > labelOnly.contentWidth(SIX_PER_CHARACTER);

        HudCard titled = HudCard.at("c", HudCorner.TOP_LEFT).title("Effects").line("x").build();
        assert titled.contentHeight() > HudCard.at("d", HudCorner.TOP_LEFT)
            .line("x").build().contentHeight() : "a title takes a row of its own";
    }

    private static void theFrameRateWaitsForAWholeSecond() {
        HudSession session = new HudSession(0L);
        for (int frame = 0; frame < 30; frame += 1) {
            session.frame(frame * 10_000_000L);
        }
        assert session.fps() == 0 : "no rate is reported before there is a second to divide by";
    }

    /**
     * A stalled frame makes the window longer than a second. Dividing the count
     * by one anyway reports a drop the player never had — the number would dip
     * every time the game hitched, which is exactly when it is being read.
     */
    private static void theFrameRateIsScaledByTheWindowThatElapsed() {
        HudSession session = new HudSession(0L);
        // 60 frames spread over two seconds is thirty a second, not sixty.
        for (int frame = 1; frame <= 60; frame += 1) {
            session.frame(frame * 33_333_333L);
        }
        assert session.fps() > 25 && session.fps() < 35
            : "expected about thirty, got " + session.fps();
    }

    private static void playedForReadsAsAClock() {
        HudSession session = new HudSession(0L);
        assert "0:07".equals(session.playedFor(7_000_000_000L));
        assert "3:05".equals(session.playedFor(185_000_000_000L));
        assert "1:42:08".equals(session.playedFor(6_128_000_000_000L));
        // A clock that runs backwards on a clock adjustment would be worse than
        // one that sits at zero for a moment.
        assert "0:00".equals(session.playedFor(-5_000_000_000L));
    }

    private static List<HudLayout.Placement> arrange(List<HudCard> cards) {
        return HudLayout.arrange(cards, 640, 360, SIX_PER_CHARACTER);
    }
}
