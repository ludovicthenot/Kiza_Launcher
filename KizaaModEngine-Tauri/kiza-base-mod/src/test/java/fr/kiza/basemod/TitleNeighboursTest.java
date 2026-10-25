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
        assert TitleMenuController.readableLabel("<essential_wardrobe_button>").equals("Wardrobe");
        assert TitleMenuController.readableLabel("<ESSENTIAL_INVITE_FRIENDS>").equals("Invite friends");
        assert TitleMenuController.readableLabel("replay_viewer").equals("Replay viewer");
        assert TitleMenuController.readableLabel("Replay Viewer").equals("Replay Viewer");
    }

    private static void aWidgetOnAnotherRowIsLeftAlone() {
        assert TitleMenuController.besideAnchor(new int[] {76, 300, 20, 20}, singleplayerMoved()) == null;
    }
}
