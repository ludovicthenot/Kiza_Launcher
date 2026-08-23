package fr.kiza.basemod.render;

import com.mojang.blaze3d.systems.RenderSystem;
import net.minecraft.client.gui.GuiComponent;

/**
 * Covers both GUI generations: the 1.20+ object that draws itself, and the
 * pre-1.20 PoseStack whose helpers live on GuiComponent.
 */
public final class GuiDispatchTest {
    private GuiDispatchTest() {}

    public static void main(String[] args) {
        modernGraphicsDrawsThroughItself();
        modernPipelineGraphicsDrawsThroughItself();
        poseStackDrawsThroughTheScreenHelpers();
        poseStackBindsTheTextureBeforeBlitting();
        unknownGraphicsIsReportedRatherThanThrowing();
        System.out.println("GuiDispatch tests passed");
    }

    private static void modernGraphicsDrawsThroughItself() {
        FakeGraphics graphics = new FakeGraphics();

        assert GuiDispatch.fill(graphics, null, 1, 2, 3, 4, 0xFF00FF00);
        assert graphics.filled != null : "fill must reach the graphics object";
        assert graphics.filled[4] == 0xFF00FF00;

        assert GuiDispatch.blit(
            graphics, null, new FakeIdentifier(), 5, 6, 20, 10, 0F, 0F, 20, 10, 64, 64
        );
        assert graphics.blitted != null : "blit must reach the graphics object";
        assert graphics.blitted[0] == 5 && graphics.blitted[1] == 6;
    }

    private static void modernPipelineGraphicsDrawsThroughItself() {
        FakeModernGraphics graphics = new FakeModernGraphics();

        assert GuiDispatch.fill(graphics, null, 0, 0, 8, 8, 0xFFFFFFFF);
        // The 13-argument form takes the pipeline first; resolving it must not
        // change the geometry the caller asked for.
        assert GuiDispatch.blit(
            graphics, null, new FakeIdentifier(), 3, 4, 16, 16, 0F, 0F, 16, 16, 32, 32
        );
        assert graphics.pipeline != null : "the modern blit must receive a pipeline";
        assert graphics.blitted[0] == 3 && graphics.blitted[1] == 4;
        assert graphics.blitted[2] == 16 && graphics.blitted[3] == 16;
    }

    private static void poseStackDrawsThroughTheScreenHelpers() {
        GuiComponent.lastFill = null;
        GuiComponent.lastText = null;
        FakePoseStack poseStack = new FakePoseStack();
        GuiComponent screen = new GuiComponent();

        assert GuiDispatch.fill(poseStack, screen, 1, 2, 3, 4, 0xFF112233);
        assert GuiComponent.lastFill != null : "pre-1.20 fill must reach GuiComponent";
        assert GuiComponent.lastFill[4] == 0xFF112233;
        assert GuiComponent.lastPoseStack == poseStack : "the stack goes first, not the screen";

        assert GuiDispatch.drawString(poseStack, screen, new FakeFont(), "Kiza", 4, 5, 0xFFFFFF);
        assert "Kiza".equals(GuiComponent.lastText);
    }

    private static void poseStackBindsTheTextureBeforeBlitting() {
        GuiComponent.lastBlit = null;
        RenderSystem.boundTexture = null;
        FakePoseStack poseStack = new FakePoseStack();
        FakeIdentifier identifier = new FakeIdentifier();

        assert GuiDispatch.blit(
            poseStack, new GuiComponent(), identifier, 7, 8, 12, 12, 0F, 0F, 12, 12, 16, 16
        );
        // Before 1.20 the blit draws whatever is bound, so binding is not
        // optional: without it every texture comes out as the previous one.
        assert RenderSystem.boundTexture == identifier : "the texture must be bound first";
        assert GuiComponent.lastBlit != null;
        assert GuiComponent.lastBlit[0] == 7 && GuiComponent.lastBlit[1] == 8;
    }

    private static void unknownGraphicsIsReportedRatherThanThrowing() {
        // A failed draw has to come back as false so the caller can fall back
        // to vanilla rendering, never as an exception through the render loop.
        assert !GuiDispatch.fill(null, null, 0, 0, 1, 1, 0);
        assert !GuiDispatch.blit(
            null, null, new FakeIdentifier(), 0, 0, 1, 1, 0F, 0F, 1, 1, 1, 1
        );
        assert !GuiDispatch.drawString(null, null, new FakeFont(), "x", 0, 0, 0);
    }

    public static final class FakeIdentifier {}
    public static final class FakeFont {}
    public static final class FakePoseStack {}

    public static final class FakeGraphics {
        int[] filled;
        int[] blitted;

        public void fill(int left, int top, int right, int bottom, int color) {
            filled = new int[] {left, top, right, bottom, color};
        }

        public void drawTexture(
            FakeIdentifier identifier,
            int x,
            int y,
            int width,
            int height,
            float u,
            float v,
            int regionWidth,
            int regionHeight,
            int textureWidth,
            int textureHeight
        ) {
            blitted = new int[] {x, y, width, height, regionWidth, regionHeight};
        }
    }

    public static final class FakeModernGraphics {
        Object pipeline;
        int[] blitted;

        public void fill(int left, int top, int right, int bottom, int color) {}

        public void drawTexture(
            com.mojang.blaze3d.pipeline.RenderPipeline pipeline,
            FakeIdentifier identifier,
            int x,
            int y,
            float u,
            float v,
            int width,
            int height,
            int regionWidth,
            int regionHeight,
            int textureWidth,
            int textureHeight,
            int color
        ) {
            this.pipeline = pipeline;
            blitted = new int[] {x, y, width, height, regionWidth, regionHeight};
        }
    }

}
