package fr.kiza.basemod;

/**
 * The Kiza menu on NeoForge: which events NeoForge draws its screens with.
 *
 * <p>NeoForge began as Forge and kept its events, under its own package from
 * 1.20.2: {@code net.neoforged.neoforge} where Forge says
 * {@code net.minecraftforge}, and {@code NeoForge.EVENT_BUS} where Forge has
 * {@code MinecraftForge.EVENT_BUS}. The menu is the same one Fabric and Forge
 * draw; only these names are NeoForge's.
 */
final class NeoForgeMenu {
    private NeoForgeMenu() {}

    static final LoaderEvents.Names NAMES = new LoaderEvents.Names(
        "NeoForge",
        "net.neoforged.neoforge.common.NeoForge",
        "EVENT_BUS",
        new String[] {"net.neoforged.neoforge.client.event.ScreenEvent$Render$Post"},
        new String[] {"net.neoforged.neoforge.client.event.ScreenEvent$BackgroundRendered"},
        new String[] {"net.neoforged.neoforge.client.event.RenderGuiEvent$Post"},
        new String[] {"net.neoforged.neoforge.client.event.CustomizeGuiOverlayEvent$DebugText"}
    );

    static void install() {
        LoaderEvents.install(NAMES);
    }
}
