package fr.kiza.basemod.render;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;

/**
 * One texture whose pixels are rewritten in place, for something that moves:
 * the menu's video.
 *
 * <p>Every other Kiza texture is made once and kept. A video frame changes
 * sixty times a second, and making a texture for each -- encode a PNG, decode
 * it, allocate, register, free the last -- was most of why the video stuttered.
 * Here one {@code DynamicTexture} is made at the video's size, its image's
 * memory is pointed at the decoded frame for as long as {@code upload()}
 * sends it to the graphics card: an upload a frame, no copy, nothing
 * allocated. It
 * samples linearly, so a frame of another size than the screen is drawn
 * smooth rather than in squares.
 *
 * <p>Found by reflection like the rest. The image's memory is the one long
 * field that is not its size; the upload is {@code upload} in each mapping.
 * Anything missing and {@link #create} answers null, and the caller falls
 * back to the slower texture-per-frame path, which still works.
 */
public final class StreamingTexture {
    private final Object identifier;
    private final Object texture;
    private final Object image;
    private final Field pixels;
    private final long address;
    private final int width;
    private final int height;
    private final Method upload;
    private final Method intBuffer;
    private int filter;
    /** Off for good once pointing the image elsewhere failed: copied then. */
    private boolean pointing = true;

    private StreamingTexture(Object identifier, Object texture, Object image, Field pixels, long address, int width, int height, Method upload, Method intBuffer) {
        this.identifier = identifier;
        this.texture = texture;
        this.image = image;
        this.pixels = pixels;
        this.address = address;
        this.width = width;
        this.height = height;
        this.upload = upload;
        this.intBuffer = intBuffer;
    }

    public Object identifier() {
        return identifier;
    }

    public int width() {
        return width;
    }

    public int height() {
        return height;
    }

    /** A texture of this size under {@code name}, or null where this version will not give one. */
    public static StreamingTexture create(String name, int width, int height) {
        if (KizaCanvas.isUnavailable() || width <= 0 || height <= 0) return null;
        try {
            Class<?> imageType = fr.kiza.basemod.McNames.firstClass(
                "com.mojang.blaze3d.platform.NativeImage", "net.minecraft.class_1011"
            );
            if (imageType == null) return null;
            Constructor<?> make = imageType.getConstructor(int.class, int.class, boolean.class);
            Object image = make.newInstance(width, height, false);
            Field pixels = pointer(image, (long) width * height * 4L);
            if (pixels == null) return null;
            long address = pixels.getLong(image);
            Method upload = null;
            Object texture = KizaCanvas.backedTexture(name, image);
            for (String candidate : new String[] {"upload", "method_4524", "m_117985_", "updateDynamicTexture", "func_110564_a"}) {
                try {
                    Method method = texture.getClass().getMethod(candidate);
                    if (method.getParameterCount() == 0 && method.getReturnType() == void.class) {
                        upload = method;
                        break;
                    }
                } catch (NoSuchMethodException ignored) {
                    // Try the next mapping.
                }
            }
            if (upload == null) return null;
            Method intBuffer = Class.forName("org.lwjgl.system.MemoryUtil").getMethod("memIntBuffer", long.class, int.class);
            Object identifier = KizaCanvas.register(name, texture);
            if (identifier == null) return null;
            StreamingTexture made = new StreamingTexture(identifier, texture, image, pixels, address, width, height, upload, intBuffer);
            // Drawn over the whole screen from a frame of another size: smooth.
            made.filter = TextureFilter.linear(texture);
            return made;
        } catch (Throwable unavailable) {
            return null;
        }
    }

    /**
     * Writes a frame and sends it to the graphics card.
     *
     * @param abgr the frame in the image's own order -- red in the lowest
     *             byte -- one int a pixel, row by row; see {@link #toAbgr}
     */
    public boolean write(int[] abgr) {
        if (abgr.length < width * height) return false;
        try {
            java.nio.IntBuffer memory = (java.nio.IntBuffer) intBuffer.invoke(null, address, width * height);
            memory.put(abgr, 0, width * height);
            send();
            return true;
        } catch (Throwable failure) {
            return false;
        }
    }

    /**
     * Sends a frame in native memory -- four bytes a pixel, red first, as
     * stb_image decodes it -- to the graphics card.
     *
     * <p>The image is pointed at the frame for the upload and pointed back
     * after: copying a 1080p frame into it first cost the render thread
     * 1.2 to 1.5 ms a frame, measured, as much as the upload. Minecraft's
     * upload reads the memory before it returns; the caller keeps the frame
     * until the next one is shown all the same, in case one did not. Where
     * the image cannot be pointed elsewhere, the frame is copied, as before.
     */
    public boolean present(long rgba) {
        if (rgba == 0L) return false;
        if (pointing) {
            try {
                pixels.setLong(image, rgba);
                try {
                    send();
                } finally {
                    pixels.setLong(image, address);
                }
                return true;
            } catch (IllegalAccessException | RuntimeException refused) {
                pointing = false;
            } catch (Throwable failure) {
                return false;
            }
        }
        try {
            if (!NativeFrames.copy(rgba, address, (long) width * height * 4L)) return false;
            send();
            return true;
        } catch (Throwable failure) {
            return false;
        }
    }

    /** Uploads what the image holds, and samples it smooth again where the upload undid that. */
    private void send() throws ReflectiveOperationException {
        upload.invoke(texture);
        if (filter == TextureFilter.UNTIL_UPLOAD) TextureFilter.linear(texture);
    }

    /** What the texture holds on the graphics card, in bytes. */
    public long bytes() {
        return (long) width * height * 4L;
    }

    /** Java's ARGB, in place, into the ABGR a NativeImage holds. */
    public static void toAbgr(int[] pixels) {
        for (int index = 0; index < pixels.length; index += 1) {
            int argb = pixels[index];
            pixels[index] = (argb & 0xFF00FF00) | ((argb >> 16) & 0xFF) | ((argb & 0xFF) << 16);
        }
    }

    /**
     * The field holding the image's memory: of its long fields, the one that
     * is not its size. Checked against the size the image must have, so a
     * field that only looks like a pointer is never written through.
     */
    private static Field pointer(Object image, long size) throws IllegalAccessException {
        Field found = null;
        boolean sizeSeen = false;
        for (Class<?> type = image.getClass(); type != null; type = type.getSuperclass()) {
            for (Field field : type.getDeclaredFields()) {
                if (field.getType() != long.class || Modifier.isStatic(field.getModifiers())) continue;
                field.setAccessible(true);
                long value = field.getLong(image);
                if (value == size) sizeSeen = true;
                else if (value != 0L) found = field;
            }
        }
        return sizeSeen ? found : null;
    }
}
