package fr.kiza.basemod.render;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.util.Arrays;
import javax.imageio.ImageIO;

/**
 * Bridges Java2D to Minecraft's texture system: takes an ARGB image rasterised
 * off-screen (antialiased shapes, TrueType text) and registers it as a GUI
 * texture that can be blitted like any other.
 *
 * <p>Everything is resolved reflectively so the same jar works across loaders
 * and mappings. If any step is unavailable the canvas reports itself as
 * unsupported and callers fall back to the vanilla primitives.
 */
public final class KizaCanvas {
    private static final String NAMESPACE = "kiza_base_mod";

    private static boolean unavailable;
    private static Method nativeImageRead;
    private static Constructor<?> backedTextureCtor;
    private static boolean backedTextureTakesLabel;
    private static Method registerTexture;
    private static Object textureManager;
    private static Constructor<?> identifierCtor;
    private static Method identifierFactory;

    private KizaCanvas() {}

    public static boolean isUnavailable() {
        return unavailable;
    }

    /**
     * Uploads {@code image} under {@code name} and returns the texture
     * identifier to blit, or {@code null} when the canvas is unsupported.
     */
    public static Object upload(String name, BufferedImage image) {
        if (unavailable || image == null) return null;
        try {
            Object identifier = identifier("dynamic/" + name);
            Object texture = newTexture(name, image);
            registerTexture(texture).invoke(textureManager, identifier, texture);
            return identifier;
        } catch (ReflectiveOperationException | RuntimeException | LinkageError error) {
            unavailable = true;
            // Name the failing lookup: all four steps throw NoSuchMethodException,
            // so the message is the only way to tell them apart from a log.
            String detail = error.getMessage();
            System.err.println(
                "[Kiza Launcher/Render] Custom canvas unavailable, falling back to vanilla drawing: "
                    + error.getClass().getSimpleName()
                    + (detail == null || detail.trim().isEmpty() ? "" : " - " + detail)
            );
            return null;
        }
    }

    /**
     * Wraps the rasterised image in whatever texture class this version has.
     *
     * <p>From 1.13 that means NativeImage plus NativeImageBackedTexture. Before
     * that, DynamicTexture takes a BufferedImage directly — which is what
     * Java2D already produced, so the legacy path is the shorter one.
     */
    private static Object newTexture(String name, BufferedImage image)
        throws ReflectiveOperationException {
        Class<?> legacyTextureType = legacyTextureType();
        if (legacyTextureType != null) {
            for (Constructor<?> candidate : legacyTextureType.getConstructors()) {
                Class<?>[] parameters = candidate.getParameterTypes();
                if (parameters.length == 1 && parameters[0].isAssignableFrom(BufferedImage.class)) {
                    candidate.setAccessible(true);
                    return candidate.newInstance(image);
                }
            }
        }
        return newBackedTexture(name, toNativeImage(image));
    }

    private static Class<?> legacyTextureType() {
        try {
            return firstClass("net.minecraft.client.renderer.texture.DynamicTexture");
        } catch (ClassNotFoundException absent) {
            return null;
        }
    }

    // PNG is the one image format every Minecraft version can decode, and it
    // keeps the alpha channel our antialiased edges depend on.
    private static Object toNativeImage(BufferedImage image)
        throws ReflectiveOperationException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        try {
            ImageIO.write(image, "PNG", buffer);
        } catch (java.io.IOException error) {
            throw new ReflectiveOperationException("PNG encode failed", error);
        }
        if (nativeImageRead == null) {
            Class<?> nativeImageType = firstClass(
                "com.mojang.blaze3d.platform.NativeImage",
                "net.minecraft.class_1011"
            );
            nativeImageRead = Arrays.stream(nativeImageType.getMethods())
                .filter(method -> java.lang.reflect.Modifier.isStatic(method.getModifiers()))
                .filter(method -> nativeImageType.isAssignableFrom(method.getReturnType()))
                .filter(method -> Arrays.equals(
                    method.getParameterTypes(),
                    new Class<?>[] {java.io.InputStream.class}
                ))
                .findFirst()
                .orElseThrow(() -> new NoSuchMethodException("NativeImage.read(InputStream)"));
            nativeImageRead.setAccessible(true);
        }
        return nativeImageRead.invoke(null, new ByteArrayInputStream(buffer.toByteArray()));
    }

    private static Object newBackedTexture(String name, Object nativeImage)
        throws ReflectiveOperationException {
        if (backedTextureCtor == null) {
            Class<?> textureType = firstClass(
                "net.minecraft.client.texture.NativeImageBackedTexture",
                "com.mojang.blaze3d.platform.NativeImageBackedTexture",
                "net.minecraft.class_1043"
            );
            Class<?> imageType = nativeImage.getClass();
            // The image is always the last parameter; the leading ones are debug
            // labels whose type changed across versions (String, then
            // Supplier<String>). Pick the shortest matching constructor.
            for (Constructor<?> candidate : textureType.getConstructors()) {
                Class<?>[] parameters = candidate.getParameterTypes();
                if (parameters.length == 0) continue;
                if (!parameters[parameters.length - 1].isAssignableFrom(imageType)) continue;
                // Leading parameters must be ones we can actually supply: a
                // primitive we cannot guess would fail at newInstance time.
                boolean fillable = true;
                for (int index = 0; index < parameters.length - 1; index += 1) {
                    if (parameters[index].isPrimitive()) {
                        fillable = false;
                        break;
                    }
                }
                if (!fillable) continue;
                if (backedTextureCtor != null
                    && backedTextureCtor.getParameterCount() <= parameters.length) {
                    continue;
                }
                candidate.setAccessible(true);
                backedTextureCtor = candidate;
            }
            if (backedTextureCtor == null) {
                throw new NoSuchMethodException(
                    "NativeImageBackedTexture constructor on " + textureType.getName()
                );
            }
        }

        Class<?>[] parameters = backedTextureCtor.getParameterTypes();
        Object[] arguments = new Object[parameters.length];
        arguments[parameters.length - 1] = nativeImage;
        String label = NAMESPACE + "/" + name;
        for (int index = 0; index < parameters.length - 1; index += 1) {
            if (parameters[index].isAssignableFrom(String.class)) {
                arguments[index] = label;
            } else if (parameters[index].isAssignableFrom(java.util.function.Supplier.class)) {
                arguments[index] = (java.util.function.Supplier<String>) () -> label;
            }
        }
        return backedTextureCtor.newInstance(arguments);
    }

    private static Method registerTexture(Object texture) throws ReflectiveOperationException {
        if (registerTexture != null) return registerTexture;

        Object minecraft = fr.kiza.basemod.WindowTitleManager.minecraftInstance();
        Class<?> managerType = firstClass(
            "net.minecraft.client.texture.TextureManager",
            "net.minecraft.client.renderer.texture.TextureManager",
            "net.minecraft.class_1060"
        );
        textureManager = readAssignable(minecraft, managerType);
        if (textureManager == null) throw new NoSuchFieldException("TextureManager");

        // TextureManager exposes several (Identifier, X) methods; the second
        // parameter must actually accept our texture or the call fails with an
        // argument type mismatch at invoke time.
        registerTexture = Arrays.stream(managerType.getMethods())
            .filter(method -> method.getParameterCount() == 2)
            // 1.8.9's loadTexture reports success as a boolean; later versions
            // return void.
            .filter(method -> method.getReturnType() == void.class
                || method.getReturnType() == boolean.class)
            .filter(method -> method.getParameterTypes()[0].getName().contains("2960")
                || method.getParameterTypes()[0].getSimpleName().equals("Identifier")
                || method.getParameterTypes()[0].getSimpleName().equals("ResourceLocation"))
            .filter(method -> method.getParameterTypes()[1].isInstance(texture))
            .findFirst()
            .orElseThrow(() -> new NoSuchMethodException(
                "TextureManager register accepting " + texture.getClass().getName()
            ));
        registerTexture.setAccessible(true);
        return registerTexture;
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

    static Object identifier(String path) throws ReflectiveOperationException {
        Class<?> identifierType = firstClass(
            "net.minecraft.resources.ResourceLocation",
            "net.minecraft.class_2960"
        );
        if (identifierCtor == null && identifierFactory == null) {
            for (Constructor<?> candidate : identifierType.getDeclaredConstructors()) {
                if (Arrays.equals(
                    candidate.getParameterTypes(),
                    new Class<?>[] {String.class, String.class}
                )) {
                    candidate.setAccessible(true);
                    identifierCtor = candidate;
                    break;
                }
            }
            if (identifierCtor == null) {
                identifierFactory = Arrays.stream(identifierType.getDeclaredMethods())
                    .filter(method -> java.lang.reflect.Modifier.isStatic(method.getModifiers()))
                    .filter(method -> identifierType.isAssignableFrom(method.getReturnType()))
                    .filter(method -> Arrays.equals(
                        method.getParameterTypes(),
                        new Class<?>[] {String.class, String.class}
                    ))
                    .findFirst()
                    .orElseThrow(() -> new NoSuchMethodException("Identifier factory"));
                identifierFactory.setAccessible(true);
            }
        }
        return identifierCtor != null
            ? identifierCtor.newInstance(NAMESPACE, path)
            : identifierFactory.invoke(null, NAMESPACE, path);
    }

    private static Class<?> firstClass(String... names) throws ClassNotFoundException {
        for (String name : names) {
            try {
                return Class.forName(name);
            } catch (ClassNotFoundException ignored) {
                // Try the mapping used by the next loader.
            }
        }
        throw new ClassNotFoundException(String.join("/", names));
    }
}
