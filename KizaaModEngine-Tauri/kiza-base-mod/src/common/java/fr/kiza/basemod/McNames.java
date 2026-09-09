package fr.kiza.basemod;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.Charset;

/**
 * Finding a Minecraft class whatever the loader decided to call it.
 *
 * <p>Every call site in this client already carries its own list of spellings
 * -- {@code net.minecraft.client.gui.GuiGraphics} for Mojang's names,
 * {@code net.minecraft.class_332} for Yarn, an older name for the Forge
 * generations -- and takes the first that loads. That covers every loader,
 * because every loader renames Minecraft into something readable before the
 * game starts.
 *
 * <p>A plain Minecraft does not. Its classes keep the names the obfuscator
 * gave them, which are short, meaningless and different in every release:
 * {@code Screen} is {@code fod} in 1.21.1 and something else in 1.21.4. No
 * list written by hand can contain them.
 *
 * <p>So when none of the candidates load, this asks Mojang's own mapping --
 * the file the launcher fetches for exactly this case -- what the obfuscator
 * called it, and tries that. Nothing else about the call sites changes: they
 * still pass the names they always passed.
 *
 * <h2>When there is no mapping</h2>
 *
 * <p>Which is most of the time, and costs nothing. Under a loader the first
 * candidate resolves and the mapping is never consulted, never read from disk,
 * and never held in memory. A launch that was given no mapping, or one that
 * could not be read, behaves exactly as this client did before: the lookup
 * fails and the caller falls back, which every caller here already does.
 */
public final class McNames {

    /** Set by the launcher, and only for a plain Minecraft. */
    private static final String MAPPINGS_PROPERTY = "kiza.minecraft.mappings";

    private static ProguardMappings mappings;
    private static boolean loaded;

    private McNames() {}

    /**
     * The first of these that loads, or {@code null}.
     *
     * <p>The order is the caller's: it lists the spellings it prefers first,
     * and the obfuscated name is only reached for when none of them exist.
     */
    public static Class<?> firstClass(String... names) {
        for (String name : names) {
            try {
                return Class.forName(name);
            } catch (ClassNotFoundException ignored) {
                // Another loader's spelling. Try the next.
            }
        }

        ProguardMappings mapping = mappings();
        if (mapping.isEmpty()) return null;

        for (String name : names) {
            String obfuscated = mapping.classNamed(name);
            if (obfuscated == null) continue;
            try {
                return Class.forName(obfuscated);
            } catch (ClassNotFoundException ignored) {
                // The mapping is for another release of the game. Nothing here
                // can fix that, and a wrong class would be worse than none.
            }
        }
        return null;
    }

    /**
     * The mapping, read once on the first lookup that needs it.
     *
     * <p>Read lazily rather than at startup because most launches never need
     * it, and the ones that do are already paying for a game that has to
     * resolve everything by reflection. Failure of any kind -- no property, no
     * file, an unreadable one -- becomes the empty mapping, which makes every
     * lookup behave as it did before this existed.
     */
    private static synchronized ProguardMappings mappings() {
        if (loaded) return mappings;
        loaded = true;
        mappings = ProguardMappings.empty();

        String path = System.getProperty(MAPPINGS_PROPERTY);
        if (path == null || path.trim().isEmpty()) return mappings;

        File file = new File(path.trim());
        if (!file.isFile()) {
            System.err.println("[Kiza Launcher] No Minecraft mapping at " + file);
            return mappings;
        }

        try {
            Reader reader = new InputStreamReader(
                new FileInputStream(file),
                Charset.forName("UTF-8")
            );
            try {
                mappings = ProguardMappings.readClassNames(reader);
            } finally {
                reader.close();
            }
        } catch (Exception error) {
            // Never fatal. A client that cannot read the mapping is the client
            // as it was yesterday, not a game that will not start.
            System.err.println("[Kiza Launcher] Could not read the Minecraft mapping: " + error);
            mappings = ProguardMappings.empty();
        }
        return mappings;
    }

    /** Forgets what was read. Tests only. */
    static synchronized void forget() {
        loaded = false;
        mappings = null;
    }
}
