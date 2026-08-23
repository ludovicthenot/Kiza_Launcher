package fr.kiza.basemod;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.Arrays;

public final class WindowTitleManager {
    private static final long UPDATE_INTERVAL_MS = 2_000L;
    private static long lastUpdateAt;
    private static boolean unavailable;

    private WindowTitleManager() {}

    static void update() {
        if (unavailable) return;
        long now = System.currentTimeMillis();
        if (now - lastUpdateAt < UPDATE_INTERVAL_MS) return;
        lastUpdateAt = now;

        try {
            Object minecraft = minecraftInstance();
            Object window = minecraftWindow(minecraft);
            long handle = windowHandle(window);
            Method setTitle = Class.forName("org.lwjgl.glfw.GLFW")
                .getMethod("glfwSetWindowTitle", long.class, CharSequence.class);
            setTitle.invoke(null, handle, KizaClientManager.identity().windowTitle());
        } catch (ReflectiveOperationException | RuntimeException error) {
            unavailable = true;
            System.err.println(
                "[Kiza Client] Window title integration is unavailable for this Minecraft version."
            );
        }
    }

    public static long currentHandle() throws ReflectiveOperationException {
        return windowHandle(minecraftWindow(minecraftInstance()));
    }

    public static Object minecraftInstance() throws ReflectiveOperationException {
        Class<?> minecraftType = firstAvailableClass(
            "net.minecraft.client.Minecraft",
            "net.minecraft.class_310"
        );
        Method getter = Arrays.stream(minecraftType.getDeclaredMethods())
            .filter(method -> Modifier.isStatic(method.getModifiers()))
            .filter(method -> method.getParameterCount() == 0)
            .filter(method -> minecraftType.isAssignableFrom(method.getReturnType()))
            .findFirst()
            .orElseThrow(() -> new NoSuchMethodException("Minecraft client singleton"));
        getter.setAccessible(true);
        return getter.invoke(null);
    }

    private static Object minecraftWindow(Object minecraft) throws ReflectiveOperationException {
        for (Method method : minecraft.getClass().getMethods()) {
            if (method.getParameterCount() != 0 || method.getReturnType().isPrimitive()) continue;
            if (method.getName().equals("getWindow") || method.getName().equals("method_22683")) {
                return method.invoke(minecraft);
            }
        }
        for (Class<?> type = minecraft.getClass(); type != null; type = type.getSuperclass()) {
            for (Field field : type.getDeclaredFields()) {
                if (field.getType().getName().toLowerCase().contains("window")) {
                    field.setAccessible(true);
                    Object value = field.get(minecraft);
                    if (value != null) return value;
                }
            }
        }
        throw new NoSuchMethodException("Minecraft window");
    }

    private static long windowHandle(Object window) throws ReflectiveOperationException {
        // Resolve the GLFW handle by its known name. getMethods() order is
        // unspecified, and any other no-arg long getter (there are several on
        // Window) would return a non-handle value that crashes native GLFW.
        for (String name : new String[] {"method_4490", "getWindow", "m_85439_"}) {
            try {
                Method method = window.getClass().getMethod(name);
                if (method.getParameterCount() == 0 && method.getReturnType() == long.class) {
                    long handle = (long) method.invoke(window);
                    if (handle != 0L) return handle;
                }
            } catch (NoSuchMethodException ignored) {
                // Try the next mapping.
            }
        }
        throw new NoSuchMethodException("Minecraft window handle");
    }

    private static Class<?> firstAvailableClass(String... candidates)
        throws ClassNotFoundException {
        for (String candidate : candidates) {
            try {
                return Class.forName(candidate);
            } catch (ClassNotFoundException ignored) {
                // Try the mapping used by the next loader.
            }
        }
        throw new ClassNotFoundException(String.join("/", candidates));
    }
}
