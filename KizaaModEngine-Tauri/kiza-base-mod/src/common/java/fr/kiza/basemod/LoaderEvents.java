package fr.kiza.basemod;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.function.Consumer;

/**
 * Hooks the Kiza menu onto an event bus of the Forge family.
 *
 * <p>Forge and NeoForge draw their screens the same way and announce it the
 * same way -- a render event after the screen, one after its background, one
 * after the HUD, one to add lines to F3 -- and differ in the package those
 * events live in. So the wiring is written once here and each loader names its
 * own classes: {@code ForgeMenu} the {@code net.minecraftforge} ones,
 * {@code NeoForgeMenu} the {@code net.neoforged} ones.
 *
 * <p>Everything is by reflection, so one jar serves every version of its
 * loader: each event is a list of names, oldest last, and the first that
 * exists is the one listened to.
 */
final class LoaderEvents {
    /** The names one loader uses, each list newest first. */
    static final class Names {
        final String platform;
        final String busOwner;
        final String busField;
        final String[] screen;
        final String[] background;
        final String[] hud;
        final String[] debugText;

        Names(
            String platform,
            String busOwner,
            String busField,
            String[] screen,
            String[] background,
            String[] hud,
            String[] debugText
        ) {
            this.platform = platform;
            this.busOwner = busOwner;
            this.busField = busField;
            this.screen = screen;
            this.background = background;
            this.hud = hud;
            this.debugText = debugText;
        }
    }

    private LoaderEvents() {}

    /**
     * Listens to the loader's render events, or throws so the runtime records
     * the menu as a module this version never received.
     */
    static void install(Names names) {
        try {
            Class<?> owner = Class.forName(names.busOwner);
            Field busField = owner.getField(names.busField);
            Object eventBus = busField.get(null);

            boolean screenReady = installFirstAvailable(eventBus, LoaderEvents::renderScreenForeground, names.screen);
            boolean backgroundReady = installFirstAvailable(eventBus, LoaderEvents::renderScreenBackground, names.background);
            boolean hudReady = installFirstAvailable(eventBus, LoaderEvents::renderHud, names.hud);
            // Best-effort: the F3 line is a nicety, never a reason to fail.
            installFirstAvailable(eventBus, LoaderEvents::addDebugLine, names.debugText);

            if (!screenReady && !backgroundReady && !hudReady) {
                throw new ClassNotFoundException(names.platform + " client render events");
            }
        } catch (ReflectiveOperationException | RuntimeException error) {
            // Thrown on, not printed and forgotten. The runtime turns it into a
            // failed `ui` module, which is how the launcher stops listing a menu
            // theme that this version never received.
            throw new IllegalStateException(
                names.platform + " client render events are unavailable on this version.",
                error
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
                if (listenOnEventsOwnBus(eventType, listener)) return true;
                Method addListener = findTypedListenerMethod(eventBus.getClass());
                addListener.invoke(eventBus, listenerArguments(addListener, eventType, listener));
                return true;
            } catch (ClassNotFoundException ignored) {
                // Try the event name used by the next generation.
            }
        }
        return false;
    }

    /**
     * Forge from 1.21.6 (EventBus 7): every event is its own bus.
     *
     * <p>{@code ScreenEvent.Render.Post.BUS.addListener(consumer)} replaced
     * {@code MinecraftForge.EVENT_BUS.addListener(type, consumer)}, and the
     * old field survives as a migration helper that no longer takes a typed
     * listener -- so asking it was what left the menu unbuilt on 1.21.11. The
     * event's own {@code BUS}, where it has one, is asked first.
     */
    private static boolean listenOnEventsOwnBus(Class<?> eventType, Consumer<Object> listener) {
        try {
            Field busField = eventType.getField("BUS");
            if (!java.lang.reflect.Modifier.isStatic(busField.getModifiers())) return false;
            Object bus = busField.get(null);
            if (bus == null) return false;
            for (Method method : bus.getClass().getMethods()) {
                if (!method.getName().equals("addListener") || method.getParameterCount() != 1) continue;
                if (!Consumer.class.isAssignableFrom(method.getParameterTypes()[0])) continue;
                method.setAccessible(true);
                method.invoke(bus, listener);
                return true;
            }
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            // No bus of its own: the loader's shared bus is asked instead.
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
            else throw new IllegalArgumentException("Unsupported listener parameter");
        }
        return arguments;
    }

    private static Method findTypedListenerMethod(Class<?> eventBusType)
        throws NoSuchMethodException {
        Method[] methods = eventBusType.getMethods();
        Method best = null;
        for (Method method : methods) {
            if (!method.getName().equals("addListener")) continue;
            if (!Arrays.asList(method.getParameterTypes()).contains(Class.class)) continue;
            boolean takesConsumer = false;
            for (Class<?> type : method.getParameterTypes()) {
                if (Consumer.class.isAssignableFrom(type)) takesConsumer = true;
            }
            if (!takesConsumer) continue;
            if (best == null || method.getParameterCount() < best.getParameterCount()) best = method;
        }
        if (best == null) throw new NoSuchMethodException("Typed event listener");
        return best;
    }

    private static void renderScreenForeground(Object event) {
        Object screen = screenFromEvent(event);
        Object graphics = graphicsFromEvent(event);
        if (graphics == null) graphics = screen;
        if (graphics == null || screen == null) return;
        MenuLogoRenderer.render(
            graphics,
            screen,
            intFromEvent(event, "getMouseX"),
            intFromEvent(event, "getMouseY")
        );
    }

    /** Mouse position, so hover states match what Fabric's mixins provide. */
    private static int intFromEvent(Object event, String name) {
        Object value = invokeFirst(event, name);
        return value instanceof Number ? ((Number) value).intValue() : -1;
    }

    private static void renderScreenBackground(Object event) {
        Object screen = screenFromEvent(event);
        Object graphics = graphicsFromEvent(event);
        if (graphics == null) graphics = screen;
        if (graphics != null && screen != null) {
            MenuLogoRenderer.renderBackground(graphics, screen);
        }
    }

    /** Appends the client line to the F3 overlay's left column. */
    private static void addDebugLine(Object event) {
        Object left = invokeFirst(event, "getLeft");
        // EventBus 7 posts each side on its own: one list, and which side it is.
        if (left == null) {
            Object side = invokeFirst(event, "getSide");
            if (side != null && !String.valueOf(side).equalsIgnoreCase("LEFT")) return;
            left = invokeFirst(event, "getText");
        }
        if (!(left instanceof java.util.List)) return;
        try {
            @SuppressWarnings("unchecked")
            java.util.List<String> lines = (java.util.List<String>) left;
            lines.add(KizaClientManager.debugLabel());
        } catch (RuntimeException ignored) {
            // Immutable list on this version; leave the overlay alone.
        }
    }

    private static void renderHud(Object event) {
        Object graphics = graphicsFromEvent(event);
        if (graphics != null) MenuLogoRenderer.renderHud(graphics);
    }

    private static Object graphicsFromEvent(Object event) {
        // getMatrixStack is the 1.17 name for what later became getPoseStack.
        return invokeFirst(event, "getGuiGraphics", "getPoseStack", "getMatrixStack");
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
