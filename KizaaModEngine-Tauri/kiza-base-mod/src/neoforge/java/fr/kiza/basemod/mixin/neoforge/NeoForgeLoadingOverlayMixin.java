package fr.kiza.basemod.mixin.neoforge;

import com.mojang.blaze3d.systems.RenderSystem;
import fr.kiza.basemod.KizaLoading;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.util.ARGB;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * NeoForge's loading screen, Kiza's: the one it shows while the game starts,
 * its early window drawn again inside the game, in place of Mojang's.
 *
 * <p>It asks no colour, so its window is drawn see-through, Kiza's background
 * laid where it was with the screen's fade, and the rest drawn on that
 * ({@link KizaLoading#overLoaderScreen}). The window is a texture blitted
 * with a colour made by {@code ARGB.colorFromFloat} from 1.21.2; before, a
 * few quads drawn under the shader colour it sets second. Mojang's names at
 * runtime, from 1.20.5, the first NeoForge to read this jar's mixins; each
 * method named with its whole descriptor, so a hook finds only its release.
 */
@Mixin(targets = "net.neoforged.neoforge.client.loading.NeoForgeLoadingOverlay", remap = false)
public abstract class NeoForgeLoadingOverlayMixin {
    @Inject(method = "render(Lnet/minecraft/client/gui/GuiGraphics;IIF)V", at = @At("RETURN"), require = 0, remap = false)
    private void kiza$drawn(GuiGraphics graphics, int mouseX, int mouseY, float delta, CallbackInfo callbackInfo) {
        KizaLoading.overLoaderScreen(this, graphics);
    }

    @Inject(
        method = "extractRenderState(Lnet/minecraft/client/gui/GuiGraphicsExtractor;IIF)V",
        at = @At("RETURN"),
        require = 0,
        remap = false
    )
    private void kiza$extracted(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta, CallbackInfo callbackInfo) {
        KizaLoading.overLoaderScreen(this, graphics);
    }

    /** 1.21.2 and later: the window's texture, drawn with no opacity. */
    @Redirect(
        method = {
            "render(Lnet/minecraft/client/gui/GuiGraphics;IIF)V",
            "extractRenderState(Lnet/minecraft/client/gui/GuiGraphicsExtractor;IIF)V"
        },
        at = @At(value = "INVOKE", target = "Lnet/minecraft/util/ARGB;colorFromFloat(FFFF)I"),
        require = 0,
        remap = false
    )
    private int kiza$windowColour(float alpha, float red, float green, float blue) {
        return ARGB.colorFromFloat(KizaLoading.hidesProgressBar() ? 0F : alpha, red, green, blue);
    }

    /** 1.20.5 to 1.21.1: the colour the window's quads are drawn under. */
    @Redirect(
        method = "render(Lnet/minecraft/client/gui/GuiGraphics;IIF)V",
        at = @At(value = "INVOKE", target = "Lcom/mojang/blaze3d/systems/RenderSystem;setShaderColor(FFFF)V", ordinal = 1),
        require = 0,
        remap = false
    )
    private void kiza$quadColour(float red, float green, float blue, float alpha) {
        RenderSystem.setShaderColor(red, green, blue, KizaLoading.hidesProgressBar() ? 0F : alpha);
    }
}
