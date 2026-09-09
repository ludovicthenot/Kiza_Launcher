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

        theSameThingOnOldForge();
        System.out.println("Kiza Forge detector tests passed");
    }

    /**
     * Forge as it was from 1.7 to 1.12, which is what a pack like RLCraft
     * still runs on.
     *
     * <p>The names are different -- EntityPlayerSP, WorldClient -- and
     * abilities are a field on the player rather than a getter. Asking only
     * for the modern spelling meant the resolver threw on the first lookup and
     * the client reported that it could not tell what anybody was doing, which
     * reached their friends on Discord as "Minecraft state unavailable".
     */
    private static void theSameThingOnOldForge() throws Exception {
        LegacyMinecraft client = LegacyMinecraft.getMinecraft();
        ForgeMinecraftStateDetector.Accessors accessors =
            ForgeMinecraftStateDetector.Accessors.resolve(LegacyMinecraft.class);

        client.thePlayer = null;
        client.theWorld = null;
        assert accessors.detect() == PlayerState.MENU : "no world is the menu";

        client.thePlayer = new EntityPlayerSP();
        client.theWorld = new WorldClient();
        client.integratedServer = null;
        assert accessors.detect() == PlayerState.MULTIPLAYER : "no local server is a server";

        client.integratedServer = new IntegratedServer();
        assert accessors.detect() == PlayerState.SURVIVAL;
        client.thePlayer.capabilities.isCreativeMode = true;
        assert accessors.detect() == PlayerState.CREATIVE;
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

    /* ------------------------------------------------- Forge 1.7 to 1.12 -- */

    static final class LegacyMinecraft {
        private static final LegacyMinecraft INSTANCE = new LegacyMinecraft();
        EntityPlayerSP thePlayer;
        WorldClient theWorld;
        IntegratedServer integratedServer;

        static LegacyMinecraft getMinecraft() {
            return INSTANCE;
        }
    }

    /** Abilities hang off the player as a field here, with no accessor. */
    static final class EntityPlayerSP {
        final PlayerCapabilities capabilities = new PlayerCapabilities();
    }

    static final class WorldClient {}

    static final class PlayerCapabilities {
        boolean isCreativeMode;
    }
}
