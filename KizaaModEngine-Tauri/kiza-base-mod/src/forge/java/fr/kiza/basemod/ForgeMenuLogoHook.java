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

            boolean screenReady = installFirstAvailable(
                eventBus,
                ForgeMenuLogoHook::renderScreenForeground,
                "net.minecraftforge.client.event.ScreenEvent$Render$Post",
                "net.minecraftforge.client.event.ScreenEvent$DrawScreenEvent$Post"
            );
            boolean backgroundReady = installFirstAvailable(
                eventBus,
                ForgeMenuLogoHook::renderScreenBackground,
                "net.minecraftforge.client.event.ScreenEvent$BackgroundRendered"
            );
            boolean hudReady = installFirstAvailable(
                eventBus,
                ForgeMenuLogoHook::renderHud,
                "net.minecraftforge.client.event.RenderGuiEvent$Post",
                "net.minecraftforge.client.event.RenderGuiOverlayEvent$Post",
                "net.minecraftforge.client.event.RenderGameOverlayEvent$Post"
            );

            installed = screenReady || backgroundReady || hudReady;
            if (!installed) {
                throw new ClassNotFoundException("Forge client render events");
            }
        } catch (ReflectiveOperationException | RuntimeException error) {
            System.err.println(
                "[Kiza Client/Forge] UI hooks are unavailable for this Forge version."
            );
        }
    }

    private static boolean installFirstAvailable(
        Object eventBus,
        Consumer<Object> listener,
        String... candidates
    ) throws ReflectiveOperationException {
        for (String candidate : candidates) {
            try {
                Class<?> eventType = Class.forName(candidate);
                Method addListener = findTypedListenerMethod(eventBus.getClass());
                addListener.invoke(eventBus, listenerArguments(addListener, eventType, listener));
                return true;
            } catch (ClassNotFoundException ignored) {
                // Try the event name used by the next Forge generation.
            }
        }
        return false;
    }

    private static Object[] listenerArguments(
        Method method,
        Class<?> eventType,
        Consumer<Object> listener
    ) {
        Object[] arguments = new Object[method.getParameterCount()];
        Class<?>[] parameterTypes = method.getParameterTypes();

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

    private static void renderScreenForeground(Object event) {
        Object graphics = graphicsFromEvent(event);
        if (graphics != null) MenuLogoRenderer.render(graphics, screenFromEvent(event));
    }

    private static void renderScreenBackground(Object event) {
        Object graphics = graphicsFromEvent(event);
        if (graphics != null) MenuLogoRenderer.renderBackground(graphics, screenFromEvent(event));
    }

    private static void renderHud(Object event) {
        Object graphics = graphicsFromEvent(event);
        if (graphics != null) MenuLogoRenderer.renderHud(graphics);
    }

    private static Object graphicsFromEvent(Object event) {
        return invokeFirst(event, "getGuiGraphics", "getPoseStack");
    }

    private static Object screenFromEvent(Object event) {
        return invokeFirst(event, "getScreen");
    }

    private static Object invokeFirst(Object target, String... names) {
        if (target == null) return null;
        for (String name : names) {
            try {
                Method method = target.getClass().getMethod(name);
                if (method.getParameterCount() == 0) return method.invoke(target);
            } catch (ReflectiveOperationException | RuntimeException ignored) {
                // Try the next mapped accessor.
            }
        }
        return null;
    }

    private static Object normalEnumValue(Class<?> enumType) {
        Object[] constants = enumType.getEnumConstants();
        for (Object constant : constants) {
            if (((Enum<?>) constant).name().equals("NORMAL")) return constant;
        }
        return constants[0];
    }
}
