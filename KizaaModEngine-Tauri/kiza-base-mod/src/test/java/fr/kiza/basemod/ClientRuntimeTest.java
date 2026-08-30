package fr.kiza.basemod;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Properties;
import java.util.Set;

public final class ClientRuntimeTest {
    private ClientRuntimeTest() {}

    public static void main(String[] args) throws Exception {
        startsModulesInDependencyOrderAndPublishesCapabilities();
        disablesAModuleTheFileTurnsOff();
        keepsSettingsThisBuildDoesNotUnderstand();
        writesTheFileOnceAndLeavesItAlone();
        rejectsDuplicateModuleIds();
        reportsMissingDependenciesWithoutCrashing();
        aModuleThatFailsToLinkDoesNotReachTheGame();
        anUndeclaredModuleFailsInsteadOfDefaultingToOn();
        theReportKeepsCharactersOutsideAscii();
        System.out.println("Kiza Client Runtime tests passed");
    }

    private static void startsModulesInDependencyOrderAndPublishesCapabilities() throws Exception {
        Path directory = freshDirectory();

        StringBuilder order = new StringBuilder();
        ClientRuntime runtime = new ClientRuntime();
        runtime.register(module(
            "foundation",
            true,
            Collections.<String>emptyList(),
            set("foundation-ready"),
            () -> order.append('1')
        ));
        runtime.register(module(
            "dependent",
            false,
            Arrays.asList("foundation"),
            set("dependent-ready"),
            () -> order.append('2')
        ));
        ClientRuntimeContext context = context(ids("foundation", "dependent"));
        runtime.start(context);
        RuntimeReportPublisher.publish(context, runtime);

        assert "12".contentEquals(order);
        assert runtime.healthy();
        assert runtime.activeCapabilities().contains("foundation-ready");
        assert runtime.activeCapabilities().contains("dependent-ready");
        String report = read(directory.resolve("client-runtime.json"));
        assert report.contains("\"status\":\"ready\"");
        assert report.contains("\"id\":\"dependent\"");
        assert report.contains("\"capabilities\":[\"foundation-ready\",\"dependent-ready\"]");
        assert Files.isRegularFile(directory.resolve("client.properties"));
    }

    /**
     * The switch is the file, so the test turns it off the way a player would.
     *
     * <p>It used to call a setter that only the test called, and the module ids
     * the configuration accepted were a hand-written list beside the modules
     * themselves — so this proved that one specific hard-coded key worked, and
     * said nothing about the next module anyone added.
     */
    private static void disablesAModuleTheFileTurnsOff() throws Exception {
        Path directory = freshDirectory();
        writeSettings(directory, "module.ui", "false");

        ClientRuntime runtime = new ClientRuntime();
        runtime.register(module(
            "ui",
            false,
            Collections.<String>emptyList(),
            set("menu-theme"),
            () -> {
                throw new AssertionError("a disabled module was started");
            }
        ));
        runtime.start(context(ids("ui")));

        assert runtime.statuses().get(0).state() == ClientModuleStatus.State.DISABLED;
        assert !runtime.activeCapabilities().contains("menu-theme");
    }

    /** Running an older Kiza once must not erase what a newer one wrote. */
    private static void keepsSettingsThisBuildDoesNotUnderstand() throws Exception {
        Path directory = freshDirectory();
        writeSettings(directory, "module.ui", "false", "module.from_the_future", "true");

        // Declaring a module the file has never seen forces the rewrite.
        ClientConfig.load(ids("ui", "arrived_in_this_build"));

        String written = read(directory.resolve("client.properties"));
        assert written.contains("module.ui=false");
        assert written.contains("module.arrived_in_this_build=true");
        assert written.contains("module.from_the_future=true");
    }

    /**
     * The file used to be rewritten on every launch, timestamp and all, which
     * meant an instance folder changed underneath the player for no reason.
     */
    private static void writesTheFileOnceAndLeavesItAlone() throws Exception {
        Path directory = freshDirectory();
        Path settings = directory.resolve("client.properties");

        ClientConfig.load(ids("ui"));
        assert Files.isRegularFile(settings);
        byte[] first = Files.readAllBytes(settings);

        ClientConfig.load(ids("ui"));
        assert Arrays.equals(first, Files.readAllBytes(settings));
    }

    private static void rejectsDuplicateModuleIds() {
        ClientRuntime runtime = new ClientRuntime();
        runtime.register(module("duplicate", false, Collections.<String>emptyList(), set(), () -> {}));
        boolean rejected = false;
        try {
            runtime.register(module("duplicate", false, Collections.<String>emptyList(), set(), () -> {}));
        } catch (IllegalArgumentException expected) {
            rejected = true;
        }
        assert rejected;
    }

    private static void reportsMissingDependenciesWithoutCrashing() throws Exception {
        freshDirectory();
        ClientRuntime runtime = new ClientRuntime();
        runtime.register(module("required_module", true, Arrays.asList("missing"), set(), () -> {}));
        runtime.start(context(ids("required_module")));

        assert !runtime.healthy();
        assert runtime.statuses().get(0).state() == ClientModuleStatus.State.FAILED;
        assert runtime.statuses().get(0).detail().contains("missing");
        assert "failed".equals(runtime.state());
    }

    /**
     * The failure this runtime actually meets.
     *
     * <p>Across four loader generations a module does not throw, it fails to
     * link: a class that moved, a method whose signature changed one version
     * over. Those are {@code Error}s, and while the runtime caught only
     * {@code RuntimeException} every one of them went straight past it and
     * killed the game.
     */
    private static void aModuleThatFailsToLinkDoesNotReachTheGame() throws Exception {
        freshDirectory();
        ClientRuntime runtime = new ClientRuntime();
        runtime.register(module(
            "ui",
            false,
            Collections.<String>emptyList(),
            set("menu-theme"),
            () -> {
                throw new NoSuchMethodError("net.minecraft.class_437.render");
            }
        ));
        runtime.start(context(ids("ui")));

        ClientModuleStatus status = runtime.statuses().get(0);
        assert status.state() == ClientModuleStatus.State.FAILED;
        assert status.detail().contains("NoSuchMethodError");
        assert status.detail().contains("class_437");
        assert !runtime.activeCapabilities().contains("menu-theme");
        // Nothing required failed, so the client is worth starting: no menu
        // theme, a game that runs.
        assert "degraded".equals(runtime.state());
    }

    /**
     * A module the configuration never heard of used to be silently enabled,
     * because an unknown key fell through to the default. Now the keys come
     * from the modules, and a mismatch is one failed module rather than a
     * switch that does nothing.
     */
    private static void anUndeclaredModuleFailsInsteadOfDefaultingToOn() throws Exception {
        freshDirectory();
        ClientRuntime runtime = new ClientRuntime();
        runtime.register(module("stowaway", false, Collections.<String>emptyList(), set(), () -> {}));
        runtime.start(context(ids("something_else")));

        ClientModuleStatus status = runtime.statuses().get(0);
        assert status.state() == ClientModuleStatus.State.FAILED;
        assert status.detail().contains("not declared");
    }

    /**
     * Details are exception messages, and on Windows those are full of paths.
     * Everything outside printable ASCII used to be replaced with a question
     * mark, so a player whose folder carries an accent read their own failure
     * with the accent punched out of it.
     */
    private static void theReportKeepsCharactersOutsideAscii() throws Exception {
        Path directory = freshDirectory();
        ClientRuntime runtime = new ClientRuntime();
        runtime.register(module(
            "ui",
            false,
            Collections.<String>emptyList(),
            set(),
            () -> {
                throw new IllegalStateException("C:\\Users\\n\u00e9fer manque");
            }
        ));
        ClientRuntimeContext context = context(ids("ui"));
        runtime.start(context);
        RuntimeReportPublisher.publish(context, runtime);

        String report = read(directory.resolve("client-runtime.json"));
        assert report.contains("\\u00e9") : report;
        assert !report.contains("n?fer") : report;
        // Backslashes in the path survive as escaped backslashes, so the JSON
        // is still parseable by the launcher.
        assert report.contains("C:\\\\Users") : report;
    }

    // -- harness ---------------------------------------------------------------

    /**
     * A directory of its own per test, and the system properties repointed at
     * it. The tests used to share one folder and one settings file, so turning
     * a module off in the second test was still off in the fourth and the order
     * they ran in was part of the result.
     */
    private static Path freshDirectory() throws Exception {
        Path directory = Files.createTempDirectory("kiza-client-runtime");
        System.setProperty(
            "kiza.client.config.path",
            directory.resolve("client.properties").toString()
        );
        System.setProperty(
            "kiza.client.report.path",
            directory.resolve("client-runtime.json").toString()
        );
        return directory;
    }

    private static void writeSettings(Path directory, String... pairs) throws Exception {
        Properties values = new Properties();
        for (int index = 0; index + 1 < pairs.length; index += 2) {
            values.setProperty(pairs[index], pairs[index + 1]);
        }
        try (OutputStream output =
                 Files.newOutputStream(directory.resolve("client.properties"))) {
            values.store(output, "test");
        }
    }

    private static String read(Path path) throws Exception {
        return new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
    }

    private static Set<String> ids(String... values) {
        return new LinkedHashSet<String>(Arrays.asList(values));
    }

    private static ClientRuntimeContext context(Set<String> declaredIds) {
        return new ClientRuntimeContext(
            new ClientIdentity("1.0.0", "1.21.1", "fabric"),
            "Test",
            ClientConfig.load(declaredIds),
            new ClientEventBus()
        );
    }

    private static Set<String> set(String... values) {
        return new LinkedHashSet<String>(Arrays.asList(values));
    }

    private static ClientModule module(
        String id,
        boolean required,
        List<String> dependencies,
        Set<String> capabilities,
        Runnable start
    ) {
        return new ClientModule() {
            public String id() { return id; }
            public String name() { return id; }
            public List<String> dependencies() { return dependencies; }
            public Set<String> capabilities() { return capabilities; }
            public boolean required() { return required; }
            public void start(ClientRuntimeContext context) { start.run(); }
        };
    }
}
