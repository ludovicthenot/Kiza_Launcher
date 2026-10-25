package fr.kiza.basemod.menu;

import java.util.Arrays;
import java.util.List;

/**
 * The title grid's rules, checked without a game.
 *
 *     node kiza-base-mod/build.mjs --test
 */
public final class MenuDesignTest {
    private MenuDesignTest() {}

    public static void main(String[] arguments) {
        rolesAreReadFromKeysAndFromLabels();
        theGridPutsPlayFirstAndPairsTheRest();
        anOddButtonTakesTheWholeRow();
        aModsButtonKeepsItsPlace();
        aMenuItCannotReadIsLeftAlone();
        labelsAreTrimmedForTheGrid();
        System.out.println("MenuDesignTest OK");
    }

    private static void rolesAreReadFromKeysAndFromLabels() {
        check(MenuDesign.roleOf("menu.singleplayer", "anything") == MenuDesign.Role.SINGLEPLAYER, "key wins");
        check(MenuDesign.roleOf("fml.menu.mods", "") == MenuDesign.Role.MODS, "Forge's Mods");
        check(MenuDesign.roleOf("modmenu.title", "") == MenuDesign.Role.MODS, "Mod Menu's Mods");
        check(MenuDesign.roleOf(null, "Solo") == MenuDesign.Role.SINGLEPLAYER, "French singleplayer");
        check(MenuDesign.roleOf(null, "Multijoueur") == MenuDesign.Role.MULTIPLAYER, "French multiplayer");
        check(MenuDesign.roleOf(null, "Quitter le jeu") == MenuDesign.Role.QUIT, "French quit");
        check(MenuDesign.roleOf(null, "Accessibility Settings") == MenuDesign.Role.OTHER, "unknown stays unknown");
    }

    private static void theGridPutsPlayFirstAndPairsTheRest() {
        // In the order vanilla holds them, Quit before Options to prove the
        // grid sorts by role and not by where they came from.
        List<MenuDesign.Role> roles = Arrays.asList(
            MenuDesign.Role.SINGLEPLAYER,
            MenuDesign.Role.MULTIPLAYER,
            MenuDesign.Role.REALMS,
            MenuDesign.Role.QUIT,
            MenuDesign.Role.OPTIONS,
            MenuDesign.Role.MODS
        );
        MenuDesign.Plan plan = MenuDesign.plan(roles, 480, 300);
        check(plan != null, "a plan for the vanilla menu");
        MenuDesign.Slot single = plan.slots.get(0);
        MenuDesign.Slot multi = plan.slots.get(1);
        check(single.width == MenuDesign.COLUMN_WIDTH && multi.width == MenuDesign.COLUMN_WIDTH, "full rows");
        check(multi.y > single.y, "multiplayer under singleplayer");
        MenuDesign.Slot realms = plan.slots.get(2);
        MenuDesign.Slot mods = plan.slots.get(5);
        MenuDesign.Slot options = plan.slots.get(4);
        MenuDesign.Slot quit = plan.slots.get(3);
        check(realms.y == mods.y && realms.x < mods.x, "realms beside mods");
        check(options.y == quit.y && options.x < quit.x, "options beside quit");
        check(options.y > realms.y, "options and quit at the bottom");
        check(realms.width * 2 + MenuDesign.GAP == MenuDesign.COLUMN_WIDTH, "two halves and a gap fill the row");
        check(single.y > plan.wordmarkY, "buttons under the wordmark");
    }

    private static void anOddButtonTakesTheWholeRow() {
        List<MenuDesign.Role> roles = Arrays.asList(
            MenuDesign.Role.SINGLEPLAYER,
            MenuDesign.Role.MULTIPLAYER,
            MenuDesign.Role.OPTIONS,
            MenuDesign.Role.QUIT,
            MenuDesign.Role.REALMS
        );
        MenuDesign.Plan plan = MenuDesign.plan(roles, 480, 300);
        check(plan.slots.get(3).width == MenuDesign.COLUMN_WIDTH, "the last, alone, is full width");
    }

    private static void aModsButtonKeepsItsPlace() {
        List<MenuDesign.Role> roles = Arrays.asList(
            MenuDesign.Role.SINGLEPLAYER,
            MenuDesign.Role.OTHER,
            MenuDesign.Role.MULTIPLAYER,
            MenuDesign.Role.OPTIONS,
            MenuDesign.Role.QUIT
        );
        MenuDesign.Plan plan = MenuDesign.plan(roles, 480, 300);
        check(plan.slots.get(1) == null, "a button Kiza does not know gets no slot in the grid");
        check(plan.slots.get(3) != null && plan.slots.get(4) != null, "Minecraft's still do");
    }

    private static void aMenuItCannotReadIsLeftAlone() {
        List<MenuDesign.Role> roles = Arrays.asList(MenuDesign.Role.OTHER, MenuDesign.Role.OPTIONS);
        check(MenuDesign.plan(roles, 480, 300) == null, "no grid without play buttons");
        List<MenuDesign.Role> vanilla = Arrays.asList(MenuDesign.Role.SINGLEPLAYER, MenuDesign.Role.MULTIPLAYER);
        check(MenuDesign.plan(vanilla, 180, 300) == null, "no grid on a window too narrow for it");
    }

    private static void labelsAreTrimmedForTheGrid() {
        check(MenuDesign.displayLabel(MenuDesign.Role.REALMS, "Minecraft Realms").equals("Realms"), "realms");
        check(MenuDesign.displayLabel(MenuDesign.Role.OPTIONS, "Options...").equals("Options"), "dots");
        check(MenuDesign.displayLabel(MenuDesign.Role.QUIT, "Quit Game").equals("Quit Game"), "untouched");
    }

    private static void check(boolean condition, String what) {
        if (!condition) throw new AssertionError(what);
    }
}
