package fr.kiza.basemod.mixin.fabric;

import fr.kiza.basemod.MenuLogoRenderer;
import net.minecraft.class_332;
import net.minecraft.class_9779;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(targets = "net.minecraft.class_329", remap = false)
public abstract class FabricHudModernMixin {
    @Inject(method = "method_1753", at = @At("TAIL"), require = 0, remap = false)
    private void kiza$renderHud(
        class_332 graphics,
        class_9779 tickCounter,
        CallbackInfo callbackInfo
    ) {
        MenuLogoRenderer.renderHud(graphics);
    }
}
