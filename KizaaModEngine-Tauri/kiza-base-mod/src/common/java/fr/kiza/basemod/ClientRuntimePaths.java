package fr.kiza.basemod;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Optional;

final class ClientRuntimePaths {
    private ClientRuntimePaths() {}

    static Optional<Path> configPath() {
        return absoluteFileProperty("kiza.client.config.path");
    }

    static Optional<Path> reportPath() {
        return absoluteFileProperty("kiza.client.report.path");
    }

    private static Optional<Path> absoluteFileProperty(String name) {
        String raw = System.getProperty(name, "").trim();
        if (raw.isEmpty()) return Optional.empty();
        try {
            Path path = Paths.get(raw).toAbsolutePath().normalize();
            if (!path.isAbsolute() || path.getFileName() == null) return Optional.empty();
            return Optional.of(path);
        } catch (RuntimeException invalidPath) {
            return Optional.empty();
        }
    }
}
