package fr.kiza.basemod.mixin.forge;

import fr.kiza.basemod.KizaLoading;
import net.minecraft.client.gui.GuiGraphics;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Forge's own loading screen, where it draws one in place of Mojang's: its
 * early window, shown again inside the game. It asks no colour, so Kiza's
 * background is laid over it, going with its fade, and the rest drawn on
 * that ({@link KizaLoading#overLoaderScreen}). Where Forge leaves the
 * drawing to Mojang's screen, as from 1.21.11, nothing here is found and
 * {@link ForgeLoadingOverlayMixin} does it.
 */
@Mixin(targets = "net.minecraftforge.client.loading.ForgeLoadingOverlay", remap = false)
public abstract class ForgeEarlyLoadingOverlayMixin {
    @Inject(
        method = {"m_88315_(Lnet/minecraft/client/gui/GuiGraphics;IIF)V", "render(Lnet/minecraft/client/gui/GuiGraphics;IIF)V"},
        at = @At("RETURN"),
        require = 0,
        remap = false
    )
    private void kiza$drawn(GuiGraphics graphics, int mouseX, int mouseY, float delta, CallbackInfo callbackInfo) {
        KizaLoading.overLoaderScreen(this, graphics);
    }
}
