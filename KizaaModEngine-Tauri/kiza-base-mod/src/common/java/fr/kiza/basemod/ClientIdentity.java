package fr.kiza.basemod;

import java.util.Locale;
import java.util.regex.Pattern;

record ClientIdentity(String clientVersion, String minecraftVersion, String loader) {
    private static final Pattern SAFE_VALUE = Pattern.compile("[A-Za-z0-9._+ -]{1,48}");

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
