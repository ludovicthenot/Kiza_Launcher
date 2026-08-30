package fr.kiza.basemod;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Iterator;
import java.util.Locale;
import java.util.Optional;

final class RuntimeReportPublisher {
    private RuntimeReportPublisher() {}

    static void publish(ClientRuntimeContext context, ClientRuntime runtime) {
        Optional<Path> reportPath = ClientRuntimePaths.reportPath();
        if (!reportPath.isPresent()) return;

        Path destination = reportPath.get();
        Path parent = destination.getParent();
        if (parent == null) return;
        Path temporary = parent.resolve(destination.getFileName().toString() + ".tmp");
        try {
            Files.createDirectories(parent);
            Files.write(temporary, json(context, runtime).getBytes(StandardCharsets.UTF_8));
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
                // The launcher will report that no fresh runtime report exists.
            }
            System.err.println("[Kiza Launcher] Client runtime report could not be written.");
        }
    }

    private static String json(ClientRuntimeContext context, ClientRuntime runtime) {
        StringBuilder output = new StringBuilder(768);
        output.append('{');
        field(output, "schema_version", "1", false);
        field(output, "client_version", quoted(context.identity().clientVersion()), true);
        field(output, "minecraft_version", quoted(context.identity().minecraftVersion()), true);
        field(output, "loader", quoted(context.identity().loader()), true);
        field(output, "platform", quoted(context.platform()), true);
        field(output, "status", quoted(runtime.state()), true);
        field(output, "reported_at_ms", Long.toString(System.currentTimeMillis()), true);
        output.append(",\"capabilities\":[");
        Iterator<String> capability = runtime.activeCapabilities().iterator();
        while (capability.hasNext()) {
            output.append(quoted(capability.next()));
            if (capability.hasNext()) output.append(',');
        }
        output.append("],\"modules\":[");
        Iterator<ClientModuleStatus> modules = runtime.statuses().iterator();
        while (modules.hasNext()) {
            ClientModuleStatus module = modules.next();
            output.append('{');
            field(output, "id", quoted(module.id()), false);
            field(output, "name", quoted(module.name()), true);
            field(output, "required", Boolean.toString(module.required()), true);
            field(output, "status", quoted(module.state().name().toLowerCase(Locale.ROOT)), true);
            field(output, "detail", quoted(module.detail()), true);
            output.append('}');
            if (modules.hasNext()) output.append(',');
        }
        output.append("]}");
        return output.toString();
    }

    private static void field(StringBuilder output, String key, String value, boolean comma) {
        if (comma) output.append(',');
        output.append(quoted(key)).append(':').append(value);
    }

    /**
     * Escapes rather than replaces.
     *
     * <p>Everything outside printable ASCII used to become a question mark. The
     * details in this report are exception messages, and on Windows those are
     * full of paths, so a player whose folder carries an accent read their own
     * failure with the accent punched out of it. A six-character escape is
     * valid JSON and arrives at the launcher as the character that was written.
     */
    private static String quoted(String value) {
        StringBuilder escaped = new StringBuilder(value.length() + 2).append('"');
        for (int index = 0; index < value.length(); index += 1) {
            char character = value.charAt(index);
            if (character == '"' || character == '\\') {
                escaped.append('\\').append(character);
            } else if (character == '\n') {
                escaped.append("\\n");
            } else if (character == '\r') {
                escaped.append("\\r");
            } else if (character == '\t') {
                escaped.append("\\t");
            } else if (character >= 0x20 && character <= 0x7e) {
                escaped.append(character);
            } else {
                escaped.append("\\u").append(String.format(Locale.ROOT, "%04x", (int) character));
            }
        }
        return escaped.append('"').toString();
    }
}

