package fr.kiza.basemod;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * The jobs the launcher found another mod doing, so this client leaves them
 * to it.
 *
 * <p>Kiza draws the title screen, replaces the window's caption and reports
 * the player's state for Discord. So do CustomMainMenu, Borderless Mining
 * and CraftPresence, and a pack that ships one of them chose it. The
 * launcher reads the mods folder before a launch and passes what it found
 * as {@code -Dkiza.yield=menu:custommainmenu,window:borderlessmining};
 * every piece of this client that paints or owns something asks here first.
 *
 * <p>Read once, from a system property the launcher set: the client has no
 * loader-independent way to ask which mods are loaded, and the launcher's
 * answer is the same one it acted on for its own part of the job.
 */
public final class Courtesies {
    public static final String MENU = "menu";
    public static final String WINDOW = "window";
    public static final String PRESENCE = "presence";

    private static volatile Map<String, String> yielded = parse(System.getProperty("kiza.yield"));

    private Courtesies() {}

    /** Whether the menu is left to a mod. */
    public static boolean menu() {
        return yielded.containsKey(MENU);
    }

    /** Whether the window's caption and borders are left to a mod. */
    public static boolean window() {
        return yielded.containsKey(WINDOW);
    }

    /** The id of the mod a job was left to, or {@code null}. */
    public static String owner(String area) {
        return yielded.get(area);
    }

    static Map<String, String> all() {
        return yielded;
    }

    /** Re-reads the property; for the launcher's tests, which set it late. */
    static void reload() {
        yielded = parse(System.getProperty("kiza.yield"));
    }

    static Map<String, String> parse(String raw) {
        Map<String, String> parsed = new LinkedHashMap<String, String>();
        if (raw == null) return Collections.unmodifiableMap(parsed);
        for (String pair : raw.split(",")) {
            int colon = pair.indexOf(':');
            if (colon <= 0 || colon == pair.length() - 1) continue;
            String area = pair.substring(0, colon).trim().toLowerCase(Locale.ROOT);
            String owner = pair.substring(colon + 1).trim();
            if (area.isEmpty() || owner.isEmpty() || owner.length() > 128) continue;
            if (!parsed.containsKey(area)) parsed.put(area, owner);
        }
        return Collections.unmodifiableMap(parsed);
    }
}
