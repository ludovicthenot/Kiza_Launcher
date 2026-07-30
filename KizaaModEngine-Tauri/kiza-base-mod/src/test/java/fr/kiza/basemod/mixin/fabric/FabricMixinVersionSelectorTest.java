package fr.kiza.basemod.mixin.fabric;

public final class FabricMixinVersionSelectorTest {
    private FabricMixinVersionSelectorTest() {}

    public static void main(String[] args) {
        assert applies("FabricScreenLegacyMixin", "1.17.1");
        assert applies("FabricHudLegacyMixin", "1.19.4");
        assert applies("FabricScreenModernMixin", "1.20");
        assert applies("FabricHudDrawContextMixin", "1.20.4");
        assert applies("FabricHudModernMixin", "1.20.5");
        assert applies("FabricHudModernMixin", "1.21.11");
        assert applies("FabricScreenModernMixin", "26.1");

        assert !applies("FabricScreenLegacyMixin", "1.21.11");
        assert !applies("FabricHudDrawContextMixin", "1.21.11");
        assert !applies("FabricHudModernMixin", "1.20.4");
    }

    private static boolean applies(String simpleName, String version) {
        return FabricMixinVersionSelector.shouldApply(
            "fr.kiza.basemod.mixin.fabric." + simpleName,
            version
        );
    }
}
