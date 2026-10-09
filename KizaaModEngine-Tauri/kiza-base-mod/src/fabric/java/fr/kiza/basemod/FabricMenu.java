package fr.kiza.basemod;

/**
 * The Kiza menu on Fabric: where Fabric's mixins hand a frame over.
 *
 * <p>Fabric has no render events to listen to, so the mixins in
 * {@code mixin.fabric} inject into Minecraft's own screen and HUD methods --
 * one set per generation of the drawing API -- and every one of them lands
 * here. The menu they draw is the common one in {@code fr.kiza.basemod.menu};
 * this class is only the door Fabric comes in by.
 *
 * <p>What Fabric brings of its own is Mod Menu, which adds a Mods button to
 * the title screen. Its label is translated through {@code modmenu.title},
 * which the common design already recognises, so it takes the Mods place in
 * the grid like Forge's own button does.
 */
public final class FabricMenu {
    private FabricMenu() {}

    /** Any screen, before Minecraft draws it: the Kiza backdrop. */
    public static void renderBackground(Object graphics, Object screen) {
        MenuLogoRenderer.renderBackground(graphics, screen);
    }

    /** Any screen, once Minecraft has drawn its background: the player's, outside a world. */
    public static void afterBackground(Object graphics, Object screen) {
        MenuLogoRenderer.afterBackground(graphics, screen);
    }

    /** Any screen, after Minecraft draws it: Kiza's buttons over Minecraft's. */
    public static void renderScreen(Object graphics, Object screen, int mouseX, int mouseY) {
        MenuLogoRenderer.render(graphics, screen, mouseX, mouseY);
    }

    /** The title screen, after Minecraft draws it: the Kiza title menu. */
    public static void renderTitle(Object graphics, Object screen, int mouseX, int mouseY) {
        MenuLogoRenderer.renderTitleForeground(graphics, screen, mouseX, mouseY);
    }

    /** In game, over the HUD: the Kiza title bar. */
    public static void renderHud(Object graphics) {
        MenuLogoRenderer.renderHud(graphics);
    }
}
