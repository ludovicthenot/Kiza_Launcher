package fr.kiza.basemod.menu;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.imageio.ImageIO;

/**
 * The menu backgrounds the player has added: every image, GIF and video,
 * kept so any of them can be picked again in one click.
 *
 * <p>One library for every instance, in the launcher's global folder, which
 * the launcher names to the game as {@code kiza.backgrounds.path}; started
 * without the launcher, a {@code backgrounds} folder beside the settings.
 * Which one is shown is still each instance's own setting.
 *
 * <p>Backgrounds chosen before the library existed lived in the instance's
 * runtime folder; the first look at the library moves them in, with the
 * frames a video was already prepared into, so nothing is prepared twice.
 *
 * <p>Each item has a thumbnail, made once on a thread of its own -- a GIF's
 * first frame, a video's first -- and kept in {@code .thumbs}.
 */
final class MenuLibrary {
    private MenuLibrary() {}

    static final int THUMB_WIDTH = 192;
    static final int THUMB_HEIGHT = 108;

    private static final Map<String, Object> TEXTURES = new HashMap<String, Object>();
    private static final Map<String, byte[]> READY = Collections.synchronizedMap(new HashMap<String, byte[]>());
    private static final java.util.Set<String> MAKING = Collections.synchronizedSet(new java.util.HashSet<String>());
    private static ExecutorService maker;
    private static boolean migrated;
    private static int textureNumber;

    /** The library's folder, made if needed; null when there is nowhere to keep one. */
    static File folder() {
        String named = System.getProperty("kiza.backgrounds.path", "").trim();
        File folder;
        if (!named.isEmpty()) {
            folder = new File(named);
        } else {
            File settings = ClientSettings.folder();
            if (settings == null) return null;
            folder = new File(settings, "backgrounds");
        }
        if (!folder.isDirectory() && !folder.mkdirs()) return null;
        migrate(folder);
        return folder;
    }

    private static List<File> listed;
    private static long listedAt;

    /** Read the folder again at the next look: something was added or taken out. */
    static synchronized void changed() {
        listed = null;
    }

    /**
     * What is in the library, newest first. Read again at most once a
     * second: the panel asks every frame, twice.
     */
    static synchronized List<File> items() {
        long now = System.nanoTime();
        if (listed != null && now - listedAt < 1_000_000_000L) return listed;
        listed = read();
        listedAt = now;
        return listed;
    }

    private static List<File> read() {
        File folder = folder();
        List<File> items = new ArrayList<File>();
        if (folder == null) return items;
        File[] files = folder.listFiles();
        if (files == null) return items;
        for (File file : files) {
            if (file.isFile() && !file.getName().startsWith(".") && SettingsPanel.kindOf(file) != null
                && !file.getName().endsWith(".copying")) {
                items.add(file);
            }
        }
        Collections.sort(items, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        return items;
    }

    /**
     * Copies {@code source} into the library under its own name -- `(2)` when
     * that is taken by another file -- whole, through a temporary name, so a
     * half-copied file is never offered. The same file added twice is kept once.
     */
    static File add(File source) throws IOException {
        File folder = folder();
        if (folder == null) throw new IOException("no library folder");
        String name = safeName(source.getName());
        File target = new File(folder, name);
        if (target.isFile() && target.length() == source.length()) return target;
        target = free(folder, name);
        File partial = new File(folder, target.getName() + ".copying");
        Files.copy(source.toPath(), partial.toPath(), StandardCopyOption.REPLACE_EXISTING);
        Files.move(partial.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);
        // A copy keeps the original's date; the library lists the newest
        // first, and the newest is the one just added.
        target.setLastModified(System.currentTimeMillis());
        changed();
        return target;
    }

    /** Takes an item out: the file, its thumbnail and the frames a video was prepared into. */
    static void remove(File item) {
        File folder = item.getParentFile();
        File[] siblings = folder == null ? null : folder.listFiles();
        if (siblings != null) {
            for (File sibling : siblings) {
                if (sibling.isDirectory() && sibling.getName().startsWith(item.getName() + ".kiza-")) delete(sibling);
            }
        }
        delete(thumbFile(item));
        READY.remove(key(item));
        if (!item.delete()) item.deleteOnExit();
        changed();
    }

    // ---- Thumbnails -------------------------------------------------------------

    /**
     * The item's thumbnail as a texture, on the render thread; null while it
     * is being made, which starts it.
     */
    static Object thumbnail(File item) {
        String key = key(item);
        Object texture = TEXTURES.get(key);
        if (texture != null) return texture;
        byte[] png = READY.get(key);
        if (png != null) {
            Object uploaded = fr.kiza.basemod.render.KizaCanvas.uploadPng("library_" + (textureNumber++), png, true);
            if (uploaded != null) TEXTURES.put(key, uploaded);
            return uploaded;
        }
        make(item, key);
        return null;
    }

    /** Kiza's own background, as a thumbnail. */
    static Object kizaThumbnail() {
        Object texture = TEXTURES.get("kiza");
        if (texture != null) return texture;
        try (java.io.InputStream stream = MenuLibrary.class.getResourceAsStream(
            "/assets/kiza_base_mod/textures/gui/kiza_menu_background.png")) {
            if (stream == null) return null;
            BufferedImage picture = ImageIO.read(stream);
            if (picture == null) return null;
            Object uploaded = fr.kiza.basemod.render.KizaCanvas.uploadPng("library_kiza", png(thumb(picture)), true);
            if (uploaded != null) TEXTURES.put("kiza", uploaded);
            return uploaded;
        } catch (IOException | RuntimeException unreadable) {
            return null;
        }
    }

    private static synchronized void make(final File item, final String key) {
        if (!MAKING.add(key)) return;
        if (maker == null) {
            maker = Executors.newSingleThreadExecutor(task -> {
                Thread thread = new Thread(task, "kiza-menu-thumbnails");
                thread.setDaemon(true);
                thread.setPriority(Thread.MIN_PRIORITY);
                return thread;
            });
        }
        maker.execute(() -> {
            try {
                File cached = thumbFile(item);
                byte[] png;
                if (cached.isFile()) {
                    png = Files.readAllBytes(cached.toPath());
                } else {
                    BufferedImage picture = firstFrame(item);
                    png = png(picture == null ? placeholder() : thumb(picture));
                    if (picture != null) {
                        cached.getParentFile().mkdirs();
                        Files.write(cached.toPath(), png);
                    }
                }
                READY.put(key, png);
            } catch (Throwable failure) {
                try {
                    READY.put(key, png(placeholder()));
                } catch (IOException ignored) {
                    // Nothing to show: the tile stays empty.
                }
            }
        });
    }

    private static BufferedImage firstFrame(File item) throws Exception {
        ClientSettings.Background kind = SettingsPanel.kindOf(item);
        if (kind == ClientSettings.Background.VIDEO) {
            // Decoded by the same code that prepares videos, which only the
            // jars that carry video have: elsewhere a placeholder.
            try {
                return (BufferedImage) Class.forName("fr.kiza.basemod.menu.VideoPreparation")
                    .getMethod("thumbnail", File.class, int.class)
                    .invoke(null, item, THUMB_HEIGHT * 2);
            } catch (ClassNotFoundException absent) {
                return null;
            }
        }
        // A GIF's first frame is what ImageIO reads first.
        return ImageIO.read(item);
    }

    /** The picture, covering a 16:9 thumbnail with rounded corners. */
    private static BufferedImage thumb(BufferedImage picture) {
        int scale = 2;
        int w = THUMB_WIDTH * scale / 2;
        int h = THUMB_HEIGHT * scale / 2;
        BufferedImage out = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        java.awt.Graphics2D g = out.createGraphics();
        Buttons.quality(g);
        g.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION, java.awt.RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g.setClip(new java.awt.geom.RoundRectangle2D.Float(0, 0, w, h, 14, 14));
        double cover = Math.max(w / (double) picture.getWidth(), h / (double) picture.getHeight());
        int dw = (int) Math.ceil(picture.getWidth() * cover);
        int dh = (int) Math.ceil(picture.getHeight() * cover);
        BufferedImage reduced = MenuBackground.fit(picture, Math.max(dw, 1), Math.max(dh, 1));
        g.drawImage(reduced, (w - reduced.getWidth()) / 2, (h - reduced.getHeight()) / 2, null);
        g.dispose();
        return out;
    }

    private static BufferedImage placeholder() {
        BufferedImage out = new BufferedImage(THUMB_WIDTH, THUMB_HEIGHT, BufferedImage.TYPE_INT_ARGB);
        java.awt.Graphics2D g = out.createGraphics();
        Buttons.quality(g);
        g.setColor(new java.awt.Color(0xFF26262D, true));
        g.fill(new java.awt.geom.RoundRectangle2D.Float(0, 0, THUMB_WIDTH, THUMB_HEIGHT, 14, 14));
        g.dispose();
        return out;
    }

    private static byte[] png(BufferedImage image) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        ImageIO.write(image, "png", bytes);
        return bytes.toByteArray();
    }

    private static String key(File item) {
        return item.getName() + "|" + item.length() + "|" + item.lastModified();
    }

    private static File thumbFile(File item) {
        return new File(new File(item.getParentFile(), ".thumbs"),
            item.getName() + "-" + Long.toString(item.lastModified(), 36) + ".png");
    }

    // ---- Names and the move from the runtime folder ---------------------------------

    /** A file name Windows takes, without what would break a jar path or a URL. */
    private static String safeName(String name) {
        String cleaned = name.replaceAll("[<>:\"/\\\\|?*!\\p{Cntrl}]", " ").replaceAll("\\s+", " ").trim();
        return cleaned.isEmpty() || cleaned.startsWith(".") ? "background" + cleaned : cleaned;
    }

    private static File free(File folder, String name) {
        File candidate = new File(folder, name);
        if (!candidate.exists()) return candidate;
        int dot = name.lastIndexOf('.');
        String stem = dot > 0 ? name.substring(0, dot) : name;
        String extension = dot > 0 ? name.substring(dot) : "";
        for (int number = 2; ; number += 1) {
            candidate = new File(folder, stem + " (" + number + ")" + extension);
            if (!candidate.exists()) return candidate;
        }
    }

    /**
     * Once a session: the backgrounds this instance chose before the library,
     * moved in from its runtime folder, the settings pointing at them anew.
     */
    private static synchronized void migrate(File library) {
        if (migrated) return;
        migrated = true;
        File runtime = ClientSettings.folder();
        if (runtime == null || runtime.equals(library)) return;
        for (ClientSettings.Background kind : ClientSettings.Background.values()) {
            if (kind == ClientSettings.Background.KIZA) continue;
            String name = ClientSettings.backgroundName(kind);
            if (name.isEmpty()) continue;
            File old = new File(runtime, name);
            if (!old.isFile()) continue;
            try {
                File target = new File(library, name);
                if (!(target.isFile() && target.length() == old.length())) {
                    target = free(library, name);
                    Files.move(old.toPath(), target.toPath());
                } else if (!old.delete()) {
                    old.deleteOnExit();
                }
                // A video's prepared frames come along, so it is not prepared again.
                File[] siblings = runtime.listFiles();
                if (siblings != null) {
                    for (File sibling : siblings) {
                        if (!sibling.isDirectory() || !sibling.getName().startsWith(name + ".kiza-")) continue;
                        String suffix = sibling.getName().substring(name.length());
                        File destination = new File(library, target.getName() + suffix);
                        if (destination.exists()) delete(sibling);
                        else Files.move(sibling.toPath(), destination.toPath());
                    }
                }
                ClientSettings.rememberBackground(kind, target.getName());
            } catch (IOException | RuntimeException failure) {
                System.err.println("[Kiza Client] A background stays in the runtime folder: " + failure);
            }
        }
    }

    private static void delete(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) delete(child);
            }
        }
        if (file.exists()) file.delete();
    }

    /** The extension's kind, for a name: used by the panel's tiles. */
    static String extensionOf(File item) {
        String name = item.getName();
        int dot = name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }
}
