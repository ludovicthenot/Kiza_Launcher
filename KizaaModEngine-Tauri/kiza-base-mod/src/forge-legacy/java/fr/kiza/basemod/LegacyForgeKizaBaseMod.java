package fr.kiza.basemod;

import java.lang.reflect.Method;
import net.minecraftforge.client.event.GuiScreenEvent;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent;

/**
 * Entry point for Minecraft 1.7-1.12 Forge, which predates mods.toml and the
 * typed event-listener API.
 *
 * <p>These versions only get the Kiza branding: the corner logo and the legal
 * line. The full client menu is not drawn here — its layout was built and
 * tested against the modern screens, and there is no vanilla button geometry to
 * read on these versions.
 */
@Mod(modid = "kiza_base_mod", name = "Kiza Base Mod", version = "1.3.3", clientSideOnly = true)
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
            System.err.println(
                "[Kiza Client/Forge] Legacy UI hooks are unavailable for this Forge version."
            );
        }
    }

    @SubscribeEvent
    public void onDrawScreen(GuiScreenEvent.DrawScreenEvent.Post event) {
        Object screen = screenFromEvent(event);
        // Immediate mode: there is no graphics object before 1.13, so the
        // screen is both the receiver and the drawing context.
        if (screen != null) MenuLogoRenderer.renderBrandOnly(screen, screen);
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
