package fr.kiza.basemod.mixin.forge;

import com.mojang.blaze3d.vertex.PoseStack;
import fr.kiza.basemod.KizaLoading;
import java.util.function.IntSupplier;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraftforge.client.loading.ClientModLoader;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Mojang's loading screen on Forge, Kiza's ({@link KizaLoading}), as on Fabric:
 * its colour, its bar, Kiza's drawn over it.
 *
 * <p>Forge runs the game under its SRG names up to 1.20.x and Mojang's after,
 * and the screen drew through a PoseStack, then a GuiGraphics, then a
 * GuiGraphicsExtractor: each method is named with its whole descriptor, so
 * a hook finds only the release it was written for, and the handler taking
 * it names its exact type -- Mixin turns the whole class down otherwise.
 * Where Forge draws its own screen over Mojang's, {@link ForgeEarlyLoadingOverlayMixin}.
 */
@Mixin(targets = "net.minecraft.client.gui.screens.LoadingOverlay", remap = false)
public abstract class ForgeLoadingOverlayMixin {
    @Redirect(
        method = {
            "m_6305_(Lcom/mojang/blaze3d/vertex/PoseStack;IIF)V",
            "m_86412_(Lcom/mojang/blaze3d/vertex/PoseStack;IIF)V",
            "m_88315_(Lnet/minecraft/client/gui/GuiGraphics;IIF)V",
            "render(Lnet/minecraft/client/gui/GuiGraphics;IIF)V",
            "extractRenderState(Lnet/minecraft/client/gui/GuiGraphicsExtractor;IIF)V"
        },
        at = @At(value = "INVOKE", target = "Ljava/util/function/IntSupplier;getAsInt()I"),
        require = 0,
        remap = false
    )
    private int kiza$background(IntSupplier colour) {
        return KizaLoading.background(this, colour.getAsInt());
    }

    /** 1.17 to 1.19.4: a PoseStack. */
    @Inject(
        method = {"m_6305_(Lcom/mojang/blaze3d/vertex/PoseStack;IIF)V", "m_86412_(Lcom/mojang/blaze3d/vertex/PoseStack;IIF)V"},
        at = @At("TAIL"),
        require = 0,
        remap = false
    )
    private void kiza$drawnPoseStack(PoseStack graphics, int mouseX, int mouseY, float delta, CallbackInfo callbackInfo) {
        KizaLoading.afterOverlay(this, graphics);
    }

    /** 1.20 to 1.21.11: a GuiGraphics. */
    @Inject(
        method = {"m_88315_(Lnet/minecraft/client/gui/GuiGraphics;IIF)V", "render(Lnet/minecraft/client/gui/GuiGraphics;IIF)V"},
        at = @At("TAIL"),
        require = 0,
        remap = false
    )
    private void kiza$drawn(GuiGraphics graphics, int mouseX, int mouseY, float delta, CallbackInfo callbackInfo) {
        KizaLoading.afterOverlay(this, graphics);
    }

    /** 26.1 and later. */
    @Inject(
        method = "extractRenderState(Lnet/minecraft/client/gui/GuiGraphicsExtractor;IIF)V",
        at = @At("TAIL"),
        require = 0,
        remap = false
    )
    private void kiza$extracted(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta, CallbackInfo callbackInfo) {
        KizaLoading.afterOverlay(this, graphics);
    }

    /** drawProgressBar, by every name it has had: Kiza's line takes its place. */
    @Inject(method = {"m_96182_", "drawProgressBar", "extractProgressBar"}, at = @At("HEAD"), cancellable = true, require = 0, remap = false)
    private void kiza$noBar(CallbackInfo callbackInfo) {
        if (KizaLoading.hidesProgressBar()) callbackInfo.cancel();
    }

    /** Up to 1.19: Forge's lines of progress, written over the screen. */
    @Redirect(
        method = {"m_6305_(Lcom/mojang/blaze3d/vertex/PoseStack;IIF)V", "m_86412_(Lcom/mojang/blaze3d/vertex/PoseStack;IIF)V"},
        at = @At(value = "INVOKE", target = "Lnet/minecraftforge/client/loading/ClientModLoader;renderProgressText()V"),
        require = 0,
        remap = false
    )
    private void kiza$progressText() {
        if (!KizaLoading.hidesProgressBar()) ClientModLoader.renderProgressText();
    }
}
