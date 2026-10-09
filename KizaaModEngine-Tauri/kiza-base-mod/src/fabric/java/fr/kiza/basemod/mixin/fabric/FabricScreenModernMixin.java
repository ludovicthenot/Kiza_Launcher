package fr.kiza.basemod.mixin.fabric;

import fr.kiza.basemod.FabricMenu;
import net.minecraft.class_332;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(targets = "net.minecraft.class_437", remap = false)
public abstract class FabricScreenModernMixin {
    @Inject(method = "method_25394", at = @At("HEAD"), require = 0, remap = false)
    private void kiza$renderMenuBackground(
        class_332 graphics,
        int mouseX,
        int mouseY,
        float tickDelta,
        CallbackInfo callbackInfo
    ) {
        FabricMenu.renderBackground(graphics, this);
    }

    /** 1.20.2 and later: the background takes the pointer and the frame time. */
    @Inject(method = "method_25420(Lnet/minecraft/class_332;IIF)V", at = @At("TAIL"), require = 0, remap = false)
    private void kiza$afterBackground(
        class_332 graphics,
        int mouseX,
        int mouseY,
        float tickDelta,
        CallbackInfo callbackInfo
    ) {
        FabricMenu.afterBackground(graphics, this);
    }

    /** 1.20 and 1.20.1: the background takes the graphics alone. */
    @Inject(method = "method_25420(Lnet/minecraft/class_332;)V", at = @At("TAIL"), require = 0, remap = false)
    private void kiza$afterBackgroundOld(class_332 graphics, CallbackInfo callbackInfo) {
        FabricMenu.afterBackground(graphics, this);
    }

    @Inject(method = "method_25394", at = @At("TAIL"), require = 0, remap = false)
    private void kiza$renderMenuForeground(
        class_332 graphics,
        int mouseX,
        int mouseY,
        float tickDelta,
        CallbackInfo callbackInfo
    ) {
        FabricMenu.renderScreen(graphics, this, mouseX, mouseY);
    }
}
