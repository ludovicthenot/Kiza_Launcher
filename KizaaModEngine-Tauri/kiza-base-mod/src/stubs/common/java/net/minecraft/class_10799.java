package net.minecraft;

import com.mojang.blaze3d.pipeline.RenderPipeline;

/**
 * Compile- and test-time stand-in for RenderPipelines, whose GUI_TEXTURED
 * pipeline the 1.21.6+ blit takes as its first argument. Stripped from the
 * packaged jar by build.mjs.
 */
public final class class_10799 {
    public static final RenderPipeline field_56883 = new RenderPipeline();

    private class_10799() {}
}
