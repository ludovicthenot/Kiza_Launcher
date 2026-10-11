package fr.kiza.basemod.menu;

import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.HashMap;
import java.util.Map;

/**
 * The Kiza Client's own words, in the game's language.
 *
 * <p>Every text is a translation key, looked up the way Minecraft looks up
 * its own:
 * <ol>
 *   <li>Through Minecraft's {@code I18n}, which knows the language the
 *       player picked and every resource pack on top of it: a pack that
 *       translates {@code kiza.*} keys changes the client's menu too.</li>
 *   <li>In the language files the mod ships,
 *       {@code assets/kiza_base_mod/lang/<code>.json}, read straight from
 *       the jar: Fabric without its API does not load a mod's languages into
 *       the game, and before 1.13 the game reads another format.</li>
 *   <li>In English.</li>
 * </ol>
 * The language is read from the game's options twice a second, so changing
 * it in Minecraft changes the client's menu at once.
 */
public final class ClientText {
    private ClientText() {}

    /** Something to say, said in the current language each time it is shown. */
    public static final class Phrase {
        final String key;
        final Object[] arguments;

        Phrase(String key, Object[] arguments) {
            this.key = key;
            this.arguments = arguments;
        }

        @Override
        public String toString() {
            return get(key, arguments);
        }
    }

    /** The languages the mod ships, and what a language without its own file falls back to. */
    private static final String[] SHIPPED = {
        "en_us", "fr_fr", "es_es", "de_de", "it_it", "pt_br", "nl_nl", "pl_pl", "ru_ru",
        "uk_ua", "sr_sp", "sr_cs", "tr_tr", "cs_cz", "ja_jp", "ko_kr", "zh_cn",
    };
    private static final String FALLBACK = "en_us";

    private static final String[] OPTIONS_TYPES = {
        "net.minecraft.client.Options",
        "net.minecraft.class_315",
        "net.minecraft.client.option.GameOptions",
        "net.minecraft.client.options.GameOptions",
        "net.minecraft.client.settings.GameSettings",
    };
    private static final String[] I18N_TYPES = {
        "net.minecraft.client.resources.language.I18n",
        "net.minecraft.class_1074",
        "net.minecraft.client.resources.I18n",
    };
    private static final java.util.regex.Pattern CODE = java.util.regex.Pattern.compile("(?i)[a-z]{2,3}_[a-z0-9]{2,4}");

    private static Field optionsField;
    private static Field languageField;
    private static boolean optionsUnreadable;
    private static long readAt;
    private static String code = FALLBACK;

    private static boolean i18nResolved;
    private static Method translate;
    private static Method exists;

    private static final Map<String, Map<String, String>> SHIPPED_TEXTS = new HashMap<String, Map<String, String>>();

    /** {@code key} in the game's language, with {@code arguments} put in its {@code %s}. */
    public static String get(String key, Object... arguments) {
        String fromGame = fromGame(key, arguments);
        if (fromGame != null) return fromGame;
        String pattern = shipped(language()).get(key);
        if (pattern == null) pattern = shipped(FALLBACK).get(key);
        if (pattern == null) return key;
        try {
            return arguments.length == 0 ? pattern.replace("%%", "%") : String.format(pattern, arguments);
        } catch (java.util.IllegalFormatException wrong) {
            return pattern;
        }
    }

    public static Phrase of(String key, Object... arguments) {
        return new Phrase(key, arguments);
    }

    // ---- The game's translations ------------------------------------------------

    /** What Minecraft's I18n says, or null when it does not know the key. */
    private static String fromGame(String key, Object[] arguments) {
        try {
            resolveI18n();
            if (translate == null) return null;
            if (exists != null) {
                if (!Boolean.TRUE.equals(exists.invoke(null, key))) return null;
                return (String) translate.invoke(null, key, arguments);
            }
            String said = (String) translate.invoke(null, key, arguments);
            return said == null || said.equals(key) ? null : said;
        } catch (Throwable unavailable) {
            translate = null;
            return null;
        }
    }

    /** I18n by its shape: static get(String, Object...) and exists(String), under each generation's name. */
    private static synchronized void resolveI18n() {
        if (i18nResolved) return;
        i18nResolved = true;
        Class<?> type = fr.kiza.basemod.McNames.firstClass(I18N_TYPES);
        if (type == null) return;
        for (Method method : type.getDeclaredMethods()) {
            if (!Modifier.isStatic(method.getModifiers())) continue;
            Class<?>[] parameters = method.getParameterTypes();
            if (method.getReturnType() == String.class && parameters.length == 2
                && parameters[0] == String.class && parameters[1] == Object[].class) {
                method.setAccessible(true);
                translate = method;
            } else if (method.getReturnType() == boolean.class && parameters.length == 1 && parameters[0] == String.class) {
                method.setAccessible(true);
                exists = method;
            }
        }
    }

    // ---- The mod's own files ------------------------------------------------------

    /** The shipped file for {@code language}, or for the nearest shipped language. */
    private static synchronized Map<String, String> shipped(String language) {
        String file = FALLBACK;
        for (String candidate : SHIPPED) {
            if (candidate.equals(language)) {
                file = candidate;
                break;
            }
        }
        if (file.equals(FALLBACK) && !language.equals(FALLBACK)) {
            // Same language, another country: Canadian French reads French.
            String prefix = language.substring(0, Math.max(0, language.indexOf('_')));
            for (String candidate : SHIPPED) {
                if (!prefix.isEmpty() && candidate.startsWith(prefix + "_")) {
                    file = candidate;
                    break;
                }
            }
        }
        Map<String, String> texts = SHIPPED_TEXTS.get(file);
        if (texts == null) {
            texts = read("/assets/kiza_base_mod/lang/" + file + ".json");
            SHIPPED_TEXTS.put(file, texts);
        }
        return texts;
    }

    private static Map<String, String> read(String path) {
        InputStream input = ClientText.class.getResourceAsStream(path);
        if (input == null) return new HashMap<String, String>();
        try {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            for (int read = input.read(buffer); read > 0; read = input.read(buffer)) bytes.write(buffer, 0, read);
            return parse(new String(bytes.toByteArray(), "UTF-8"));
        } catch (java.io.IOException unreadable) {
            return new HashMap<String, String>();
        } finally {
            try {
                input.close();
            } catch (java.io.IOException ignored) {
                // Nothing more to do.
            }
        }
    }

    /** A flat JSON object of strings, which is all a language file is. */
    static Map<String, String> parse(String json) {
        Map<String, String> values = new HashMap<String, String>();
        int at = 0;
        String key = null;
        while (at < json.length()) {
            char c = json.charAt(at);
            if (c != '"') {
                at += 1;
                continue;
            }
            StringBuilder text = new StringBuilder();
            at += 1;
            while (at < json.length() && json.charAt(at) != '"') {
                char next = json.charAt(at);
                if (next == '\\' && at + 1 < json.length()) {
                    char escaped = json.charAt(at + 1);
                    if (escaped == 'u' && at + 5 < json.length()) {
                        text.append((char) Integer.parseInt(json.substring(at + 2, at + 6), 16));
                        at += 6;
                        continue;
                    }
                    text.append(escaped == 'n' ? '\n' : escaped == 't' ? '\t' : escaped);
                    at += 2;
                    continue;
                }
                text.append(next);
                at += 1;
            }
            at += 1;
            if (key == null) {
                key = text.toString();
            } else {
                values.put(key, text.toString());
                key = null;
            }
        }
        return values;
    }

    // ---- The game's language ------------------------------------------------------

    /** Tests only: a language, as if the game were set to it. */
    static synchronized void previewLanguage(String language) {
        code = language;
        optionsUnreadable = true;
        i18nResolved = true;
    }

    /** The game's language code, lower case; read again at most twice a second. */
    static synchronized String language() {
        long now = System.nanoTime();
        if (optionsUnreadable || now - readAt < 500_000_000L) return code;
        readAt = now;
        String read = languageCode();
        if (read != null && !read.isEmpty()) code = read.toLowerCase(java.util.Locale.ROOT);
        return code;
    }

    private static String languageCode() {
        try {
            Object minecraft = fr.kiza.basemod.WindowTitleManager.minecraftInstance();
            if (minecraft == null) return null;
            if (optionsField == null) optionsField = optionsField(minecraft.getClass());
            if (optionsField == null) {
                optionsUnreadable = true;
                return null;
            }
            Object options = optionsField.get(minecraft);
            if (options == null) return null;
            if (languageField == null) languageField = languageField(options);
            if (languageField == null) {
                optionsUnreadable = true;
                return null;
            }
            Object value = languageField.get(options);
            return value instanceof String ? (String) value : null;
        } catch (Throwable failure) {
            optionsUnreadable = true;
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
