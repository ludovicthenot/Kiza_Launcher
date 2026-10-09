package fr.kiza.basemod;

/**
 * The Kiza menu on Forge: which events Forge draws its screens with.
 *
 * <p>The menu itself -- its design, its buttons, its animations -- is the
 * same on every loader and lives in {@code fr.kiza.basemod.menu}. What is
 * Forge's is how to be told a screen was drawn, and Forge has renamed that
 * twice: {@code GuiScreenEvent} through 1.17, then
 * {@code ScreenEvent.DrawScreenEvent}, then {@code ScreenEvent.Render} from
 * 1.19.3. Every name is listed, newest first.
 */
final class ForgeMenu {
    private ForgeMenu() {}

    static final LoaderEvents.Names NAMES = new LoaderEvents.Names(
        "Forge",
        "net.minecraftforge.common.MinecraftForge",
        "EVENT_BUS",
        new String[] {
            "net.minecraftforge.client.event.ScreenEvent$Render$Post",
            "net.minecraftforge.client.event.ScreenEvent$DrawScreenEvent$Post",
            "net.minecraftforge.client.event.GuiScreenEvent$DrawScreenEvent$Post",
        },
        new String[] {
            "net.minecraftforge.client.event.ScreenEvent$BackgroundRendered",
            "net.minecraftforge.client.event.ScreenEvent$BackgroundDrawn",
            "net.minecraftforge.client.event.GuiScreenEvent$BackgroundDrawnEvent",
        },
        new String[] {
            "net.minecraftforge.client.event.RenderGuiEvent$Post",
            "net.minecraftforge.client.event.RenderGuiOverlayEvent$Post",
            "net.minecraftforge.client.event.RenderGameOverlayEvent$Post",
        },
        new String[] {
            "net.minecraftforge.client.event.CustomizeGuiOverlayEvent$DebugText",
            "net.minecraftforge.client.event.RenderGameOverlayEvent$Text",
        }
    );

    static void install() {
        LoaderEvents.install(NAMES);
    }
}
