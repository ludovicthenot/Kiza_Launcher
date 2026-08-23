package com.mojang.blaze3d.systems;

import java.util.function.Supplier;

/**
 * Compile- and test-time stand-in. Before 1.20 the blit draws whatever texture
 * is currently bound, so the dispatcher has to bind through RenderSystem first;
 * {@link #boundTexture} lets the test prove that happened before the draw.
 *
 * <p>Stripped from the packaged jar by build.mjs.
 */
public final class RenderSystem {
    public static Object boundTexture;
    public static boolean blendEnabled;

    private RenderSystem() {}

    public static void setShaderTexture(int index, Object identifier) {
        boundTexture = identifier;
    }

    public static void setShader(Supplier<Object> shader) {}

    public static void enableBlend() {
        blendEnabled = true;
    }

    public static void defaultBlendFunc() {}
}
