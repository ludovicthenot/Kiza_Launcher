package fr.kiza.basemod.render;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;

/**
 * Smooth sampling for a texture drawn larger or smaller than it is.
 *
 * <p>Minecraft samples its textures nearest-neighbour: right for a 16-pixel
 * block, wrong for a photo or a video stretched over the screen, where every
 * source pixel becomes a visible square. That, more than the frames' size,
 * is what made the menu's backgrounds look pixelated.
 *
 * <p>Three generations say it three ways, all reached by reflection:
 * <ul>
 *   <li>up to 1.21.10, {@code AbstractTexture.setFilter(blur, mipmap)} --
 *       {@code setFilter}, {@code method_4527} or {@code m_117960_}, and its
 *       older {@code setBlurMipmapDirect};</li>
 *   <li>from 1.21.11, a {@code GpuSampler} the texture holds, which is
 *       swapped for the linear, clamped one from {@code SamplerCache};</li>
 *   <li>in between, should neither be there, the texture's own
 *       {@code setTextureFilter}.</li>
 * </ul>
 * Clamped as well, so the edge of a frame drawn over the whole screen is not
 * blended with its opposite edge. Must be called on the render thread.
 */
public final class TextureFilter {
    private TextureFilter() {}

    private static final String[] SET_FILTER = {"setFilter", "method_4527", "m_117960_", "setBlurMipmapDirect", "func_174937_a"};

    /** {@link #linear} could not: the texture stays as Minecraft made it. */
    public static final int NONE = 0;
    /**
     * Set on the OpenGL texture itself, up to 1.21.4, where every
     * {@code upload()} puts nearest-neighbour back: set it again after each.
     */
    public static final int UNTIL_UPLOAD = 1;
    /** Held by the texture's sampler: it stays. */
    public static final int KEPT = 2;

    private static final int GL_TEXTURE_2D = 0x0DE1;
    private static final int GL_TEXTURE_WRAP_S = 0x2802;
    private static final int GL_TEXTURE_WRAP_T = 0x2803;
    private static final int GL_CLAMP_TO_EDGE = 0x812F;
    private static Method texParameter;
    private static boolean texParameterMissing;

    /** Makes {@code texture} sample linearly; says for how long, see {@link #UNTIL_UPLOAD}. */
    public static int linear(Object texture) {
        if (texture == null) return NONE;
        try {
            Method filter = findFilter(texture.getClass());
            if (filter != null) {
                // Binds the texture, then sets its filter; it is still bound
                // for the clamp, which setFilter leaves alone.
                filter.invoke(texture, true, false);
                clampBound();
                return UNTIL_UPLOAD;
            }
            if (swapSampler(texture)) return KEPT;
            return gpuTextureFilter(texture) ? KEPT : NONE;
        } catch (Throwable unavailable) {
            return NONE;
        }
    }

    private static void clampBound() {
        if (texParameterMissing) return;
        try {
            if (texParameter == null) {
                texParameter = Class.forName("org.lwjgl.opengl.GL11").getMethod("glTexParameteri", int.class, int.class, int.class);
            }
            texParameter.invoke(null, GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
            texParameter.invoke(null, GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        } catch (Throwable absent) {
            texParameterMissing = true;
        }
    }

    private static Class<?> filterType;
    private static Method filterFound;

    /** Looked up once a texture class: a video calls this for every frame. */
    private static synchronized Method findFilter(Class<?> type) {
        if (type == filterType) return filterFound;
        filterFound = searchFilter(type);
        filterType = type;
        return filterFound;
    }

    private static Method searchFilter(Class<?> type) {
        for (Class<?> cursor = type; cursor != null && cursor != Object.class; cursor = cursor.getSuperclass()) {
            for (String name : SET_FILTER) {
                try {
                    Method method = cursor.getDeclaredMethod(name, boolean.class, boolean.class);
                    if (method.getReturnType() != void.class) continue;
                    method.setAccessible(true);
                    return method;
                } catch (NoSuchMethodException ignored) {
                    // The next name, or the class above.
                }
            }
        }
        return null;
    }

    /**
     * 1.21.11 and 26.x: {@code RenderSystem.getSamplerCache().getSampler(
     * CLAMP_TO_EDGE, CLAMP_TO_EDGE, LINEAR, LINEAR, false)}, put in the field
     * the texture keeps its sampler in. Found by shape, not by name: the
     * cache's one five-argument method, four enums and a boolean.
     */
    private static boolean swapSampler(Object texture) throws ReflectiveOperationException {
        Class<?> renderSystem = fr.kiza.basemod.McNames.firstClass("com.mojang.blaze3d.systems.RenderSystem");
        if (renderSystem == null) return false;
        Method cacheGetter;
        try {
            cacheGetter = renderSystem.getMethod("getSamplerCache");
        } catch (NoSuchMethodException older) {
            return false;
        }
        Object cache = cacheGetter.invoke(null);
        if (cache == null) return false;
        for (Method method : cache.getClass().getMethods()) {
            Class<?>[] parameters = method.getParameterTypes();
            if (parameters.length != 5 || parameters[4] != boolean.class) continue;
            boolean enums = true;
            for (int index = 0; index < 4; index += 1) enums &= parameters[index].isEnum();
            if (!enums) continue;
            Object address = constant(parameters[0], "CLAMP_TO_EDGE");
            Object filter = constant(parameters[2], "LINEAR");
            if (address == null || filter == null) continue;
            Object sampler = method.invoke(cache, address, address, filter, filter, false);
            if (sampler == null) return false;
            for (Class<?> cursor = texture.getClass(); cursor != null; cursor = cursor.getSuperclass()) {
                for (Field field : cursor.getDeclaredFields()) {
                    if (Modifier.isStatic(field.getModifiers())) continue;
                    if (!field.getType().isAssignableFrom(sampler.getClass())) continue;
                    if (field.getType() == Object.class) continue;
                    field.setAccessible(true);
                    field.set(texture, sampler);
                    return true;
                }
            }
            return false;
        }
        return false;
    }

    /** 1.21.5 to 1.21.10, if setFilter were missing: the GpuTexture's own setter. */
    private static boolean gpuTextureFilter(Object texture) throws ReflectiveOperationException {
        for (Class<?> cursor = texture.getClass(); cursor != null; cursor = cursor.getSuperclass()) {
            for (Field field : cursor.getDeclaredFields()) {
                if (Modifier.isStatic(field.getModifiers()) || !field.getType().getSimpleName().equals("GpuTexture")) continue;
                field.setAccessible(true);
                Object gpu = field.get(texture);
                if (gpu == null) return false;
                for (Method method : gpu.getClass().getMethods()) {
                    if (!method.getName().equals("setTextureFilter")) continue;
                    Class<?>[] parameters = method.getParameterTypes();
                    if (parameters.length == 2 && parameters[0].isEnum() && parameters[1] == boolean.class) {
                        method.invoke(gpu, constant(parameters[0], "LINEAR"), false);
                        return true;
                    }
                    if (parameters.length == 3 && parameters[0].isEnum() && parameters[1].isEnum() && parameters[2] == boolean.class) {
                        Object linear = constant(parameters[0], "LINEAR");
                        method.invoke(gpu, linear, linear, false);
                        return true;
                    }
                }
            }
        }
        return false;
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static Object constant(Class<?> type, String name) {
        try {
            return Enum.valueOf((Class) type, name);
        } catch (IllegalArgumentException absent) {
            return null;
        }
    }
}
