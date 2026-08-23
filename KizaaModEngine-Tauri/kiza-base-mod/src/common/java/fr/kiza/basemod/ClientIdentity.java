package fr.kiza.basemod;

import java.util.Locale;
import java.util.regex.Pattern;

final class ClientIdentity {
    private static final Pattern SAFE_VALUE = Pattern.compile("[A-Za-z0-9._+ -]{1,48}");

    private final String clientVersion;
    private final String minecraftVersion;
    private final String loader;

    ClientIdentity(String clientVersion, String minecraftVersion, String loader) {
        this.clientVersion = clientVersion;
        this.minecraftVersion = minecraftVersion;
        this.loader = loader;
    }

    String clientVersion() {
        return clientVersion;
    }

    String minecraftVersion() {
        return minecraftVersion;
    }

    String loader() {
        return loader;
    }

    static ClientIdentity fromSystemProperties() {
        return new ClientIdentity(
            safeValue(System.getProperty("kiza.client.version"), "dev"),
            safeValue(System.getProperty("kiza.minecraft.version"), "Minecraft"),
            safeValue(System.getProperty("kiza.minecraft.loader"), "client")
                .toLowerCase(Locale.ROOT)
        );
    }

    String windowTitle() {
        return "Kiza Client " + minecraftVersion + " (v" + clientVersion + ")";
    }

    String footerLabel() {
        return windowTitle();
    }

    private static String safeValue(String value, String fallback) {
        if (value == null) return fallback;
        String trimmed = value.trim();
        return SAFE_VALUE.matcher(trimmed).matches() ? trimmed : fallback;
    }
}
