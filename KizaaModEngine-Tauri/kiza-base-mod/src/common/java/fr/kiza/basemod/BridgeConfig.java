package fr.kiza.basemod;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * Java 8 syntax on purpose: the same sources build the legacy jar, which runs
 * on the Java 8 that Minecraft 1.8-1.16 launches with.
 */
final class BridgeConfig {
    private static final Pattern TOKEN = Pattern.compile("[a-f0-9]{32}");
    private static final Pattern INSTANCE_ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");

    private final Path statePath;
    private final String token;
    private final String instanceId;

    BridgeConfig(Path statePath, String token, String instanceId) {
        this.statePath = statePath;
        this.token = token;
        this.instanceId = instanceId;
    }

    Path statePath() {
        return statePath;
    }

    String token() {
        return token;
    }

    String instanceId() {
        return instanceId;
    }

    static Optional<BridgeConfig> fromSystemProperties() {
        String rawPath = System.getProperty("kiza.state.path", "");
        String token = System.getProperty("kiza.state.token", "");
        String instanceId = System.getProperty("kiza.instance.id", "");
        if (rawPath.trim().isEmpty()
            || !TOKEN.matcher(token).matches()
            || !INSTANCE_ID.matcher(instanceId).matches()) {
            return Optional.empty();
        }

        try {
            Path path = Paths.get(rawPath).toAbsolutePath().normalize();
            if (!path.isAbsolute() || path.getFileName() == null) return Optional.empty();
            return Optional.of(new BridgeConfig(path, token, instanceId));
        } catch (RuntimeException invalidPath) {
            return Optional.empty();
        }
    }
}
