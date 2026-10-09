package fr.kiza.basemod.mixin.fabric;

import fr.kiza.basemod.FabricMenu;
import net.minecraft.class_4587;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(targets = "net.minecraft.class_437", remap = false)
public abstract class FabricScreenLegacyMixin {
    @Inject(method = "method_25394", at = @At("HEAD"), require = 0, remap = false)
    private void kiza$renderMenuBackground(
        class_4587 graphics,
        int mouseX,
        int mouseY,
        float tickDelta,
        CallbackInfo callbackInfo
    ) {
        FabricMenu.renderBackground(graphics, this);
    }

    /** 1.16 to 1.19: the background is drawn through a matrix stack. */
    @Inject(method = "method_25420(Lnet/minecraft/class_4587;)V", at = @At("TAIL"), require = 0, remap = false)
    private void kiza$afterBackground(class_4587 graphics, CallbackInfo callbackInfo) {
        FabricMenu.afterBackground(graphics, this);
    }

    @Inject(method = "method_25394", at = @At("TAIL"), require = 0, remap = false)
    private void kiza$renderMenuForeground(
        class_4587 graphics,
        int mouseX,
        int mouseY,
        float tickDelta,
        CallbackInfo callbackInfo
    ) {
        FabricMenu.renderScreen(graphics, this, mouseX, mouseY);
    }
}
