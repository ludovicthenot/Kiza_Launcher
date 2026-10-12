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
        ORANGE(0xFFC2410C, 0xFFFB923C),
        /** The player's own, from the palette: its two ends follow the colour picked. */
        CUSTOM(0xFF6D28D9, 0xFFA07CFB);

        // Not final for CUSTOM's sake: they follow the colour picked.
        public int from;
        public int to;

        Accent(int from, int to) {
            this.from = from;
            this.to = to;
        }

        /** The middle of the two, for the halo and anything one colour. */
        public int glow() {
            return MenuDesign.mix(from, to, 0.5F);
        }
    }

    /** The tallest frame a menu video is prepared at; automatic follows the window. */
    public enum VideoQuality {
        AUTO, P720, P1080, P1440
    }

    /** The most frames a second a menu video is prepared at; automatic follows the machine. */
    public enum VideoFps {
        AUTO, F30, F60
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
        String name = backgroundName(kind);
        if (name.isEmpty()) return null;
        // The library first, where every background now lives; the runtime
        // folder for one chosen before it, until the library moves it in.
        File library = MenuLibrary.folder();
        if (library != null) {
            File chosen = new File(library, name);
            if (chosen.isFile()) return chosen;
        }
        File folder = folder();
        if (folder == null) return null;
        File chosen = new File(folder, name);
        return chosen.isFile() ? chosen : null;
    }

    /** The file name remembered for a kind of background, or "". */
    static String backgroundName(Background kind) {
        return get("menu.background.file." + kind.name().toLowerCase(java.util.Locale.ROOT), "");
    }

    /** Remembers a file for a kind without showing it: the library moving a file in. */
    static void rememberBackground(Background kind, String fileName) {
        set("menu.background.file." + kind.name().toLowerCase(java.util.Locale.ROOT), fileName);
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
        Accent accent;
        try {
            accent = Accent.valueOf(get("menu.accent", Accent.VIOLET.name()));
        } catch (IllegalArgumentException unknown) {
            return Accent.VIOLET;
        }
        if (accent == Accent.CUSTOM) {
            // The two ends of the gradient, from the one colour picked: a
            // deeper one to start, a lighter one to end, as the others go.
            float[] hsb = customHsb();
            Accent.CUSTOM.from = 0xFF000000 | java.awt.Color.HSBtoRGB(hsb[0], Math.min(1F, hsb[1] * 1.05F + 0.05F), hsb[2] * 0.62F);
            Accent.CUSTOM.to = 0xFF000000 | java.awt.Color.HSBtoRGB(hsb[0], hsb[1] * 0.62F, Math.min(1F, hsb[2] * 0.85F + 0.25F));
        }
        return accent;
    }

    /**
     * The colour picked in the palette, as hue, saturation and brightness,
     * each 0 to 1. Kept as such rather than as RGB, so a grey keeps the hue
     * it was picked from and the palette does not jump.
     */
    public static float[] customHsb() {
        String[] parts = get("menu.accent.custom", "0.72,0.63,0.96").split(",");
        float[] hsb = {0.72F, 0.63F, 0.96F};
        for (int index = 0; index < 3 && index < parts.length; index += 1) {
            try {
                hsb[index] = Math.max(0F, Math.min(1F, Float.parseFloat(parts[index].trim())));
            } catch (NumberFormatException wrong) {
                // The default for that part.
            }
        }
        return hsb;
    }

    /** The picked colour, RGB. */
    public static int customColour() {
        float[] hsb = customHsb();
        return java.awt.Color.HSBtoRGB(hsb[0], hsb[1], hsb[2]) & 0xFFFFFF;
    }

    /**
     * Picks a colour and makes it the accent. Rounded to a hundredth -- a
     * degree for the hue -- so dragging across the palette writes the file
     * only when the colour really changes.
     */
    public static void setCustomColour(float hue, float saturation, float brightness) {
        String value = String.format(java.util.Locale.ROOT, "%.3f,%.2f,%.2f",
            Math.round(clampUnit(hue) * 360F) / 360F, clampUnit(saturation), clampUnit(brightness));
        set("menu.accent.custom", value);
        set("menu.accent", Accent.CUSTOM.name());
    }

    private static float clampUnit(float value) {
        return Math.max(0F, Math.min(1F, value));
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

    /** The menu background behind every screen opened outside a world, not the title alone. */
    public static boolean menusBackground() {
        return getBoolean("menu.background-everywhere", true);
    }

    public static boolean footer() {
        return getBoolean("menu.footer", true);
    }

    public static boolean debugLine() {
        return getBoolean("menu.debug-line", true);
    }

    public static VideoQuality videoQuality() {
        try {
            return VideoQuality.valueOf(get("menu.video.quality", VideoQuality.AUTO.name()));
        } catch (IllegalArgumentException unknown) {
            return VideoQuality.AUTO;
        }
    }

    public static void setVideoQuality(VideoQuality quality) {
        set("menu.video.quality", quality.name());
        set("menu.video.auto-step", "0");
    }

    public static VideoFps videoFps() {
        try {
            return VideoFps.valueOf(get("menu.video.fps", VideoFps.AUTO.name()));
        } catch (IllegalArgumentException unknown) {
            return VideoFps.AUTO;
        }
    }

    public static void setVideoFps(VideoFps fps) {
        set("menu.video.fps", fps.name());
        set("menu.video.auto-step", "0");
    }

    /**
     * How many steps below what it would choose the automatic quality has
     * gone, after a video it chose could not keep up on this machine. Back
     * to none when the player chooses a quality or a rate again.
     */
    public static int videoAutoStep() {
        return Math.max(0, Math.min(3, getInt("menu.video.auto-step", 0)));
    }

    public static void setVideoAutoStep(int steps) {
        set("menu.video.auto-step", String.valueOf(Math.max(0, Math.min(3, steps))));
    }

    /** 720p at 30 frames a second on one thread, whatever the rest says. Off unless chosen. */
    public static boolean videoPerformance() {
        return getBoolean("menu.video.performance", false);
    }

    /** The measured line over the menu: frames shown, skipped, decoding and upload times. Off unless chosen. */
    public static boolean videoStats() {
        return getBoolean("menu.video.stats", false);
    }

    public static void setFlag(String key, boolean value) {
        set(key, String.valueOf(value));
    }

    public static boolean flag(String key) {
        return getBoolean(key, true);
    }

    /** A switch that is off until the player turns it on. */
    public static boolean flag(String key, boolean fallback) {
        return getBoolean(key, fallback);
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
        if (file != null) saveSoon();
    }

    /** A change not yet on disk. */
    private static boolean unsaved;
    private static Thread saver;
    private static final Object WRITING = new Object();

    /**
     * Saved on a thread of its own, a moment after the last change: dragging
     * across the palette changed the colour every frame, and writing the file
     * each time cost the game 1.2 ms a frame, measured. Saved too when the
     * game closes, so a change made just before is kept. Called holding the
     * class's lock.
     */
    private static void saveSoon() {
        unsaved = true;
        if (saver == null) {
            saver = new Thread(new Runnable() {
                @Override
                public void run() {
                    saveWhileChanged();
                }
            }, "kiza-settings-saver");
            saver.setDaemon(true);
            saver.start();
            Runtime.getRuntime().addShutdownHook(new Thread(new Runnable() {
                @Override
                public void run() {
                    save();
                }
            }, "kiza-settings-save"));
        }
        ClientSettings.class.notifyAll();
    }

    private static void saveWhileChanged() {
        try {
            while (true) {
                synchronized (ClientSettings.class) {
                    while (!unsaved) ClientSettings.class.wait();
                }
                // The changes of a drag, written once.
                Thread.sleep(150L);
                save();
            }
        } catch (InterruptedException stop) {
            save();
        }
    }

    private static void save() {
        Properties snapshot;
        File target;
        synchronized (ClientSettings.class) {
            if (!unsaved) return;
            unsaved = false;
            snapshot = (Properties) VALUES.clone();
            target = file;
        }
        write(target, snapshot);
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

    /** Off the class's lock, so a setting is read while the file is written. */
    private static void write(File target, Properties values) {
        synchronized (WRITING) {
            writeNow(target, values);
        }
    }

    private static void writeNow(File target, Properties values) {
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
