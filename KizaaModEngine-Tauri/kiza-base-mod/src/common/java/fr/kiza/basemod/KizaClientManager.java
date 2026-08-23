package fr.kiza.basemod;

import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

public final class KizaClientManager {
    private static final AtomicBoolean STARTED = new AtomicBoolean();
    private static volatile ClientIdentity identity = ClientIdentity.fromSystemProperties();

    private KizaClientManager() {}

    /** Line shown in the F3 overlay, e.g. "Kiza Client 1.21.11 (v0.0.280)". */
    public static String debugLabel() {
        return identity.windowTitle();
    }

    public static void initialize(
        String platform,
        StateDetector detector,
        Runnable installPlatformUi
    ) {
        if (!STARTED.compareAndSet(false, true)) return;

        long startedAt = System.nanoTime();
        identity = ClientIdentity.fromSystemProperties();
        System.out.println(
            "[Kiza Client] Starting " + identity.windowTitle() + " on " + platform + "."
        );

        List<ClientModule> modules = Arrays.asList(
            module("UI", installPlatformUi),
            module("State bridge", () -> StateReporter.start(detector))
        );
        int ready = 0;
        for (ClientModule module : modules) {
            try {
                module.start();
                ready += 1;
                System.out.println("[Kiza Client] " + module.name() + " manager ready.");
            } catch (RuntimeException error) {
                System.err.println(
                    "[Kiza Client] " + module.name() + " manager could not be initialized."
                );
            }
        }

        long elapsedMs = (System.nanoTime() - startedAt) / 1_000_000L;
        System.out.println(
            "[Kiza Client] " + ready + "/" + modules.size()
                + " managers initialized in " + elapsedMs + " ms."
        );
    }

    static ClientIdentity identity() {
        return identity;
    }

    public static String windowTitle() {
        return identity.windowTitle();
    }

    private static ClientModule module(String name, Runnable start) {
        return new ClientModule() {
            @Override
            public String name() {
                return name;
            }

            @Override
            public void start() {
                start.run();
            }
        };
    }
}
