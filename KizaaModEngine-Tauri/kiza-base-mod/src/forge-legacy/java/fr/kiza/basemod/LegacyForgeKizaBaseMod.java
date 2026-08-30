package fr.kiza.basemod;

import java.lang.reflect.Method;
import net.minecraftforge.client.event.GuiScreenEvent;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent;

/**
 * Entry point for Minecraft 1.7-1.12 Forge, which predates mods.toml and the
 * typed event-listener API.
 *
 * <p>The shared renderer reads legacy GuiButton fields reflectively, so these
 * versions receive the same Minecraft-first menu and Kiza launcher footer as
 * modern Forge while preserving native input handling.
 */
@Mod(modid = "kiza_base_mod", name = "Kiza Client Runtime", version = "1.3.4", clientSideOnly = true)
public final class LegacyForgeKizaBaseMod {
    public LegacyForgeKizaBaseMod() {
        KizaClientManager.initialize(
            "Forge",
            new ForgeMinecraftStateDetector(),
            this::registerOnEventBus
        );
    }

    /**
     * Pre-1.13 has no {@code addListener(Class, Consumer)}: the bus scans an
     * object for @SubscribeEvent methods. The bus itself is reached
     * reflectively so no field descriptor has to match at compile time.
     */
    private void registerOnEventBus() {
        try {
            Class<?> forge = Class.forName("net.minecraftforge.common.MinecraftForge");
            Object eventBus = forge.getField("EVENT_BUS").get(null);
            eventBus.getClass().getMethod("register", Object.class).invoke(eventBus, this);
        } catch (ReflectiveOperationException | RuntimeException error) {
            throw new IllegalStateException(
                "The legacy Forge event bus is unavailable on this version.",
                error
            );
        }
    }

    @SubscribeEvent
    public void onDrawScreen(GuiScreenEvent.DrawScreenEvent.Post event) {
        Object screen = screenFromEvent(event);
        // Immediate mode: there is no graphics object before 1.13, so the
        // screen is both the receiver and the drawing context.
        if (screen != null) {
            MenuLogoRenderer.render(
                screen,
                screen,
                intFromEvent(event, "getMouseX"),
                intFromEvent(event, "getMouseY")
            );
        }
    }

    private static int intFromEvent(Object event, String name) {
        try {
            Method method = event.getClass().getMethod(name);
            Object value = method.invoke(event);
            return value instanceof Number ? ((Number) value).intValue() : -1;
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            return -1;
        }
    }

    private static Object screenFromEvent(Object event) {
        for (String name : new String[] {"getGui", "func_189275_a"}) {
            try {
                Method method = event.getClass().getMethod(name);
                if (method.getParameterCount() == 0) return method.invoke(event);
            } catch (ReflectiveOperationException | RuntimeException ignored) {
                // Try the next mapped accessor.
            }
        }
        return null;
    }
}
