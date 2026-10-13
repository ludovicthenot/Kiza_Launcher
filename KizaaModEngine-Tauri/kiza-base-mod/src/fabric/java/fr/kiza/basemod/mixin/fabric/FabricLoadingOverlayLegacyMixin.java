package fr.kiza.basemod.mixin.fabric;

import fr.kiza.basemod.KizaLoading;
import java.util.function.IntSupplier;
import net.minecraft.class_4587;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** The same before 1.20, where the screen draws through a PoseStack. */
@Mixin(targets = "net.minecraft.class_425", remap = false)
public abstract class FabricLoadingOverlayLegacyMixin {
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
    private void kiza$drawn(class_4587 graphics, int mouseX, int mouseY, float delta, CallbackInfo callbackInfo) {
        KizaLoading.afterOverlay(this, graphics);
    }

    /** drawProgressBar: Kiza's line takes its place. */
    @Inject(method = "method_18103", at = @At("HEAD"), cancellable = true, require = 0, remap = false)
    private void kiza$noBar(CallbackInfo callbackInfo) {
        if (KizaLoading.hidesProgressBar()) callbackInfo.cancel();
    }
}
