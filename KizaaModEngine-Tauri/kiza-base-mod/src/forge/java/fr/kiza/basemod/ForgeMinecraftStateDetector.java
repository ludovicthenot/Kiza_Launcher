package fr.kiza.basemod;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.Arrays;

final class ForgeMinecraftStateDetector implements StateDetector {
    private Accessors accessors;
    private boolean loggedFailure;

    @Override
    public PlayerState detect() {
        try {
            if (accessors == null) {
                accessors = Accessors.resolve(Class.forName("net.minecraft.client.Minecraft"));
            }
            return accessors.detect();
        } catch (ReflectiveOperationException | RuntimeException error) {
            accessors = null;
            if (!loggedFailure) {
                loggedFailure = true;
                System.err.println("[Kiza Base Mod/Forge] Minecraft state detection is unsupported for this Forge version.");
            }
            return PlayerState.UNSUPPORTED;
        }
    }

    static final class Accessors {
        private final Method getClient;
        private final Field player;
        private final Field level;
        private final Field integratedServer;
        private final Method getAbilities;
        private final Field creativeMode;

        Accessors(
            Method getClient,
            Field player,
            Field level,
            Field integratedServer,
            Method getAbilities,
            Field creativeMode
        ) {
            this.getClient = getClient;
            this.player = player;
            this.level = level;
            this.integratedServer = integratedServer;
            this.getAbilities = getAbilities;
            this.creativeMode = creativeMode;
        }

        static Accessors resolve(Class<?> clientClass) throws ReflectiveOperationException {
            Method getClient = Arrays.stream(clientClass.getDeclaredMethods())
                .filter(method -> Modifier.isStatic(method.getModifiers()))
                .filter(method -> method.getParameterCount() == 0)
                .filter(method -> clientClass.isAssignableFrom(method.getReturnType()))
                .findFirst()
                .orElseThrow(() -> new NoSuchMethodException("Minecraft singleton accessor"));
            Field player = fieldByType(clientClass, "LocalPlayer");
            Field level = fieldByType(clientClass, "ClientLevel");
            Field integratedServer = fieldByType(clientClass, "IntegratedServer");
            Method getAbilities = Arrays.stream(player.getType().getMethods())
                .filter(method -> method.getParameterCount() == 0)
                .filter(method -> method.getReturnType().getSimpleName().equals("Abilities"))
                .findFirst()
                .orElseThrow(() -> new NoSuchMethodException("Player abilities accessor"));
            Field creativeMode = fieldByName(
                getAbilities.getReturnType(),
                "instabuild",
                "f_35937_"
            );

            getClient.setAccessible(true);
            player.setAccessible(true);
            level.setAccessible(true);
            integratedServer.setAccessible(true);
            getAbilities.setAccessible(true);
            creativeMode.setAccessible(true);
            return new Accessors(
                getClient,
                player,
                level,
                integratedServer,
                getAbilities,
                creativeMode
            );
        }

        PlayerState detect() throws ReflectiveOperationException {
            Object client = getClient.invoke(null);
            Object currentPlayer = client == null ? null : player.get(client);
            if (client == null || currentPlayer == null || level.get(client) == null) {
                return PlayerState.MENU;
            }
            if (integratedServer.get(client) == null) {
                return PlayerState.MULTIPLAYER;
            }

            Object abilities = getAbilities.invoke(currentPlayer);
            return creativeMode.getBoolean(abilities) ? PlayerState.CREATIVE : PlayerState.SURVIVAL;
        }

        private static Field fieldByType(Class<?> owner, String simpleName)
            throws NoSuchFieldException {
            return Arrays.stream(owner.getDeclaredFields())
                .filter(field -> field.getType().getSimpleName().equals(simpleName))
                .findFirst()
                .orElseThrow(() -> new NoSuchFieldException(simpleName));
        }

        private static Field fieldByName(Class<?> owner, String... candidates)
            throws NoSuchFieldException {
            for (String candidate : candidates) {
                try {
                    return owner.getDeclaredField(candidate);
                } catch (NoSuchFieldException ignored) {
                    // Try the stable SRG name after the development/Mojmap name.
                }
            }
            throw new NoSuchFieldException(String.join("/", candidates));
        }
    }
}

