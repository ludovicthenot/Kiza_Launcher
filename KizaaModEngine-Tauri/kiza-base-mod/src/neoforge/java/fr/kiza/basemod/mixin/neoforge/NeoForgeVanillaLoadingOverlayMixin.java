package fr.kiza.basemod.mixin.neoforge;

import fr.kiza.basemod.KizaLoading;
import java.util.function.IntSupplier;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Mojang's loading screen under NeoForge, which shows it when resources are
 * reloaded once the game is running: Kiza's, as on Fabric ({@link KizaLoading}).
 */
@Mixin(targets = "net.minecraft.client.gui.screens.LoadingOverlay", remap = false)
public abstract class NeoForgeVanillaLoadingOverlayMixin {
    @Redirect(
        method = {
            "render(Lnet/minecraft/client/gui/GuiGraphics;IIF)V",
            "extractRenderState(Lnet/minecraft/client/gui/GuiGraphicsExtractor;IIF)V"
        },
        at = @At(value = "INVOKE", target = "Ljava/util/function/IntSupplier;getAsInt()I"),
        require = 0,
        remap = false
    )
    private int kiza$background(IntSupplier colour) {
        return KizaLoading.background(this, colour.getAsInt());
    }

    @Inject(method = "render(Lnet/minecraft/client/gui/GuiGraphics;IIF)V", at = @At("TAIL"), require = 0, remap = false)
    private void kiza$drawn(GuiGraphics graphics, int mouseX, int mouseY, float delta, CallbackInfo callbackInfo) {
        KizaLoading.afterOverlay(this, graphics);
    }

    @Inject(
        method = "extractRenderState(Lnet/minecraft/client/gui/GuiGraphicsExtractor;IIF)V",
        at = @At("TAIL"),
        require = 0,
        remap = false
    )
    private void kiza$extracted(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta, CallbackInfo callbackInfo) {
        KizaLoading.afterOverlay(this, graphics);
    }

    @Inject(method = {"drawProgressBar", "extractProgressBar"}, at = @At("HEAD"), cancellable = true, require = 0, remap = false)
    private void kiza$noBar(CallbackInfo callbackInfo) {
        if (KizaLoading.hidesProgressBar()) callbackInfo.cancel();
    }
}
