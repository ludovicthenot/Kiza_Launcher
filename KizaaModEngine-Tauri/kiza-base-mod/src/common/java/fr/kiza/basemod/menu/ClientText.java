package fr.kiza.basemod.menu;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;

/**
 * The Kiza Client's own words, in the game's language.
 *
 * <p>Minecraft's buttons already speak the language the player picked; the
 * client's settings follow the same choice, read from the game's options
 * each half second, so changing the language in Minecraft changes them too
 * -- no restart. French for French, English for everything else.
 *
 * <p>The language is the options' {@code languageCode} -- found under each
 * generation's name for the options, and failing a name, as the one string
 * of theirs shaped like {@code fr_fr}.
 */
public final class ClientText {
    private ClientText() {}

    /** Something to say, in both languages, said in the current one when shown. */
    public static final class Phrase {
        final String french;
        final String english;

        Phrase(String french, String english) {
            this.french = french;
            this.english = english;
        }

        @Override
        public String toString() {
            return t(french, english);
        }
    }

    private static final String[] OPTIONS_TYPES = {
        "net.minecraft.client.Options",
        "net.minecraft.class_315",
        "net.minecraft.client.option.GameOptions",
        "net.minecraft.client.options.GameOptions",
        "net.minecraft.client.settings.GameSettings",
    };
    private static final java.util.regex.Pattern CODE = java.util.regex.Pattern.compile("(?i)[a-z]{2,3}_[a-z0-9]{2,4}");

    private static Field optionsField;
    private static Field languageField;
    private static boolean unreadable;
    private static long readAt;
    private static boolean french = true;

    public static String t(String french, String english) {
        return french() ? french : english;
    }

    public static Phrase of(String french, String english) {
        return new Phrase(french, english);
    }

    /** Whether the game is in French; read again at most twice a second. */
    public static synchronized boolean french() {
        long now = System.nanoTime();
        if (unreadable || now - readAt < 500_000_000L) return french;
        readAt = now;
        String code = languageCode();
        if (code != null) french = code.toLowerCase(java.util.Locale.ROOT).startsWith("fr");
        return french;
    }

    /** The game's language code, or null when this version cannot be read. */
    private static String languageCode() {
        try {
            Object minecraft = fr.kiza.basemod.WindowTitleManager.minecraftInstance();
            if (minecraft == null) return null;
            if (optionsField == null) optionsField = optionsField(minecraft.getClass());
            if (optionsField == null) {
                unreadable = true;
                return null;
            }
            Object options = optionsField.get(minecraft);
            if (options == null) return null;
            if (languageField == null) languageField = languageField(options);
            if (languageField == null) {
                unreadable = true;
                return null;
            }
            Object value = languageField.get(options);
            return value instanceof String ? (String) value : null;
        } catch (Throwable failure) {
            unreadable = true;
            return null;
        }
    }

    private static Field optionsField(Class<?> type) {
        java.util.Set<String> names = new java.util.HashSet<String>(java.util.Arrays.asList(OPTIONS_TYPES));
        for (Class<?> cursor = type; cursor != null; cursor = cursor.getSuperclass()) {
            for (Field field : cursor.getDeclaredFields()) {
                if (Modifier.isStatic(field.getModifiers()) || !names.contains(field.getType().getName())) continue;
                field.setAccessible(true);
                return field;
            }
        }
        return null;
    }

    private static Field languageField(Object options) throws IllegalAccessException {
        Field shaped = null;
        for (Class<?> cursor = options.getClass(); cursor != null; cursor = cursor.getSuperclass()) {
            for (Field field : cursor.getDeclaredFields()) {
                if (field.getType() != String.class || Modifier.isStatic(field.getModifiers())) continue;
                field.setAccessible(true);
                if (field.getName().equals("languageCode") || field.getName().equals("language")) return field;
                Object value = field.get(options);
                if (shaped == null && value instanceof String && CODE.matcher((String) value).matches()) shaped = field;
            }
        }
        return shaped;
    }
}
