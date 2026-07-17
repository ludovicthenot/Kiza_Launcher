package fr.kiza.basemod;

import net.minecraftforge.fml.common.Mod;

@Mod("kiza_base_mod")
public final class ForgeKizaBaseMod {
    public ForgeKizaBaseMod() {
        StateReporter.start(new ForgeMinecraftStateDetector());
    }
}

