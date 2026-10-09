package fr.kiza.basemod.menu;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Properties;

/**
 * What the player chose in the Kiza Client settings, for this instance.
 *
 * <p>Kept in {@code kiza-client.properties} beside the runtime's own
 * {@code client.properties}, in the instance's runtime folder: a different
 * instance can have a different menu, and the launcher never rewrites the
 * file. A game started without the launcher keeps them in its own
 * {@code config} folder instead: they are kept either way.
 *
 * <p>Every change is written at once, before the next frame: the file is a
 * few hundred bytes, and a change made a moment before quitting must not be
 * lost to a thread the game took down with it. {@link #revision()} goes up
 * with each change, so whatever caches a picture of a setting can tell its
 * picture is stale.
 */
public final class ClientSettings {
    private ClientSettings() {}

    /** What is behind the title menu. */
    public enum Background {
        KIZA, IMAGE, GIF, VIDEO
    }

    /** The accent the menu is lit with, from the launcher's own palette. */
    public enum Accent {
        VIOLET(0xFF6D28D9, 0xFFA07CFB),
        BLUE(0xFF1D4ED8, 0xFF60A5FA),
        PINK(0xFFBE185D, 0xFFF472B6),
        GREEN(0xFF047857, 0xFF34D399),
        ORANGE(0xFFC2410C, 0xFFFB923C);

        public final int from;
        public final int to;

        Accent(int from, int to) {
            this.from = from;
            this.to = to;
        }

        /** The middle of the two, for the halo and anything one colour. */
        public int glow() {
            return MenuDesign.mix(from, to, 0.5F);
        }
    }

    private static final String FILE_NAME = "kiza-client.properties";

    private static boolean loaded;
    private static File file;
    private static final Properties VALUES = new Properties();
    private static int revision;

    public static synchronized int revision() {
        load();
        return revision;
    }

    /** The instance's runtime folder, where chosen backgrounds are kept too; null outside the launcher. */
    public static synchronized File folder() {
        load();
        return file == null ? null : file.getParentFile();
    }

    // ---- The settings ---------------------------------------------------------

    public static Background background() {
        String raw = get("menu.background", Background.KIZA.name());
        try {
            return Background.valueOf(raw);
        } catch (IllegalArgumentException unknown) {
            return Background.KIZA;
        }
    }

    /**
     * The file chosen for the current kind of background, inside the runtime
     * folder. One per kind, so going from a video back to an image finds the
     * image that was chosen before rather than asking again.
     */
    public static File backgroundFile() {
        return backgroundFile(background());
    }

    public static File backgroundFile(Background kind) {
        String name = get("menu.background.file." + kind.name().toLowerCase(java.util.Locale.ROOT), "");
        File folder = folder();
        if (name.isEmpty() || folder == null) return null;
        File chosen = new File(folder, name);
        return chosen.isFile() ? chosen : null;
    }

    public static void setBackground(Background kind, String fileName) {
        if (fileName != null) {
            set("menu.background.file." + kind.name().toLowerCase(java.util.Locale.ROOT), fileName);
        }
        set("menu.background", kind.name());
    }

    /** How dark the veil over the background is, 0 to 90 percent. */
    public static int dim() {
        return clamp(getInt("menu.dim", 15), 0, 90);
    }

    public static void setDim(int percent) {
        set("menu.dim", String.valueOf(clamp(percent, 0, 90)));
    }

    public static Accent accent() {
        try {
            return Accent.valueOf(get("menu.accent", Accent.VIOLET.name()));
        } catch (IllegalArgumentException unknown) {
            return Accent.VIOLET;
        }
    }

    public static void setAccent(Accent accent) {
        set("menu.accent", accent.name());
    }

    public static boolean animations() {
        return getBoolean("menu.animations", true);
    }

    public static boolean logoEffect() {
        return getBoolean("menu.logo-effect", true);
    }

    public static boolean icons() {
        return getBoolean("menu.icons", true);
    }

    /** Kiza's buttons on every Minecraft screen, or on the title and pause screens alone. */
    public static boolean everywhere() {
        return getBoolean("menu.everywhere", true);
    }

    public static boolean footer() {
        return getBoolean("menu.footer", true);
    }

    public static boolean debugLine() {
        return getBoolean("menu.debug-line", true);
    }

    public static void setFlag(String key, boolean value) {
        set(key, String.valueOf(value));
    }

    public static boolean flag(String key) {
        return getBoolean(key, true);
    }

    // ---- Storage --------------------------------------------------------------

    private static synchronized String get(String key, String fallback) {
        load();
        String value = VALUES.getProperty(key);
        return value == null ? fallback : value.trim();
    }

    private static int getInt(String key, int fallback) {
        try {
            return Integer.parseInt(get(key, String.valueOf(fallback)));
        } catch (NumberFormatException wrong) {
            return fallback;
        }
    }

    private static boolean getBoolean(String key, boolean fallback) {
        String raw = get(key, String.valueOf(fallback));
        return !"false".equalsIgnoreCase(raw);
    }

    private static synchronized void set(String key, String value) {
        load();
        if (value.equals(VALUES.getProperty(key))) return;
        VALUES.setProperty(key, value);
        revision += 1;
        if (file != null) write(file, VALUES);
    }

    private static void load() {
        if (loaded) return;
        loaded = true;
        java.util.Optional<java.nio.file.Path> config = fr.kiza.basemod.ClientRuntimeAccess.configPath();
        if (config.isPresent() && config.get().getParent() != null) {
            file = config.get().getParent().resolve(FILE_NAME).toFile();
        } else {
            // Started without the launcher: the game's own config folder,
            // which is where any mod keeps what it was told.
            file = new File(new File(System.getProperty("user.dir", "."), "config"), FILE_NAME);
        }
        if (!file.isFile()) return;
        InputStream input = null;
        try {
            input = new FileInputStream(file);
            VALUES.load(input);
        } catch (IOException unreadable) {
            System.err.println("[Kiza Client] The client settings could not be read; defaults are active.");
        } finally {
            if (input != null) {
                try {
                    input.close();
                } catch (IOException ignored) {
                    // Nothing more to do.
                }
            }
        }
    }

    private static synchronized void write(File target, Properties values) {
        File temporary = new File(target.getParentFile(), target.getName() + ".tmp");
        OutputStream output = null;
        try {
            target.getParentFile().mkdirs();
            output = new FileOutputStream(temporary);
            values.store(output, "Kiza Client settings for this instance, set from the game");
            output.close();
            output = null;
            if (target.exists() && !target.delete()) return;
            if (!temporary.renameTo(target)) temporary.delete();
        } catch (IOException failure) {
            System.err.println("[Kiza Client] The client settings could not be saved.");
        } finally {
            if (output != null) {
                try {
                    output.close();
                } catch (IOException ignored) {
                    // Nothing more to do.
                }
            }
        }
    }

    private static int clamp(int value, int low, int high) {
        return Math.max(low, Math.min(high, value));
    }
}
