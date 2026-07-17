package fr.kiza.basemod;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;

final class StateFilePublisher implements AutoCloseable {
    private final BridgeConfig config;
    private final Path temporaryPath;
    private long sequence;

    StateFilePublisher(BridgeConfig config) {
        this.config = config;
        this.temporaryPath = config.statePath().resolveSibling(
            config.statePath().getFileName() + ".tmp-" + ProcessHandle.current().pid()
        );
    }

    void publish(PlayerState state) throws IOException {
        Path parent = config.statePath().getParent();
        if (parent == null) throw new IOException("State path has no parent");
        Files.createDirectories(parent);
        String json = toJson(state, System.currentTimeMillis(), ++sequence);
        Files.writeString(
            temporaryPath,
            json,
            StandardCharsets.UTF_8,
            StandardOpenOption.CREATE,
            StandardOpenOption.TRUNCATE_EXISTING,
            StandardOpenOption.WRITE
        );
        try {
            Files.move(
                temporaryPath,
                config.statePath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING
            );
        } catch (AtomicMoveNotSupportedException unsupported) {
            Files.move(temporaryPath, config.statePath(), StandardCopyOption.REPLACE_EXISTING);
        }
    }

    String toJson(PlayerState state, long updatedAtMs, long currentSequence) {
        return "{"
            + "\"schema_version\":1,"
            + "\"instance_id\":\"" + escape(config.instanceId()) + "\","
            + "\"token\":\"" + escape(config.token()) + "\","
            + "\"state\":\"" + state.wireName() + "\","
            + "\"updated_at_ms\":" + updatedAtMs + ","
            + "\"sequence\":" + currentSequence
            + "}";
    }

    @Override
    public void close() {
        try {
            Files.deleteIfExists(temporaryPath);
            Files.deleteIfExists(config.statePath());
        } catch (IOException ignored) {
            // The launcher also removes stale state at the next launch.
        }
    }

    private static String escape(String value) {
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t");
    }
}

