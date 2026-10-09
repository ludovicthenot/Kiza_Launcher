package fr.kiza.basemod;

import java.nio.file.Path;
import java.util.Optional;

/**
 * The runtime's paths, for the menu package.
 *
 * <p>{@code ClientRuntimePaths} stays package-private; this is the one door the
 * menu needs through it -- where this instance's runtime folder is, so the
 * Kiza Client settings can be kept beside the runtime's own.
 */
public final class ClientRuntimeAccess {
    private ClientRuntimeAccess() {}

    public static Optional<Path> configPath() {
        return ClientRuntimePaths.configPath();
    }
}
