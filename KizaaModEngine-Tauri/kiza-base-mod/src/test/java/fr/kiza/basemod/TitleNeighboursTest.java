package fr.kiza.basemod;

import java.util.ArrayList;
import java.util.List;

/**
 * The widgets beside a title button go where it goes: Minecraft's language
 * square beside Options, a mod's icon beside Singleplayer.
 */
public final class TitleNeighboursTest {

    public static void main(String[] args) {
        anIconLeftOfAButtonStaysOnItsLeft();
        anIconRightOfAButtonStaysOnItsRight();
        aWidgetFarFromEveryButtonIsLeftAlone();
        aWidgetOnAnotherRowIsLeftAlone();
        aProgramsNameIsNotALabel();
        theLanguageSquareGoesOutsideTheColumn();
        System.out.println("TitleNeighboursTest OK");
    }

    /** Singleplayer was at 100,120, 200 wide; it moved to 220,200. */
    private static List<int[][]> singleplayerMoved() {
        List<int[][]> anchors = new ArrayList<>();
        anchors.add(new int[][] {{100, 120, 200, 20}, {220, 200, 200, 22}});
        return anchors;
    }

    private static void anIconLeftOfAButtonStaysOnItsLeft() {
        // Flashback's icon, four pixels left of Singleplayer.
        int[] target = TitleMenuController.besideAnchor(new int[] {76, 120, 20, 20}, singleplayerMoved());
        assert target != null : "an icon beside a button follows it";
        assert target[0] == 220 - 4 - 20 : "on the same side, a gap away: " + target[0];
        assert target[1] == 200 + 1 : "centred on the button's new row: " + target[1];
    }

    private static void anIconRightOfAButtonStaysOnItsRight() {
        int[] target = TitleMenuController.besideAnchor(new int[] {304, 120, 20, 20}, singleplayerMoved());
        assert target != null && target[0] == 220 + 200 + 4 : "on the right, a gap away";
    }

    private static void aWidgetFarFromEveryButtonIsLeftAlone() {
        assert TitleMenuController.besideAnchor(new int[] {4, 120, 20, 20}, singleplayerMoved()) == null;
    }

    private static void aProgramsNameIsNotALabel() {
        assert TitleMenuController.isPlaceholderLabel("<essential_invite_button>");
        assert TitleMenuController.isPlaceholderLabel("<ESSENTIAL_SOCIAL>");
        assert TitleMenuController.isPlaceholderLabel("replay_viewer");
        assert !TitleMenuController.isPlaceholderLabel("Replay Viewer");
        assert !TitleMenuController.isPlaceholderLabel("Mods");
        assert !TitleMenuController.isPlaceholderLabel("Quit Game");
        assert !TitleMenuController.isPlaceholderLabel("");
    }

    /**
     * Options was the left half of the last row in vanilla; in Kiza's grid it
     * may be the right half. The anchor is then the whole column, so the
     * square lands outside it, not on the button beside Options.
     */
    private static void theLanguageSquareGoesOutsideTheColumn() {
        List<int[][]> anchors = new ArrayList<>();
        // Options was at 100,168; the column it is now in starts at 220.
        anchors.add(new int[][] {{100, 168, 98, 20}, {220, 260, 200, 22}});
        int[] target = TitleMenuController.besideAnchor(new int[] {76, 168, 20, 20}, anchors);
        assert target != null && target[0] == 220 - 4 - 20 : "left of the column";
    }

    private static void aWidgetOnAnotherRowIsLeftAlone() {
        assert TitleMenuController.besideAnchor(new int[] {76, 300, 20, 20}, singleplayerMoved()) == null;
    }
}
