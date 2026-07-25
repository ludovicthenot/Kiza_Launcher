package fr.kiza.basemod;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.Comparator;
import java.util.function.Consumer;

final class ForgeMenuLogoHook {
    private static boolean installed;

    private ForgeMenuLogoHook() {}

    static void install() {
        if (installed) return;

        try {
            Class<?> minecraftForge = Class.forName("net.minecraftforge.common.MinecraftForge");
            Field eventBusField = minecraftForge.getField("EVENT_BUS");
            Object eventBus = eventBusField.get(null);
            Class<?> eventType = firstAvailableClass(
                "net.minecraftforge.client.event.ScreenEvent$Render$Post",
                "net.minecraftforge.client.event.ScreenEvent$DrawScreenEvent$Post"
            );
            Method addListener = findTypedListenerMethod(eventBus.getClass());
            addListener.invoke(eventBus, listenerArguments(addListener, eventType));
            installed = true;
        } catch (ReflectiveOperationException | RuntimeException error) {
            System.err.println(
                "[Kiza Base Mod/Forge] The menu logo hook is unavailable for this Forge version."
            );
        }
    }

    private static Object[] listenerArguments(Method method, Class<?> eventType) {
        Object[] arguments = new Object[method.getParameterCount()];
        Class<?>[] parameterTypes = method.getParameterTypes();
        Consumer<Object> listener = ForgeMenuLogoHook::renderFromEvent;

        for (int index = 0; index < parameterTypes.length; index += 1) {
            Class<?> parameterType = parameterTypes[index];
            if (parameterType == Class.class) arguments[index] = eventType;
            else if (Consumer.class.isAssignableFrom(parameterType)) arguments[index] = listener;
            else if (parameterType == boolean.class) arguments[index] = false;
            else if (parameterType.isEnum()) arguments[index] = normalEnumValue(parameterType);
            else throw new IllegalArgumentException("Unsupported Forge listener parameter");
        }
        return arguments;
    }

    private static Method findTypedListenerMethod(Class<?> eventBusType)
        throws NoSuchMethodException {
        return Arrays.stream(eventBusType.getMethods())
            .filter(method -> method.getName().equals("addListener"))
            .filter(method -> Arrays.asList(method.getParameterTypes()).contains(Class.class))
            .filter(method -> Arrays.stream(method.getParameterTypes())
                .anyMatch(Consumer.class::isAssignableFrom))
            .sorted(Comparator.comparingInt(Method::getParameterCount))
            .findFirst()
            .orElseThrow(() -> new NoSuchMethodException("Forge typed event listener"));
    }

    private static void renderFromEvent(Object event) {
        try {
            Method graphicsAccessor = Arrays.stream(event.getClass().getMethods())
                .filter(method -> method.getParameterCount() == 0)
                .filter(method -> method.getName().equals("getGuiGraphics")
                    || method.getName().equals("getPoseStack"))
                .findFirst()
                .orElseThrow(() -> new NoSuchMethodException("Forge screen graphics accessor"));
            Object screen = Arrays.stream(event.getClass().getMethods())
                .filter(method -> method.getParameterCount() == 0)
                .filter(method -> method.getName().equals("getScreen"))
                .findFirst()
                .map(method -> invokeQuietly(method, event))
                .orElse(null);
            MenuLogoRenderer.render(graphicsAccessor.invoke(event), screen);
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            // Rendering is decorative and must never interrupt the game UI.
        }
    }

    private static Object invokeQuietly(Method method, Object target) {
        try {
            return method.invoke(target);
        } catch (ReflectiveOperationException | RuntimeException error) {
            return null;
        }
    }

    private static Class<?> firstAvailableClass(String... candidates)
        throws ClassNotFoundException {
        for (String candidate : candidates) {
            try {
                return Class.forName(candidate);
            } catch (ClassNotFoundException ignored) {
                // Try the event name used by the next Forge generation.
            }
        }
        throw new ClassNotFoundException(String.join("/", candidates));
    }

    private static Object normalEnumValue(Class<?> enumType) {
        Object[] constants = enumType.getEnumConstants();
        for (Object constant : constants) {
            if (((Enum<?>) constant).name().equals("NORMAL")) return constant;
        }
        return constants[0];
    }
}
