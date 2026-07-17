package fr.kiza.basemod;

import java.io.IOException;
import java.util.Optional;

final class StateReporter {
    private static final long HEARTBEAT_MS = 2_000L;

    private StateReporter() {}

    static void start(StateDetector detector) {
        Optional<BridgeConfig> bridgeConfig = BridgeConfig.fromSystemProperties();
        if (bridgeConfig.isEmpty()) return;

        StateFilePublisher publisher = new StateFilePublisher(bridgeConfig.get());
        Thread reporter = new Thread(() -> reportLoop(detector, publisher), "kiza-state-reporter");
        reporter.setDaemon(true);
        reporter.start();
        Runtime.getRuntime().addShutdownHook(new Thread(publisher::close, "kiza-state-cleanup"));
    }

    private static void reportLoop(StateDetector detector, StateFilePublisher publisher) {
        while (!Thread.currentThread().isInterrupted()) {
            try {
                publisher.publish(detector.detect());
                Thread.sleep(HEARTBEAT_MS);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            } catch (IOException error) {
                System.err.println("[Kiza Base Mod] Could not publish the local player state.");
                try {
                    Thread.sleep(HEARTBEAT_MS);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
            }
        }
    }
}

