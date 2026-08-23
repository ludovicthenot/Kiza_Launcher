package net.minecraft.client.gui;

/**
 * Compile- and test-time stand-in for the pre-1.20 draw helpers, which the real
 * game inherits into every screen. Stripped from the packaged jar by build.mjs,
 * so the game always resolves its own class.
 *
 * <p>The static fields let {@code GuiDispatchTest} prove the PoseStack path
 * actually reaches these helpers with the stack as first argument.
 */
public class GuiComponent {
    public static int[] lastFill;
    public static int[] lastBlit;
    public static String lastText;
    public static Object lastPoseStack;

    protected static void fill(
        Object poseStack,
        int left,
        int top,
        int right,
        int bottom,
        int color
    ) {
        lastPoseStack = poseStack;
        lastFill = new int[] {left, top, right, bottom, color};
    }

    public static void blit(
        Object poseStack,
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
        lastPoseStack = poseStack;
        lastBlit = new int[] {
            x, y, width, height, (int) u, (int) v,
            regionWidth, regionHeight, textureWidth, textureHeight
        };
    }

    public void drawString(
        Object poseStack,
        Object font,
        String text,
        int x,
        int y,
        int color
    ) {
        lastPoseStack = poseStack;
        lastText = text;
    }
}
