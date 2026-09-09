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
        /** 1.13+ exposes abilities through a getter... */
        private final Method getAbilities;
        /** ...and 1.7 to 1.12 as a plain field on the player. One is null. */
        private final Field abilitiesField;
        private final Field creativeMode;

        Accessors(
            Method getClient,
            Field player,
            Field level,
            Field integratedServer,
            Method getAbilities,
            Field abilitiesField,
            Field creativeMode
        ) {
            this.getClient = getClient;
            this.player = player;
            this.level = level;
            this.integratedServer = integratedServer;
            this.getAbilities = getAbilities;
            this.abilitiesField = abilitiesField;
            this.creativeMode = creativeMode;
        }

        static Accessors resolve(Class<?> clientClass) throws ReflectiveOperationException {
            Method getClient = Arrays.stream(clientClass.getDeclaredMethods())
                .filter(method -> Modifier.isStatic(method.getModifiers()))
                .filter(method -> method.getParameterCount() == 0)
                .filter(method -> clientClass.isAssignableFrom(method.getReturnType()))
                .findFirst()
                .orElseThrow(() -> new NoSuchMethodException("Minecraft singleton accessor"));
            // Two generations of names for the same three things. Forge
            // renamed them at 1.13, and a pack on 1.12 is still a pack: asking
            // only for the modern spelling is why the client reported that it
            // could not tell what anybody was doing on 1.7 through 1.12.
            Field player = fieldByType(clientClass, "LocalPlayer", "EntityPlayerSP");
            Field level = fieldByType(clientClass, "ClientLevel", "WorldClient");
            Field integratedServer = fieldByType(clientClass, "IntegratedServer");

            // Abilities are a getter on 1.13+ and a field on the player before
            // that. Whichever exists is the one used; the other stays null.
            Method getAbilities = methodReturning(player.getType(), "Abilities", "PlayerCapabilities");
            Field abilitiesField = getAbilities != null
                ? null
                : fieldByType(player.getType(), "Abilities", "PlayerCapabilities");
            Class<?> abilities = getAbilities != null
                ? getAbilities.getReturnType()
                : abilitiesField.getType();
            Field creativeMode = fieldByName(
                abilities,
                "instabuild",
                "f_35937_",
                "isCreativeMode"
            );

            getClient.setAccessible(true);
            player.setAccessible(true);
            level.setAccessible(true);
            integratedServer.setAccessible(true);
            if (getAbilities != null) getAbilities.setAccessible(true);
            if (abilitiesField != null) abilitiesField.setAccessible(true);
            creativeMode.setAccessible(true);
            return new Accessors(
                getClient,
                player,
                level,
                integratedServer,
                getAbilities,
                abilitiesField,
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

            Object abilities = getAbilities != null
                ? getAbilities.invoke(currentPlayer)
                : abilitiesField.get(currentPlayer);
            return creativeMode.getBoolean(abilities) ? PlayerState.CREATIVE : PlayerState.SURVIVAL;
        }

        private static Field fieldByType(Class<?> owner, String... simpleNames)
            throws NoSuchFieldException {
            for (String simpleName : simpleNames) {
                for (Field field : owner.getDeclaredFields()) {
                    if (field.getType().getSimpleName().equals(simpleName)) return field;
                }
            }
            throw new NoSuchFieldException(String.join("/", simpleNames));
        }

        /** A no-argument method returning one of these types, or null. */
        private static Method methodReturning(Class<?> owner, String... simpleNames) {
            for (String simpleName : simpleNames) {
                for (Method method : owner.getMethods()) {
                    if (method.getParameterCount() != 0) continue;
                    if (method.getReturnType().getSimpleName().equals(simpleName)) return method;
                }
            }
            return null;
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

