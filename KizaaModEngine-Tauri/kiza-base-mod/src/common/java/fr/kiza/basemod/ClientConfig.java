package fr.kiza.basemod;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;

/**
 * The per-instance switches for the client runtime, as a properties file the
 * player can open in a text editor.
 *
 * <p>The keys are not a constant. They are derived from the modules that were
 * actually registered, because the previous version kept a hand-written
 * allowlist beside the module list and the two could drift: a key absent from
 * the list fell through to "enabled", so a module added later could never be
 * switched off and nothing said why.
 *
 * <p>Keys this build does not recognise are read back and written out again
 * untouched. Dropping them meant that running an older Kiza once silently
 * erased whatever a newer one had written.
 */
final class ClientConfig {
    private static final long MAX_CONFIG_BYTES = 64L * 1024L;
    private static final String MODULE_PREFIX = "module.";

    private final Optional<Path> path;
    private final Set<String> moduleIds;
    private final Properties stored;

    private ClientConfig(Optional<Path> path, Set<String> moduleIds, Properties stored) {
        this.path = path;
        this.moduleIds = Collections.unmodifiableSet(new LinkedHashSet<String>(moduleIds));
        this.stored = stored;
    }

    static ClientConfig load(Set<String> moduleIds) {
        Optional<Path> path = ClientRuntimePaths.configPath();
        Properties stored = new Properties();
        boolean readable = false;

        if (path.isPresent() && Files.isRegularFile(path.get())) {
            try {
                if (Files.size(path.get()) <= MAX_CONFIG_BYTES) {
                    try (InputStream input = Files.newInputStream(path.get())) {
                        stored.load(input);
                    }
                    readable = true;
                }
            } catch (IOException error) {
                System.err.println(
                    "[Kiza Launcher] Client settings could not be read; defaults are active."
                );
            }
        }

        ClientConfig config = new ClientConfig(path, moduleIds, stored);
        // Written on the first launch, and again only when this build brought a
        // module the file has never heard of. Rewriting it every launch churned
        // the instance folder for nothing.
        if (!readable || !config.describesEveryModule()) {
            config.write();
        }
        return config;
    }

    /**
     * @throws IllegalStateException when asked about a module that was never
     *     declared, which is a build mistake rather than a user setting. The
     *     runtime catches it and marks that one module failed, so the mistake
     *     is visible in the launcher instead of silently defaulting to on.
     */
    boolean moduleEnabled(String moduleId) {
        if (!moduleIds.contains(moduleId)) {
            throw new IllegalStateException(
                "Module " + moduleId + " is not declared in the client configuration."
            );
        }
        String raw = stored.getProperty(MODULE_PREFIX + moduleId);
        return raw == null || !"false".equals(raw.trim().toLowerCase(Locale.ROOT));
    }

    private boolean describesEveryModule() {
        for (String moduleId : moduleIds) {
            if (stored.getProperty(MODULE_PREFIX + moduleId) == null) return false;
        }
        return true;
    }

    private void write() {
        if (!path.isPresent()) return;
        Path destination = path.get();
        Path parent = destination.getParent();
        if (parent == null) return;

        // A unique suffix: the same instance can be launched twice, and two
        // runs sharing one temporary name would hand each other half a file.
        Path temporary = parent.resolve(
            destination.getFileName().toString() + "." + UUID.randomUUID() + ".tmp"
        );
        try {
            Files.createDirectories(parent);
            Files.write(temporary, contents().getBytes(StandardCharsets.UTF_8));
            try {
                Files.move(
                    temporary,
                    destination,
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE
                );
            } catch (AtomicMoveNotSupportedException unsupported) {
                Files.move(temporary, destination, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException error) {
            try {
                Files.deleteIfExists(temporary);
            } catch (IOException ignored) {
                // The next launch uses the last valid configuration.
            }
            System.err.println("[Kiza Launcher] Client settings could not be persisted.");
        }
    }

    /**
     * Written by hand rather than through {@link Properties#store}, which stamps
     * the current date into the file and so produced a different byte sequence
     * on every launch.
     */
    private String contents() {
        StringBuilder file = new StringBuilder(512);
        file.append("# Kiza Client Runtime settings for this instance.\n");
        file.append("# Set a module to false to keep it from starting. Remove a line\n");
        file.append("# to go back to the default, which is on.\n");
        for (String moduleId : moduleIds) {
            String key = MODULE_PREFIX + moduleId;
            String value = stored.getProperty(key);
            file.append(key).append('=').append(value == null ? "true" : value.trim()).append('\n');
        }

        List<String> preserved = new ArrayList<String>();
        for (String name : stored.stringPropertyNames()) {
            if (!name.startsWith(MODULE_PREFIX)
                || !moduleIds.contains(name.substring(MODULE_PREFIX.length()))) {
                preserved.add(name);
            }
        }
        if (!preserved.isEmpty()) {
            Collections.sort(preserved);
            file.append("\n# Kept as written: this build does not use these keys.\n");
            for (String name : preserved) {
                file.append(name).append('=').append(stored.getProperty(name)).append('\n');
            }
        }
        return file.toString();
    }
}
