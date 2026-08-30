package fr.kiza.basemod;

import java.lang.reflect.Field;
import java.lang.reflect.Method;

final class FabricMinecraftStateDetector implements StateDetector {
    private Accessors accessors;
    private boolean loggedFailure;

    @Override
    public PlayerState detect() {
        try {
            if (accessors == null) accessors = Accessors.resolve();
            return accessors.detect();
        } catch (ReflectiveOperationException | RuntimeException error) {
            accessors = null;
            if (!loggedFailure) {
                loggedFailure = true;
                System.err.println("[Kiza Base Mod/Fabric] Minecraft state detection is unavailable for this version.");
            }
            return PlayerState.UNSUPPORTED;
        }
    }

    private static final class Accessors {
        private final Method getClient;
        private final Field player;
        private final Field world;
        private final Method isInSingleplayer;
        private final Method getAbilities;
        private final Field creativeMode;

        private Accessors(
            Method getClient,
            Field player,
            Field world,
            Method isInSingleplayer,
            Method getAbilities,
            Field creativeMode
        ) {
            this.getClient = getClient;
            this.player = player;
            this.world = world;
            this.isInSingleplayer = isInSingleplayer;
            this.getAbilities = getAbilities;
            this.creativeMode = creativeMode;
        }

        static Accessors resolve() throws ReflectiveOperationException {
            Object resolver = mappingResolver();
            Class<?> clientClass = Class.forName(mapClass(resolver, "net.minecraft.class_310"));
            Class<?> playerClass = Class.forName(mapClass(resolver, "net.minecraft.class_1657"));
            Class<?> abilitiesClass = Class.forName(mapClass(resolver, "net.minecraft.class_1656"));

            Method getClient = clientClass.getDeclaredMethod(mapMethod(
                resolver,
                "net.minecraft.class_310",
                "method_1551",
                "()Lnet/minecraft/class_310;"
            ));
            Field player = clientClass.getDeclaredField(mapField(
                resolver,
                "net.minecraft.class_310",
                "field_1724",
                "Lnet/minecraft/class_746;"
            ));
            Field world = clientClass.getDeclaredField(mapField(
                resolver,
                "net.minecraft.class_310",
                "field_1687",
                "Lnet/minecraft/class_638;"
            ));
            Method isInSingleplayer = clientClass.getDeclaredMethod(mapMethod(
                resolver,
                "net.minecraft.class_310",
                "method_1496",
                "()Z"
            ));
            Method getAbilities = playerClass.getMethod(mapMethod(
                resolver,
                "net.minecraft.class_1657",
                "method_31549",
                "()Lnet/minecraft/class_1656;"
            ));
            Field creativeMode = abilitiesClass.getDeclaredField(mapField(
                resolver,
                "net.minecraft.class_1656",
                "field_7477",
                "Z"
            ));

            getClient.setAccessible(true);
            player.setAccessible(true);
            world.setAccessible(true);
            isInSingleplayer.setAccessible(true);
            getAbilities.setAccessible(true);
            creativeMode.setAccessible(true);
            return new Accessors(getClient, player, world, isInSingleplayer, getAbilities, creativeMode);
        }

        PlayerState detect() throws ReflectiveOperationException {
            Object client = getClient.invoke(null);
            Object currentPlayer = client == null ? null : player.get(client);
            if (client == null || currentPlayer == null || world.get(client) == null) {
                return PlayerState.MENU;
            }
            if (!((Boolean) isInSingleplayer.invoke(client))) {
                return PlayerState.MULTIPLAYER;
            }

            Object abilities = getAbilities.invoke(currentPlayer);
            return creativeMode.getBoolean(abilities) ? PlayerState.CREATIVE : PlayerState.SURVIVAL;
        }
    }

    private static Object mappingResolver() throws ReflectiveOperationException {
        Class<?> loaderClass = Class.forName("net.fabricmc.loader.api.FabricLoader");
        Object loader = loaderClass.getMethod("getInstance").invoke(null);
        return loaderClass.getMethod("getMappingResolver").invoke(loader);
    }

    private static Method resolverMethod(String name, Class<?>... parameterTypes)
        throws ReflectiveOperationException {
        return Class.forName("net.fabricmc.loader.api.MappingResolver").getMethod(name, parameterTypes);
    }

    private static String mapClass(Object resolver, String className) throws ReflectiveOperationException {
        return (String) resolverMethod("mapClassName", String.class, String.class)
            .invoke(resolver, "intermediary", className);
    }

    private static String mapMethod(Object resolver, String owner, String name, String descriptor)
        throws ReflectiveOperationException {
        return (String) resolverMethod(
            "mapMethodName",
            String.class,
            String.class,
            String.class,
            String.class
        ).invoke(resolver, "intermediary", owner, name, descriptor);
    }

    private static String mapField(Object resolver, String owner, String name, String descriptor)
        throws ReflectiveOperationException {
        return (String) resolverMethod(
            "mapFieldName",
            String.class,
            String.class,
            String.class,
            String.class
        ).invoke(resolver, "intermediary", owner, name, descriptor);
    }
}
