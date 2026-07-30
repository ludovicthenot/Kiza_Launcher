package fr.kiza.basemod;

import net.fabricmc.api.ClientModInitializer;

public final class FabricKizaBaseMod implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        // Borderless mode stays off: the game keeps the native Windows title bar
        // and its own buttons, so the client draws no window controls.
        KizaClientManager.initialize(
            "Fabric",
            new FabricMinecraftStateDetector(),
            () -> {}
        );
    }
}
