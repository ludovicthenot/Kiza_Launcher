package fr.kiza.basemod.render;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.Arrays;
import java.util.function.Supplier;

/**
 * Draw primitives across Minecraft's two GUI generations.
 *
 * <p>From 1.20 on, screens hand out a {@code GuiGraphics} that carries fill,
 * blit and text itself, and binds textures on our behalf. Before that they hand
 * out a {@code PoseStack}: the same operations live on {@code GuiComponent} as
 * helpers taking that stack as their first argument, and the texture has to be
 * bound separately through {@code RenderSystem}.
 *
 * <p>Everything is resolved reflectively so a single jar covers both, and every
 * entry point returns false rather than throwing when a lookup fails — the
 * caller then falls back to vanilla rendering instead of breaking the screen.
 */
public final class GuiDispatch {
    private enum Mode {
        /** 1.20+: the graphics object draws. */
        MODERN,
        /** 1.17-1.19: static helpers draw, the graphics object is a PoseStack. */
        POSE_STACK,
        /** 1.8-1.12: no graphics object at all, Gui draws in immediate mode. */
        IMMEDIATE,
        UNAVAILABLE
    }

    private static final String[] GUI_COMPONENT_CLASSES = {
        "net.minecraft.client.gui.GuiComponent", "net.minecraft.class_332"
    };
    /**
     * Pre-1.13 draw helpers. Method names are SRG in production, so every
     * lookup here matches on signature only.
     */
    private static final String[] LEGACY_GUI_CLASSES = {"net.minecraft.client.gui.Gui"};
    private static final String[] GAME_RENDERER_CLASSES = {
        "net.minecraft.client.renderer.GameRenderer", "net.minecraft.class_757"
    };
    private static final String[] POSITION_TEX_SHADER = {"getPositionTexShader", "method_34542"};
    private static final String RENDER_SYSTEM = "com.mojang.blaze3d.systems.RenderSystem";

    private static Mode mode;
    private static Class<?> resolvedFor;

    private static Method modernFill;
    private static Method modernBlit;
    private static Method legacyFill;
    private static Method legacyBlit;
    private static Method legacyText;
    private static Object pipeline;
    private static Method immediateFill;
    private static Method immediateBlit;
    private static Method immediateBindTexture;
    private static Object immediateTextureManager;

    private GuiDispatch() {}

    /** True once a draw call has proven this Minecraft build is unsupported. */
    public static boolean isUnavailable() {
        return mode == Mode.UNAVAILABLE;
    }

    public static boolean fill(
        Object graphics,
        Object screen,
        int left,
        int top,
        int right,
        int bottom,
        int color
    ) {
        switch (resolve(graphics)) {
            case MODERN:
                return invoke(modernFill, graphics, left, top, right, bottom, color);
            case POSE_STACK:
                return invoke(
                    legacyFill,
                    Modifier.isStatic(legacyFill.getModifiers()) ? null : screen,
                    graphics, left, top, right, bottom, color
                );
            case IMMEDIATE:
                return invoke(
                    immediateFill,
                    Modifier.isStatic(immediateFill.getModifiers()) ? null : graphics,
                    left, top, right, bottom, color
                );
            default:
                return false;
        }
    }

    /**
     * Draws a registered texture, scaling {@code region} into the target box.
     *
     * <p>The 13-argument modern form additionally wants a render pipeline; that
     * one stays in the caller, which already resolves it.
     */
    public static boolean blit(
        Object graphics,
        Object screen,
        Object identifier,
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
        switch (resolve(graphics)) {
            case MODERN:
                if (modernBlit.getParameterCount() == 13) {
                    Object pipeline = texturePipeline(modernBlit.getParameterTypes()[0]);
                    if (pipeline == null) return false;
                    return invoke(
                        modernBlit, graphics,
                        pipeline, identifier, x, y, u, v, width, height,
                        regionWidth, regionHeight, textureWidth, textureHeight, 0xFFFFFFFF
                    );
                }
                return invoke(
                    modernBlit, graphics,
                    identifier, x, y, width, height, u, v,
                    regionWidth, regionHeight, textureWidth, textureHeight
                );
            case POSE_STACK:
                if (!bindTexture(identifier)) return false;
                return invoke(
                    legacyBlit,
                    Modifier.isStatic(legacyBlit.getModifiers()) ? null : screen,
                    graphics, x, y, width, height, u, v,
                    regionWidth, regionHeight, textureWidth, textureHeight
                );
            case IMMEDIATE:
                if (!bindTextureLegacy(identifier)) return false;
                // drawScaledCustomSizeModalRect(x, y, u, v, uWidth, vHeight,
                //                               width, height, tileW, tileH)
                return invoke(
                    immediateBlit,
                    Modifier.isStatic(immediateBlit.getModifiers()) ? null : graphics,
                    x, y, u, v, regionWidth, regionHeight, width, height,
                    (float) textureWidth, (float) textureHeight
                );
            default:
                return false;
        }
    }

    /** Vanilla-font text; only used when the TrueType renderer is unavailable. */
    public static boolean drawString(
        Object graphics,
        Object screen,
        Object font,
        String text,
        int x,
        int y,
        int color
    ) {
        if (font == null) return false;
        Mode resolved = resolve(graphics);
        if (resolved == Mode.POSE_STACK) {
            if (legacyText == null || screen == null) return false;
            return invoke(
                legacyText,
                Modifier.isStatic(legacyText.getModifiers()) ? null : screen,
                graphics, font, text, x, y, color
            );
        }
        if (resolved == Mode.IMMEDIATE) {
            // FontRenderer.drawStringWithShadow(String, float, float, int).
            Method draw = firstMatch(font.getClass().getMethods(), method -> {
                Class<?>[] parameters = method.getParameterTypes();
                return parameters.length == 4
                    && parameters[0] == String.class
                    && parameters[1] == float.class
                    && parameters[2] == float.class
                    && parameters[3] == int.class;
            });
            return draw != null && invoke(draw, font, text, (float) x, (float) y, color);
        }
        return false;
    }

    private static Object texturePipeline(Class<?> pipelineType) {
        if (pipeline != null) return pipeline;
        for (String className : new String[] {
            "net.minecraft.client.gl.RenderPipelines", "net.minecraft.class_10799"
        }) {
            try {
                Class<?> pipelines = Class.forName(className);
                for (String fieldName : new String[] {"GUI_TEXTURED", "field_56883"}) {
                    try {
                        java.lang.reflect.Field field = pipelines.getDeclaredField(fieldName);
                        if (!Modifier.isStatic(field.getModifiers())
                            || !pipelineType.isAssignableFrom(field.getType())) {
                            continue;
                        }
                        field.setAccessible(true);
                        pipeline = field.get(null);
                        if (pipeline != null) return pipeline;
                    } catch (NoSuchFieldException ignored) {
                        // Try the next mapped field.
                    }
                }
            } catch (ReflectiveOperationException | RuntimeException ignored) {
                // Try the next mapped class.
            }
        }
        return null;
    }

    private static synchronized Mode resolve(Object graphics) {
        if (graphics == null) return Mode.UNAVAILABLE;
        if (mode != null && resolvedFor == graphics.getClass()) return mode;

        resolvedFor = graphics.getClass();
        mode = resolveModern(graphics.getClass());
        if (mode == Mode.UNAVAILABLE) mode = resolvePoseStack();
        if (mode == Mode.UNAVAILABLE) mode = resolveImmediate();
        return mode;
    }

    /**
     * Pre-1.13: there is no graphics object, so callers pass the screen and Gui
     * draws straight to the bound GL state. Names are SRG in production, hence
     * signature-only matching: a static void with five ints is drawRect, and the
     * ten-parameter one is drawScaledCustomSizeModalRect.
     */
    private static Mode resolveImmediate() {
        Class<?> gui = firstClass(LEGACY_GUI_CLASSES);
        if (gui == null) return Mode.UNAVAILABLE;

        immediateFill = declared(gui, method ->
            method.getReturnType() == void.class
                && method.getParameterCount() == 5
                && allInts(method.getParameterTypes()));
        immediateBlit = declared(gui, method -> {
            Class<?>[] parameters = method.getParameterTypes();
            return method.getReturnType() == void.class
                && parameters.length == 10
                && parameters[0] == int.class
                && parameters[1] == int.class
                && parameters[2] == float.class
                && parameters[3] == float.class
                && allInts(Arrays.copyOfRange(parameters, 4, 8))
                && parameters[8] == float.class
                && parameters[9] == float.class;
        });

        return immediateFill != null && immediateBlit != null ? Mode.IMMEDIATE : Mode.UNAVAILABLE;
    }

    /** Binds through the pre-1.13 TextureManager, which has no RenderSystem. */
    private static boolean bindTextureLegacy(Object identifier) {
        try {
            if (immediateBindTexture == null) {
                Object minecraft = fr.kiza.basemod.WindowTitleManager.minecraftInstance();
                Class<?> managerType = Class.forName(
                    "net.minecraft.client.renderer.texture.TextureManager"
                );
                immediateTextureManager = readAssignable(minecraft, managerType);
                if (immediateTextureManager == null) return false;
                immediateBindTexture = firstMatch(managerType.getMethods(), method ->
                    method.getParameterCount() == 1
                        && method.getReturnType() == void.class
                        && method.getParameterTypes()[0].isInstance(identifier));
                if (immediateBindTexture == null) return false;
                immediateBindTexture.setAccessible(true);
            }
            immediateBindTexture.invoke(immediateTextureManager, identifier);
            return true;
        } catch (ReflectiveOperationException | RuntimeException error) {
            return false;
        }
    }

    private static Object readAssignable(Object owner, Class<?> type)
        throws IllegalAccessException {
        if (owner == null) return null;
        for (Class<?> cursor = owner.getClass(); cursor != null; cursor = cursor.getSuperclass()) {
            for (java.lang.reflect.Field field : cursor.getDeclaredFields()) {
                if (!type.isAssignableFrom(field.getType())) continue;
                field.setAccessible(true);
                Object value = field.get(owner);
                if (value != null) return value;
            }
        }
        return null;
    }

    private static Mode resolveModern(Class<?> graphicsType) {
        Method fill = firstMatch(
            graphicsType.getMethods(),
            method -> isNamed(method, "fill", "method_25294", "m_280509_")
                && allInts(method.getParameterTypes())
                && method.getParameterCount() == 5
        );
        Method blit = firstMatch(
            graphicsType.getMethods(),
            GuiDispatch::isModernBlit
        );
        if (fill == null || blit == null) return Mode.UNAVAILABLE;

        modernFill = fill;
        modernBlit = blit;
        return Mode.MODERN;
    }

    private static Mode resolvePoseStack() {
        Class<?> component = firstClass(GUI_COMPONENT_CLASSES);
        if (component == null) return Mode.UNAVAILABLE;

        // fill/blit are protected on GuiComponent, so only declared lookups see
        // them; both are inherited by every screen.
        legacyFill = declared(component, method -> {
            Class<?>[] parameters = method.getParameterTypes();
            return parameters.length == 6
                && !parameters[0].isPrimitive()
                && allInts(Arrays.copyOfRange(parameters, 1, 6));
        });
        legacyBlit = declared(component, GuiDispatch::isPoseStackBlit);
        legacyText = declared(component, method -> {
            Class<?>[] parameters = method.getParameterTypes();
            return parameters.length == 6
                && !parameters[0].isPrimitive()
                && !parameters[1].isPrimitive()
                && parameters[2] == String.class
                && allInts(Arrays.copyOfRange(parameters, 3, 6));
        });

        return legacyFill != null && legacyBlit != null ? Mode.POSE_STACK : Mode.UNAVAILABLE;
    }

    private static boolean isModernBlit(Method method) {
        Class<?>[] parameters = method.getParameterTypes();
        if (method.getReturnType() != void.class) return false;
        boolean legacyShape = parameters.length == 11
            && !parameters[0].isPrimitive()
            && allInts(Arrays.copyOfRange(parameters, 1, 5))
            && parameters[5] == float.class
            && parameters[6] == float.class
            && allInts(Arrays.copyOfRange(parameters, 7, 11));
        boolean pipelineShape = parameters.length == 13
            && parameters[0].getName().equals("com.mojang.blaze3d.pipeline.RenderPipeline")
            && !parameters[1].isPrimitive()
            && parameters[2] == int.class
            && parameters[3] == int.class
            && parameters[4] == float.class
            && parameters[5] == float.class
            && allInts(Arrays.copyOfRange(parameters, 6, 13));
        return legacyShape || pipelineShape;
    }

    private static boolean isPoseStackBlit(Method method) {
        Class<?>[] parameters = method.getParameterTypes();
        return method.getReturnType() == void.class
            && parameters.length == 11
            && !parameters[0].isPrimitive()
            && allInts(Arrays.copyOfRange(parameters, 1, 5))
            && parameters[5] == float.class
            && parameters[6] == float.class
            && allInts(Arrays.copyOfRange(parameters, 7, 11));
    }

    /**
     * Binds a texture for the pre-1.20 blit, which draws whatever is bound
     * rather than taking an identifier.
     */
    private static boolean bindTexture(Object identifier) {
        try {
            Class<?> renderSystem = Class.forName(RENDER_SYSTEM);
            Method setShaderTexture = firstMatch(renderSystem.getMethods(), method ->
                method.getName().equals("setShaderTexture")
                    && method.getParameterCount() == 2
                    && method.getParameterTypes()[0] == int.class
                    && method.getParameterTypes()[1].isInstance(identifier));
            if (setShaderTexture == null) return false;

            Method setShader = firstMatch(renderSystem.getMethods(), method ->
                method.getName().equals("setShader")
                    && method.getParameterCount() == 1
                    && Supplier.class.isAssignableFrom(method.getParameterTypes()[0]));
            Method positionTexShader = positionTexShader();
            if (setShader != null && positionTexShader != null) {
                setShader.invoke(null, (Supplier<Object>) () -> {
                    try {
                        return positionTexShader.invoke(null);
                    } catch (ReflectiveOperationException | RuntimeException error) {
                        return null;
                    }
                });
            }

            invokeStaticIfPresent(renderSystem, "enableBlend");
            invokeStaticIfPresent(renderSystem, "defaultBlendFunc");
            setShaderTexture.invoke(null, 0, identifier);
            return true;
        } catch (ReflectiveOperationException | RuntimeException error) {
            return false;
        }
    }

    private static Method positionTexShader() {
        Class<?> gameRenderer = firstClass(GAME_RENDERER_CLASSES);
        if (gameRenderer == null) return null;
        return firstMatch(gameRenderer.getMethods(), method ->
            isNamed(method, POSITION_TEX_SHADER)
                && method.getParameterCount() == 0
                && Modifier.isStatic(method.getModifiers()));
    }

    private static void invokeStaticIfPresent(Class<?> owner, String name) {
        try {
            owner.getMethod(name).invoke(null);
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            // Optional state setup; the blit still draws without it.
        }
    }

    private static Method declared(Class<?> owner, java.util.function.Predicate<Method> filter) {
        for (Class<?> type = owner; type != null; type = type.getSuperclass()) {
            Method match = firstMatch(type.getDeclaredMethods(), filter);
            if (match != null) {
                match.setAccessible(true);
                return match;
            }
        }
        return null;
    }

    private static Method firstMatch(Method[] methods, java.util.function.Predicate<Method> filter) {
        return Arrays.stream(methods).filter(filter).findFirst().orElse(null);
    }

    private static Class<?> firstClass(String... names) {
        for (String name : names) {
            try {
                return Class.forName(name);
            } catch (ClassNotFoundException ignored) {
                // Try the next mapping.
            }
        }
        return null;
    }

    private static boolean isNamed(Method method, String... names) {
        for (String name : names) {
            if (method.getName().equals(name)) return true;
        }
        return false;
    }

    private static boolean allInts(Class<?>[] parameters) {
        return Arrays.stream(parameters).allMatch(parameter -> parameter == int.class);
    }

    private static boolean invoke(Method method, Object receiver, Object... arguments) {
        try {
            method.invoke(receiver, arguments);
            return true;
        } catch (ReflectiveOperationException | RuntimeException error) {
            return false;
        }
    }
}
