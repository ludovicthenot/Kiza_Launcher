package fr.kiza.basemod;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.Arrays;

public final class MenuLogoRenderer {
    private static final String NAMESPACE = "kiza_base_mod";
    private static final String TEXTURE_PATH = "textures/gui/kiza_launcher_logo.png";
    // Big enough to read in-game (Lunar-style), anchored to the bottom-left
    // corner of every menu. The texture has a soft glow padding, cropped off
    // the screen edges via the margin/glow offsets below.
    private static final int DRAW_WIDTH = 210;
    private static final int DRAW_HEIGHT = 90;
    private static final int MARGIN = 6;
    private static final int GLOW_CROP_X = 26;
    private static final int GLOW_CROP_Y = 8;
    private static final int TEXTURE_WIDTH = 1400;
    private static final int TEXTURE_HEIGHT = 600;

    private static Object textureIdentifier;
    private static Method drawMethod;
    private static boolean unavailable;

    private MenuLogoRenderer() {}

    public static void render(Object graphics, Object screen) {
        if (graphics == null || unavailable) return;

        try {
            if (textureIdentifier == null) textureIdentifier = createTextureIdentifier();
            if (drawMethod == null) {
                drawMethod = findScaledDrawMethod(
                    graphics.getClass(),
                    textureIdentifier.getClass()
                );
            }

            int drawX = MARGIN - GLOW_CROP_X;
            int screenHeight = screenHeight(screen);
            // Bottom-left corner when the screen size is known; otherwise fall
            // back to the previous top-left placement so it still shows.
            int drawY = screenHeight > 0
                ? screenHeight - DRAW_HEIGHT + GLOW_CROP_Y - MARGIN
                : -GLOW_CROP_Y;

            drawMethod.invoke(
                graphics,
                textureIdentifier,
                drawX,
                drawY,
                DRAW_WIDTH,
                DRAW_HEIGHT,
                0.0F,
                0.0F,
                TEXTURE_WIDTH,
                TEXTURE_HEIGHT,
                TEXTURE_WIDTH,
                TEXTURE_HEIGHT
            );
        } catch (ReflectiveOperationException | RuntimeException error) {
            unavailable = true;
            System.err.println(
                "[Kiza Base Mod] The menu logo renderer is unavailable for this Minecraft version."
            );
        }
    }

    /** Scaled screen height from the Screen instance, or 0 when unavailable. */
    static int screenHeight(Object screen) {
        Integer height = readIntField(screen, "field_22790", "height");
        return height != null ? height : 0;
    }

    // Reads an int field by any of the given names (Fabric intermediary or
    // Mojmap), walking up the class hierarchy from the concrete screen type.
    static Integer readIntField(Object owner, String... names) {
        if (owner == null) return null;
        for (Class<?> type = owner.getClass(); type != null; type = type.getSuperclass()) {
            for (String name : names) {
                try {
                    Field field = type.getDeclaredField(name);
                    if (field.getType() == int.class) {
                        field.setAccessible(true);
                        return field.getInt(owner);
                    }
                } catch (NoSuchFieldException ignored) {
                    // Try the next name / superclass.
                } catch (ReflectiveOperationException | RuntimeException error) {
                    return null;
                }
            }
        }
        return null;
    }

    static Method findScaledDrawMethod(Class<?> graphicsType, Class<?> identifierType)
        throws NoSuchMethodException {
        return Arrays.stream(graphicsType.getMethods())
            .filter(method -> method.getReturnType() == void.class)
            .filter(method -> isScaledTextureMethod(method, identifierType))
            .findFirst()
            .orElseThrow(() -> new NoSuchMethodException("GUI texture draw method"));
    }

    private static boolean isScaledTextureMethod(Method method, Class<?> identifierType) {
        Class<?>[] parameters = method.getParameterTypes();
        return parameters.length == 11
            && parameters[0].isAssignableFrom(identifierType)
            && parameters[1] == int.class
            && parameters[2] == int.class
            && parameters[3] == int.class
            && parameters[4] == int.class
            && parameters[5] == float.class
            && parameters[6] == float.class
            && parameters[7] == int.class
            && parameters[8] == int.class
            && parameters[9] == int.class
            && parameters[10] == int.class;
    }

    private static Object createTextureIdentifier() throws ReflectiveOperationException {
        ReflectiveOperationException lastFailure = null;
        for (String className : new String[] {
            "net.minecraft.resources.ResourceLocation",
            "net.minecraft.class_2960"
        }) {
            try {
                return createTextureIdentifier(Class.forName(className));
            } catch (ReflectiveOperationException error) {
                lastFailure = error;
            }
        }
        throw lastFailure == null
            ? new ClassNotFoundException("Minecraft texture identifier")
            : lastFailure;
    }

    private static Object createTextureIdentifier(Class<?> identifierType)
        throws ReflectiveOperationException {
        for (Constructor<?> constructor : identifierType.getDeclaredConstructors()) {
            Class<?>[] parameters = constructor.getParameterTypes();
            if (Arrays.equals(parameters, new Class<?>[] {String.class, String.class})) {
                constructor.setAccessible(true);
                return constructor.newInstance(NAMESPACE, TEXTURE_PATH);
            }
        }

        for (Method method : identifierType.getDeclaredMethods()) {
            if (!Modifier.isStatic(method.getModifiers())
                || !identifierType.isAssignableFrom(method.getReturnType())) {
                continue;
            }
            Class<?>[] parameters = method.getParameterTypes();
            method.setAccessible(true);
            if (Arrays.equals(parameters, new Class<?>[] {String.class, String.class})) {
                Object identifier = method.invoke(null, NAMESPACE, TEXTURE_PATH);
                if (identifier != null) return identifier;
            }
            if (Arrays.equals(parameters, new Class<?>[] {String.class})) {
                Object identifier = method.invoke(null, NAMESPACE + ":" + TEXTURE_PATH);
                if (identifier != null) return identifier;
            }
        }

        throw new NoSuchMethodException("Minecraft texture identifier factory");
    }
}
