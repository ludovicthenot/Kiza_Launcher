package fr.kiza.basemod;

import java.nio.file.Files;
import java.nio.file.Path;

public final class StateFilePublisherTest {
    public static void main(String[] args) throws Exception {
        Path directory = Files.createTempDirectory("kiza-base-mod-test");
        Path statePath = directory.resolve("player-state.json");
        BridgeConfig config = new BridgeConfig(
            statePath,
            "0123456789abcdef0123456789abcdef",
            "12345678-1234-1234-1234-123456789abc"
        );

        try (StateFilePublisher publisher = new StateFilePublisher(config)) {
            publisher.publish(PlayerState.CREATIVE);
            String json = Files.readString(statePath);
            assert json.contains("\"schema_version\":1");
            assert json.contains("\"state\":\"creative\"");
            assert json.contains("\"sequence\":1");
            assert json.contains(config.token());

            publisher.publish(PlayerState.MULTIPLAYER);
            String second = Files.readString(statePath);
            assert second.contains("\"state\":\"multiplayer\"");
            assert second.contains("\"sequence\":2");
        }

        assert !Files.exists(statePath);
        System.out.println("Kiza base mod tests passed");
    }
}
