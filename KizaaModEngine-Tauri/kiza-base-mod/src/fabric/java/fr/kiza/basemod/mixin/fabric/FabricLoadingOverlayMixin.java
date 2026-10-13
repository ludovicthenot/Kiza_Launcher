package fr.kiza.basemod.mixin.fabric;

import fr.kiza.basemod.KizaLoading;
import java.util.function.IntSupplier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Coerce;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * The loading screen, Kiza's ({@link KizaLoading}): its background colour
 * answered with Kiza's at the one place it is read -- an {@code IntSupplier},
 * which no mapping renames -- its own progress bar left undrawn, and Kiza's
 * emblem, name and progress drawn over it at the end of each frame. Its
 * logic is not touched. 1.17 to 1.21.11, under intermediary names; the
 * graphics are taken as they come, a PoseStack or a GuiGraphics.
 */
@Mixin(targets = "net.minecraft.class_425", remap = false)
public abstract class FabricLoadingOverlayMixin {
    @Redirect(
        method = "method_25394",
        at = @At(value = "INVOKE", target = "Ljava/util/function/IntSupplier;getAsInt()I"),
        require = 0,
        remap = false
    )
    private int kiza$background(IntSupplier colour) {
        return KizaLoading.background(this, colour.getAsInt());
    }

    @Inject(method = "method_25394", at = @At("TAIL"), require = 0, remap = false)
    private void kiza$drawn(@Coerce Object graphics, int mouseX, int mouseY, float delta, CallbackInfo callbackInfo) {
        KizaLoading.afterOverlay(this, graphics);
    }

    /** drawProgressBar: Kiza's line takes its place. */
    @Inject(method = "method_18103", at = @At("HEAD"), cancellable = true, require = 0, remap = false)
    private void kiza$noBar(CallbackInfo callbackInfo) {
        if (KizaLoading.hidesProgressBar()) callbackInfo.cancel();
    }
}
