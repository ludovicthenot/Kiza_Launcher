package fr.kiza.basemod;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

final class ClientModuleStatus {
    enum State {
        READY,
        DISABLED,
        FAILED
    }

    private final String id;
    private final String name;
    private final boolean required;
    private final State state;
    private final String detail;
    private final Set<String> capabilities;

    ClientModuleStatus(ClientModule module, State state, String detail) {
        this.id = module.id();
        this.name = module.name();
        this.required = module.required();
        this.state = state;
        this.detail = detail == null ? "" : detail;
        this.capabilities = Collections.unmodifiableSet(
            new LinkedHashSet<String>(module.capabilities())
        );
    }

    String id() {
        return id;
    }

    String name() {
        return name;
    }

    boolean required() {
        return required;
    }

    State state() {
        return state;
    }

    String detail() {
        return detail;
    }

    Set<String> capabilities() {
        return capabilities;
    }
}
