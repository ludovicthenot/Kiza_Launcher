package fr.kiza.basemod.mixin.fabric;

import fr.kiza.basemod.KizaLoading;
import java.util.function.IntSupplier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Coerce;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** The same from 26.1, where the game ships under Mojang's own names and draws through extractRenderState. */
@Mixin(targets = "net.minecraft.client.gui.screens.LoadingOverlay", remap = false)
public abstract class FabricLoadingOverlayMojmapMixin {
    @Redirect(
        method = "extractRenderState",
        at = @At(value = "INVOKE", target = "Ljava/util/function/IntSupplier;getAsInt()I"),
        require = 0,
        remap = false
    )
    private int kiza$background(IntSupplier colour) {
        return KizaLoading.background(this, colour.getAsInt());
    }

    @Inject(method = "extractRenderState", at = @At("TAIL"), require = 0, remap = false)
    private void kiza$drawn(@Coerce Object graphics, int mouseX, int mouseY, float delta, CallbackInfo callbackInfo) {
        KizaLoading.afterOverlay(this, graphics);
    }

    @Inject(method = "extractProgressBar", at = @At("HEAD"), cancellable = true, require = 0, remap = false)
    private void kiza$noBar(CallbackInfo callbackInfo) {
        if (KizaLoading.hidesProgressBar()) callbackInfo.cancel();
    }
}
