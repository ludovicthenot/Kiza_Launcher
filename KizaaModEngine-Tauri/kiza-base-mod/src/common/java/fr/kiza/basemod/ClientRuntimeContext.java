package fr.kiza.basemod;

final class ClientRuntimeContext {
    private final ClientIdentity identity;
    private final String platform;
    private final ClientConfig config;
    private final ClientEventBus events;

    ClientRuntimeContext(
        ClientIdentity identity,
        String platform,
        ClientConfig config,
        ClientEventBus events
    ) {
        this.identity = identity;
        this.platform = platform;
        this.config = config;
        this.events = events;
    }

    ClientIdentity identity() {
        return identity;
    }

    String platform() {
        return platform;
    }

    ClientConfig config() {
        return config;
    }

    ClientEventBus events() {
        return events;
    }
}
