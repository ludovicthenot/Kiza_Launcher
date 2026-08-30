package fr.kiza.basemod.mixin.fabric;

public final class FabricMixinVersionSelector {
    /** Every screen hook this jar carries, in the order the config lists them. */
    private static final String[] SCREEN_MIXINS = {
        "FabricScreenJava8Mixin",
        "FabricScreenLegacyMixin",
        "FabricScreenModernMixin",
        "FabricTitleScreenJava8Mixin",
        "FabricTitleScreenLegacyMixin",
        "FabricTitleScreenModernMixin"
    };

    private FabricMixinVersionSelector() {}

    /**
     * Whether any screen hook applies to this Minecraft version.
     *
     * <p>Every Fabric mixin here is declared {@code require = 0} and the config
     * is {@code "required": false}, so a hook that does not match its target
     * simply never runs and says nothing. On Fabric the platform installer does
     * no work at all — the whole menu comes from these mixins — so without this
     * question the runtime reported {@code menu-theme} as an active capability
     * on versions where nothing had been hooked and the vanilla menu was on
     * screen.
     */
    public static boolean hasScreenHooks(String minecraftVersion) {
        for (String mixin : SCREEN_MIXINS) {
            if (shouldApply(mixin, minecraftVersion)) return true;
        }
        return false;
    }

    public static boolean shouldApply(String mixinClassName, String minecraftVersion) {
        Version version = Version.parse(minecraftVersion);
        if (mixinClassName.endsWith("FabricScreenJava8Mixin")) {
            return version.isBefore(1, 16, 0);
        }
        if (mixinClassName.endsWith("FabricScreenLegacyMixin")) {
            return !version.isBefore(1, 16, 0) && version.isBefore(1, 20, 0);
        }
        if (mixinClassName.endsWith("FabricScreenModernMixin")) {
            return !version.isBefore(1, 20, 0);
        }
        if (mixinClassName.endsWith("FabricTitleScreenJava8Mixin")) {
            return version.isBefore(1, 16, 0);
        }
        if (mixinClassName.endsWith("FabricTitleScreenLegacyMixin")) {
            return !version.isBefore(1, 16, 0) && version.isBefore(1, 20, 0);
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

    private static final class Version {
        private final int major;
        private final int minor;
        private final int patch;

        private Version(int major, int minor, int patch) {
            this.major = major;
            this.minor = minor;
            this.patch = patch;
        }

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
