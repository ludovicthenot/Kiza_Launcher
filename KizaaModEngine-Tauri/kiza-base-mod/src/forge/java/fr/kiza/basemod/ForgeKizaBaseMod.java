package fr.kiza.basemod;

import net.minecraftforge.fml.common.Mod;

@Mod("kiza_base_mod")
public final class ForgeKizaBaseMod {
    public ForgeKizaBaseMod() {
        // Borderless mode stays off: the game keeps the native Windows title bar
        // and its own buttons, so the client draws no window controls.
        KizaClientManager.initialize(
            "Forge",
            new ForgeMinecraftStateDetector(),
            ForgeMenuLogoHook::install
        );
    }
}
