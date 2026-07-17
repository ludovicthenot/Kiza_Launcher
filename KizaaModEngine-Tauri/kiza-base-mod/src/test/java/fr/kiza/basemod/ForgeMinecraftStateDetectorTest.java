package fr.kiza.basemod;

public final class ForgeMinecraftStateDetectorTest {
    public static void main(String[] args) throws Exception {
        Minecraft client = Minecraft.getInstance();
        ForgeMinecraftStateDetector.Accessors accessors =
            ForgeMinecraftStateDetector.Accessors.resolve(Minecraft.class);

        client.player = null;
        client.level = null;
        assert accessors.detect() == PlayerState.MENU;

        client.player = new LocalPlayer();
        client.level = new ClientLevel();
        client.singleplayerServer = null;
        assert accessors.detect() == PlayerState.MULTIPLAYER;

        client.singleplayerServer = new IntegratedServer();
        assert accessors.detect() == PlayerState.SURVIVAL;
        client.player.getAbilities().instabuild = true;
        assert accessors.detect() == PlayerState.CREATIVE;
        System.out.println("Kiza Forge detector tests passed");
    }

    static final class Minecraft {
        private static final Minecraft INSTANCE = new Minecraft();
        LocalPlayer player;
        ClientLevel level;
        IntegratedServer singleplayerServer;

        static Minecraft getInstance() {
            return INSTANCE;
        }
    }

    static final class LocalPlayer {
        private final Abilities abilities = new Abilities();

        public Abilities getAbilities() {
            return abilities;
        }
    }

    static final class ClientLevel {}
    static final class IntegratedServer {}

    static final class Abilities {
        boolean instabuild;
    }
}
