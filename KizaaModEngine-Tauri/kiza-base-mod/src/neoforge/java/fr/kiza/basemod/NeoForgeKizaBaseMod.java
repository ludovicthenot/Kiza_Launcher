package fr.kiza.basemod;

import net.neoforged.fml.common.Mod;

/**
 * Kiza Client Runtime on NeoForge.
 *
 * <p>NeoForge builds this with no arguments when the game starts on a client.
 * The player-state detector is Forge's: it reads Minecraft's own classes by
 * reflection and never touches the loader, so it serves both.
 */
@Mod("kiza_base_mod")
public final class NeoForgeKizaBaseMod {
    public NeoForgeKizaBaseMod() {
        KizaClientManager.initialize(
            "NeoForge",
            new ForgeMinecraftStateDetector(),
            NeoForgeMenu::install
        );
    }
}
