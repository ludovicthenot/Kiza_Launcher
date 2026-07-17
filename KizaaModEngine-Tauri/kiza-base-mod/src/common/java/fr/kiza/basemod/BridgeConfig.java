package fr.kiza.basemod;

import java.nio.file.Path;
import java.util.Optional;
import java.util.regex.Pattern;

record BridgeConfig(Path statePath, String token, String instanceId) {
    private static final Pattern TOKEN = Pattern.compile("[a-f0-9]{32}");
    private static final Pattern INSTANCE_ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");

    static Optional<BridgeConfig> fromSystemProperties() {
        String rawPath = System.getProperty("kiza.state.path", "");
        String token = System.getProperty("kiza.state.token", "");
        String instanceId = System.getProperty("kiza.instance.id", "");
        if (rawPath.isBlank()
            || !TOKEN.matcher(token).matches()
            || !INSTANCE_ID.matcher(instanceId).matches()) {
            return Optional.empty();
        }

        try {
            Path path = Path.of(rawPath).toAbsolutePath().normalize();
            if (!path.isAbsolute() || path.getFileName() == null) return Optional.empty();
            return Optional.of(new BridgeConfig(path, token, instanceId));
        } catch (RuntimeException invalidPath) {
            return Optional.empty();
        }
    }
}
