package fr.kiza.basemod;

import net.fabricmc.api.ClientModInitializer;

public final class FabricKizaBaseMod implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        StateReporter.start(new FabricMinecraftStateDetector());
    }
}

