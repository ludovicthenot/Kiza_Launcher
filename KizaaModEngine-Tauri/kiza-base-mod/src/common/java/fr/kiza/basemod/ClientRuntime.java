package fr.kiza.basemod;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

final class ClientRuntime {
    private static final Pattern MODULE_ID = Pattern.compile("[a-z][a-z0-9_]{1,47}");

    private final Map<String, ClientModule> modules = new LinkedHashMap<String, ClientModule>();
    private final Map<String, ClientModuleStatus> statuses =
        new LinkedHashMap<String, ClientModuleStatus>();

    void register(ClientModule module) {
        if (module == null || !MODULE_ID.matcher(module.id()).matches()) {
            throw new IllegalArgumentException("Invalid Kiza client module id.");
        }
        if (module.dependencies() == null || module.capabilities() == null) {
            throw new IllegalArgumentException("Kiza client module metadata is incomplete.");
        }
        for (String dependency : module.dependencies()) {
            if (dependency == null || !MODULE_ID.matcher(dependency).matches()) {
                throw new IllegalArgumentException("Invalid Kiza client module dependency.");
            }
        }
        if (modules.containsKey(module.id())) {
            throw new IllegalArgumentException("Duplicate Kiza client module: " + module.id());
        }
        modules.put(module.id(), module);
    }

    void start(ClientRuntimeContext context) {
        context.events().publish(new ClientEvent(
            ClientEvent.Type.RUNTIME_STARTING,
            "runtime",
            "Starting Kiza Client Runtime"
        ));

        Set<String> remaining = new LinkedHashSet<String>(modules.keySet());
        while (!remaining.isEmpty()) {
            boolean progressed = false;
            for (String id : new ArrayList<String>(remaining)) {
                ClientModule module = modules.get(id);
                String unavailableDependency = unavailableDependency(module);
                if (unavailableDependency != null) {
                    fail(context, module, "Dependency unavailable: " + unavailableDependency);
                    remaining.remove(id);
                    progressed = true;
                    continue;
                }
                if (!dependenciesResolved(module)) continue;

                // Asking whether the module is enabled is inside the guard on
                // purpose: a module the configuration has never heard of is a
                // build mistake, and it should mark that one module failed
                // rather than escape and take the game down.
                try {
                    if (!context.config().moduleEnabled(module.id())) {
                        update(
                            context,
                            module,
                            ClientModuleStatus.State.DISABLED,
                            "Disabled by instance settings"
                        );
                    } else {
                        module.start(context);
                        update(context, module, ClientModuleStatus.State.READY, "Ready");
                    }
                } catch (VirtualMachineError fatal) {
                    // The JVM itself is gone. Nothing this runtime reported
                    // afterwards would be true.
                    throw fatal;
                } catch (Throwable error) {
                    fail(context, module, safeError(error));
                }
                remaining.remove(id);
                progressed = true;
            }

            if (!progressed) {
                for (String id : remaining) {
                    fail(context, modules.get(id), "Dependency cycle detected");
                }
                remaining.clear();
            }
        }

        context.events().publish(new ClientEvent(
            ClientEvent.Type.RUNTIME_READY,
            "runtime",
            // The same three words the report carries, so a log line and the
            // launcher never describe one runtime differently.
            state()
        ));
    }

    List<ClientModuleStatus> statuses() {
        return Collections.unmodifiableList(new ArrayList<ClientModuleStatus>(statuses.values()));
    }

    Set<String> activeCapabilities() {
        Set<String> capabilities = new LinkedHashSet<String>();
        for (ClientModuleStatus status : statuses.values()) {
            if (status.state() == ClientModuleStatus.State.READY) {
                capabilities.addAll(status.capabilities());
            }
        }
        return capabilities;
    }

    boolean healthy() {
        for (ClientModuleStatus status : statuses.values()) {
            if (status.state() == ClientModuleStatus.State.FAILED) return false;
        }
        return operational();
    }

    boolean operational() {
        for (ClientModuleStatus status : statuses.values()) {
            if (status.required() && status.state() != ClientModuleStatus.State.READY) return false;
        }
        return true;
    }

    String state() {
        if (!operational()) return "failed";
        return healthy() ? "ready" : "degraded";
    }

    private String unavailableDependency(ClientModule module) {
        for (String dependency : module.dependencies()) {
            if (!modules.containsKey(dependency)) return dependency;
            ClientModuleStatus status = statuses.get(dependency);
            if (status != null && status.state() != ClientModuleStatus.State.READY) return dependency;
        }
        return null;
    }

    private boolean dependenciesResolved(ClientModule module) {
        for (String dependency : module.dependencies()) {
            if (!statuses.containsKey(dependency)) return false;
        }
        return true;
    }

    private void fail(ClientRuntimeContext context, ClientModule module, String detail) {
        update(context, module, ClientModuleStatus.State.FAILED, detail);
    }

    private void update(
        ClientRuntimeContext context,
        ClientModule module,
        ClientModuleStatus.State state,
        String detail
    ) {
        ClientModuleStatus status = new ClientModuleStatus(module, state, detail);
        statuses.put(module.id(), status);
        ClientEvent.Type type;
        if (state == ClientModuleStatus.State.READY) {
            type = ClientEvent.Type.MODULE_READY;
        } else if (state == ClientModuleStatus.State.DISABLED) {
            type = ClientEvent.Type.MODULE_DISABLED;
        } else {
            type = ClientEvent.Type.MODULE_FAILED;
        }
        context.events().publish(new ClientEvent(type, module.id(), detail));
    }

    /**
     * Why this takes a {@link Throwable} rather than a {@link RuntimeException}.
     *
     * <p>This mod spans Minecraft 1.7 to 1.21 across four loader variants, and
     * the way a module fails there is almost never an exception. It is
     * {@code NoClassDefFoundError}, {@code NoSuchMethodError},
     * {@code IncompatibleClassChangeError}: a class that moved, a method whose
     * signature changed one version over. Those are {@code Error}s, and catching
     * only {@code RuntimeException} let every one of them out of the runtime and
     * into the game, which died on the spot.
     *
     * <p>So the runtime catches errors too. A Kiza module that cannot load on
     * this version is a missing feature, not a dead game.
     */
    private static String safeError(Throwable error) {
        String message = error.getMessage();
        if (message == null || message.trim().isEmpty()) return error.getClass().getSimpleName();
        String compact = message.replace('\n', ' ').replace('\r', ' ').trim();
        String detail = compact.length() <= 160 ? compact : compact.substring(0, 160);
        // A LinkageError carries a class name and no hint of what asked for it,
        // so the kind of failure travels with the message.
        return error instanceof RuntimeException
            ? detail
            : error.getClass().getSimpleName() + ": " + detail;
    }
}
