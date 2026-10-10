package fr.kiza.basemod.render;

import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;
import java.nio.ByteBuffer;

/**
 * JPEG and PNG decoded by stb_image, the decoder Minecraft itself loads its
 * textures with, straight into native memory.
 *
 * <p>Measured against ImageIO for the menu's frames: 7 ms instead of 43 ms
 * for a 1080p JPEG, 16 ms instead of 87 ms at 1440p, and no Java array per
 * frame -- the pixels land in memory the garbage collector never sees, in the
 * very byte order a NativeImage holds, so they are copied into the texture
 * as they are.
 *
 * <p>Reached through method handles, so a version without LWJGL 3 -- before
 * 1.13 -- simply reports {@link #available()} false, and the caller decodes
 * with ImageIO instead.
 */
public final class NativeFrames {
    private NativeFrames() {}

    private static boolean resolved;
    private static MethodHandle load;
    private static MethodHandle free;
    private static MethodHandle copy;
    private static MethodHandle address;

    /** Whether stb_image can be called here. */
    public static synchronized boolean available() {
        if (resolved) return load != null;
        resolved = true;
        try {
            MethodHandles.Lookup lookup = MethodHandles.publicLookup();
            Class<?> stb = Class.forName("org.lwjgl.stb.STBImage");
            Class<?> memory = Class.forName("org.lwjgl.system.MemoryUtil");
            MethodHandle loadHandle = lookup.findStatic(stb, "nstbi_load_from_memory", MethodType.methodType(
                long.class, long.class, int.class, int[].class, int[].class, int[].class, int.class));
            MethodHandle freeHandle = lookup.findStatic(stb, "nstbi_image_free", MethodType.methodType(void.class, long.class));
            MethodHandle copyHandle = lookup.findStatic(memory, "memCopy", MethodType.methodType(
                void.class, long.class, long.class, long.class));
            MethodHandle addressHandle = lookup.findStatic(memory, "memAddress", MethodType.methodType(long.class, ByteBuffer.class));
            load = loadHandle;
            free = freeHandle;
            copy = copyHandle;
            address = addressHandle;
        } catch (Throwable absent) {
            load = null;
        }
        return load != null;
    }

    /**
     * Decodes the {@code length} bytes at the start of {@code encoded}, a
     * direct buffer, into four bytes a pixel: red, green, blue, alpha.
     *
     * @param size receives the width and the height
     * @return the pixels' address, to hand back to {@link #free}; 0 when the
     *         picture could not be decoded
     */
    public static long decode(ByteBuffer encoded, int length, int[] size) {
        if (!available() || !encoded.isDirect()) return 0L;
        int[] width = new int[1];
        int[] height = new int[1];
        int[] channels = new int[1];
        try {
            long at = (long) address.invokeExact(encoded);
            long pixels = (long) load.invokeExact(at, length, width, height, channels, 4);
            size[0] = width[0];
            size[1] = height[0];
            return pixels;
        } catch (Throwable failure) {
            return 0L;
        }
    }

    public static void free(long pixels) {
        if (pixels == 0L || free == null) return;
        try {
            free.invokeExact(pixels);
        } catch (Throwable ignored) {
            // Nothing more can be done with it.
        }
    }

    /** Copies native memory to native memory. */
    static boolean copy(long from, long to, long bytes) {
        if (copy == null) return false;
        try {
            copy.invokeExact(from, to, bytes);
            return true;
        } catch (Throwable failure) {
            return false;
        }
    }
}
