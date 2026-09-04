package fr.kiza.basemod;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

public final class KizaClientManager {
    private static final AtomicBoolean STARTED = new AtomicBoolean();
    private static volatile ClientIdentity identity = ClientIdentity.fromSystemProperties();

    private KizaClientManager() {}

    /** Optional launcher identity line shown in the F3 overlay. */
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
            "[Kiza Launcher] Starting " + identity.windowTitle() + " on " + platform + "."
        );

        ClientEventBus events = new ClientEventBus();
        events.subscribe(event -> System.out.println(
            "[Kiza Launcher] " + event.type() + " / " + event.moduleId() + " / " + event.message()
        ));

        // Declared before the configuration is read, because the configuration
        // derives its keys from these ids rather than repeating them.
        List<ClientModule> declared = new ArrayList<ClientModule>();
        // Not required: a Minecraft version whose render hooks Kiza cannot reach
        // is a plain-looking client, not a broken one.
        declared.add(module(
            "ui",
            "Launcher interface",
            false,
            Collections.<String>emptyList(),
            capabilities("menu-theme", "window-branding"),
            installPlatformUi
        ));
        // Depends on the interface module rather than standing alone. Both are
        // delivered by the same mixins: if the render hooks could not be
        // reached, "ui" fails, and a HUD that started anyway would be claiming
        // a capability nothing is going to draw.
        declared.add(module(
            "hud",
            "In-game HUD",
            false,
            Collections.singletonList("ui"),
            capabilities("in-game-hud"),
            new Runnable() {
                @Override
                public void run() {
                    fr.kiza.basemod.hud.HudRenderer.activate();
                }
            }
        ));
        // Required: this one is plain Java against the launcher's own files, so
        // it has no version-specific way to fail. If it does, something is
        // actually wrong and the launcher should say so.
        declared.add(module(
            "state_bridge",
            "Launcher state bridge",
            true,
            Collections.<String>emptyList(),
            capabilities("discord-presence-state", "local-state-bridge"),
            () -> StateReporter.start(detector)
        ));

        Set<String> declaredIds = new LinkedHashSet<String>();
        for (ClientModule declaredModule : declared) {
            declaredIds.add(declaredModule.id());
        }

        ClientRuntimeContext context = new ClientRuntimeContext(
            identity,
            platform,
            ClientConfig.load(declaredIds),
            events
        );
        ClientRuntime runtime = new ClientRuntime();
        for (ClientModule declaredModule : declared) {
            runtime.register(declaredModule);
        }
        runtime.start(context);
        // Published outside the runtime, and deliberately not a module of its
        // own. It has to run when everything else has failed, which is exactly
        // when the report matters most: a module that claimed to write it would
        // have been advertising a capability the launcher gets either way.
        RuntimeReportPublisher.publish(context, runtime);

        long elapsedMs = (System.nanoTime() - startedAt) / 1_000_000L;
        System.out.println(
            "[Kiza Launcher] Client runtime " + runtime.state()
                + " with " + runtime.activeCapabilities().size() + " capabilities in "
                + elapsedMs + " ms."
        );
    }

    static ClientIdentity identity() {
        return identity;
    }

    public static String windowTitle() {
        return identity.windowTitle();
    }

    private static Set<String> capabilities(String... values) {
        return Collections.unmodifiableSet(new LinkedHashSet<String>(Arrays.asList(values)));
    }

    private static ClientModule module(
        String id,
        String name,
        boolean required,
        List<String> dependencies,
        Set<String> capabilities,
        Runnable start
    ) {
        return new ClientModule() {
            @Override
            public String id() {
                return id;
            }

            @Override
            public String name() {
                return name;
            }

            @Override
            public List<String> dependencies() {
                return dependencies;
            }

            @Override
            public Set<String> capabilities() {
                return capabilities;
            }

            @Override
            public boolean required() {
                return required;
            }

            @Override
            public void start(ClientRuntimeContext context) {
                start.run();
            }
        };
    }
}
