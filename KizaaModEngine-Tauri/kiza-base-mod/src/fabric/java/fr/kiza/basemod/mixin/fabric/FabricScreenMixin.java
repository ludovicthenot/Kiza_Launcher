package fr.kiza.basemod.mixin.fabric;

import fr.kiza.basemod.MenuLogoRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Coerce;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(targets = "net.minecraft.class_437", remap = false)
public abstract class FabricScreenMixin {
    @Inject(method = "method_25394", at = @At("TAIL"), require = 0, remap = false)
    private void kiza$renderMenuLogo(
        @Coerce Object graphics,
        int mouseX,
        int mouseY,
        float tickDelta,
        CallbackInfo callbackInfo
    ) {
        MenuLogoRenderer.render(graphics, this);
    }
}
