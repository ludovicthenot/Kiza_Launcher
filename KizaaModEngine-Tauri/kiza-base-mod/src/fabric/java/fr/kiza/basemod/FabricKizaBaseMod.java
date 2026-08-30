package fr.kiza.basemod;

import fr.kiza.basemod.mixin.fabric.FabricMixinVersionSelector;
import net.fabricmc.api.ClientModInitializer;

public final class FabricKizaBaseMod implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        // Borderless mode stays off: the game keeps the native Windows title bar
        // and its own buttons, so the client draws no window controls.
        KizaClientManager.initialize(
            "Fabric",
            new FabricMinecraftStateDetector(),
            FabricKizaBaseMod::requireScreenHooks
        );
    }

    /**
     * Fabric installs no listener of its own: the interface is entirely mixins,
     * and they are optional by design so an unknown version cannot crash the
     * game. That silence used to reach the launcher as a working menu.
     */
    private static void requireScreenHooks() {
        String version = System.getProperty("kiza.minecraft.version", "");
        if (!FabricMixinVersionSelector.hasScreenHooks(version)) {
            throw new IllegalStateException(
                "No Kiza screen hook covers Minecraft " + version + "."
            );
        }
    }
}
