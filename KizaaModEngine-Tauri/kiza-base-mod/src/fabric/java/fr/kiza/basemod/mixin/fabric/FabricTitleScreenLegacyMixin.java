package fr.kiza.basemod.mixin.fabric;

import fr.kiza.basemod.MenuLogoRenderer;
import net.minecraft.class_4587;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(targets = "net.minecraft.class_442", remap = false)
public abstract class FabricTitleScreenLegacyMixin {
    @Inject(method = "method_25394", at = @At("TAIL"), require = 0, remap = false)
    private void kiza$renderLauncherForeground(
        class_4587 graphics,
        int mouseX,
        int mouseY,
        float tickDelta,
        CallbackInfo callbackInfo
    ) {
        MenuLogoRenderer.renderTitleForeground(graphics, this, mouseX, mouseY);
    }
}
