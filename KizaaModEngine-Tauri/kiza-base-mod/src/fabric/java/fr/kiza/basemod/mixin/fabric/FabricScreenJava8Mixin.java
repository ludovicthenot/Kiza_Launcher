package fr.kiza.basemod.mixin.fabric;

import fr.kiza.basemod.MenuLogoRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Minecraft 1.14-1.15 screen hook, before MatrixStack was introduced. */
@Mixin(targets = "net.minecraft.class_437", remap = false)
public abstract class FabricScreenJava8Mixin {
    @Inject(method = {"render", "method_25394"}, at = @At("HEAD"), require = 0, remap = false)
    private void kiza$renderMenuBackground(
        int mouseX,
        int mouseY,
        float tickDelta,
        CallbackInfo callbackInfo
    ) {
        MenuLogoRenderer.renderBackground(this, this);
    }

    @Inject(method = {"render", "method_25394"}, at = @At("TAIL"), require = 0, remap = false)
    private void kiza$renderMenuForeground(
        int mouseX,
        int mouseY,
        float tickDelta,
        CallbackInfo callbackInfo
    ) {
        MenuLogoRenderer.render(this, this, mouseX, mouseY);
    }
}
