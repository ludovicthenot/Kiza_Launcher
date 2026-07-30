package fr.kiza.basemod.mixin.fabric;

final class FabricMixinVersionSelector {
    private FabricMixinVersionSelector() {}

    static boolean shouldApply(String mixinClassName, String minecraftVersion) {
        Version version = Version.parse(minecraftVersion);
        if (mixinClassName.endsWith("FabricScreenLegacyMixin")) {
            return version.isBefore(1, 20, 0);
        }
        if (mixinClassName.endsWith("FabricScreenModernMixin")) {
            return !version.isBefore(1, 20, 0);
        }
        if (mixinClassName.endsWith("FabricTitleScreenLegacyMixin")) {
            return version.isBefore(1, 20, 0);
        }
        if (mixinClassName.endsWith("FabricTitleScreenModernMixin")) {
            return !version.isBefore(1, 20, 0);
        }
        if (mixinClassName.endsWith("FabricHudLegacyMixin")) {
            return version.isBefore(1, 20, 0);
        }
        if (mixinClassName.endsWith("FabricHudDrawContextMixin")) {
            return !version.isBefore(1, 20, 0) && version.isBefore(1, 20, 5);
        }
        if (mixinClassName.endsWith("FabricHudModernMixin")) {
            return !version.isBefore(1, 20, 5);
        }
        return true;
    }

    private record Version(int major, int minor, int patch) {
        static Version parse(String raw) {
            String[] parts = raw == null ? new String[0] : raw.split("[.-]");
            try {
                int major = parts.length > 0 ? Integer.parseInt(parts[0]) : 26;
                int minor = parts.length > 1 ? Integer.parseInt(parts[1]) : 0;
                int patch = parts.length > 2 ? Integer.parseInt(parts[2]) : 0;
                return new Version(major, minor, patch);
            } catch (NumberFormatException ignored) {
                return new Version(26, 0, 0);
            }
        }

        boolean isBefore(int otherMajor, int otherMinor, int otherPatch) {
            if (major != otherMajor) return major < otherMajor;
            if (minor != otherMinor) return minor < otherMinor;
            return patch < otherPatch;
        }
    }
}
