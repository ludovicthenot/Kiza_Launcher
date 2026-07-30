package fr.kiza.basemod.window;

import java.nio.Buffer;
import java.nio.ByteBuffer;
import java.lang.reflect.Method;

final class WindowsNativeWindowPlatform extends GlfwWindowPlatform {
    private static final int GWL_STYLE = -16;
    private static final int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    private static final int DWMWCP_ROUND = 2;
    private static final long WS_CAPTION = 0x00C00000L;
    private static final long WS_THICKFRAME = 0x00040000L;
    private static final long WS_MINIMIZEBOX = 0x00020000L;
    private static final long WS_MAXIMIZEBOX = 0x00010000L;
    private static final long WS_SYSMENU = 0x00080000L;
    private static final int SWP_NOSIZE = 0x0001;
    private static final int SWP_NOMOVE = 0x0002;
    private static final int SWP_NOZORDER = 0x0004;
    private static final int SWP_FRAMECHANGED = 0x0020;

    private boolean nativeResize;

    @Override
    public void setDecorated(long handle, boolean decorated) {
        super.setDecorated(handle, decorated);
        if (!decorated) nativeResize = applyBorderlessNativeFrame(handle);
    }

    @Override
    public boolean supportsNativeResize() {
        return nativeResize;
    }

    private boolean applyBorderlessNativeFrame(long glfwHandle) {
        try {
            Class<?> glfwWin32 = Class.forName("org.lwjgl.glfw.GLFWNativeWin32");
            Class<?> user32 = Class.forName("org.lwjgl.system.windows.User32");
            long hwnd = ((Number) glfwWin32
                .getMethod("glfwGetWin32Window", long.class)
                .invoke(null, glfwHandle))
                .longValue();
            if (hwnd == 0L) return false;

            Method getStyle = user32.getMethod("GetWindowLongPtr", long.class, int.class);
            Method setStyle = user32.getMethod(
                "SetWindowLongPtr",
                long.class,
                int.class,
                long.class
            );
            Method setWindowPos = user32.getMethod(
                "SetWindowPos",
                long.class,
                long.class,
                int.class,
                int.class,
                int.class,
                int.class,
                int.class
            );
            long style = ((Number) getStyle.invoke(null, hwnd, GWL_STYLE)).longValue();
            long borderless = (style & ~WS_CAPTION)
                | WS_THICKFRAME
                | WS_MINIMIZEBOX
                | WS_MAXIMIZEBOX
                | WS_SYSMENU;
            setStyle.invoke(null, hwnd, GWL_STYLE, borderless);
            setWindowPos.invoke(
                null,
                hwnd,
                0L,
                0,
                0,
                0,
                0,
                SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_FRAMECHANGED
            );
            if (applyRoundedCorners(hwnd)) {
                System.out.println(
                    "[Kiza Client/Window] Windows rounded corners enabled."
                );
            }
            return true;
        } catch (ReflectiveOperationException | RuntimeException error) {
            System.err.println(
                "[Kiza Client/Window] Native Windows resize is unavailable; using GLFW edges."
            );
            return false;
        }
    }

    private boolean applyRoundedCorners(long hwnd) {
        Object library = null;
        ByteBuffer functionName = null;
        long preferenceMemory = 0L;
        try {
            Class<?> windowsLibrary = Class.forName(
                "org.lwjgl.system.windows.WindowsLibrary"
            );
            Class<?> memoryUtil = Class.forName("org.lwjgl.system.MemoryUtil");
            Class<?> jni = Class.forName("org.lwjgl.system.JNI");

            library = windowsLibrary
                .getConstructor(String.class)
                .newInstance("dwmapi.dll");
            functionName = (ByteBuffer) memoryUtil
                .getMethod("memASCII", CharSequence.class)
                .invoke(null, "DwmSetWindowAttribute");
            long functionAddress = ((Number) windowsLibrary
                .getMethod("getFunctionAddress", ByteBuffer.class)
                .invoke(library, functionName))
                .longValue();
            if (functionAddress == 0L) return false;

            preferenceMemory = ((Number) memoryUtil
                .getMethod("nmemAllocChecked", long.class)
                .invoke(null, Integer.BYTES))
                .longValue();
            memoryUtil
                .getMethod("memPutInt", long.class, int.class)
                .invoke(null, preferenceMemory, DWMWCP_ROUND);

            int result = ((Number) jni
                .getMethod(
                    "invokePPI",
                    long.class,
                    int.class,
                    long.class,
                    int.class,
                    long.class
                )
                .invoke(
                    null,
                    hwnd,
                    DWMWA_WINDOW_CORNER_PREFERENCE,
                    preferenceMemory,
                    Integer.BYTES,
                    functionAddress
                ))
                .intValue();
            return result >= 0;
        } catch (ReflectiveOperationException | RuntimeException | LinkageError error) {
            return false;
        } finally {
            releaseNativeResources(library, functionName, preferenceMemory);
        }
    }

    private void releaseNativeResources(
        Object library,
        ByteBuffer functionName,
        long preferenceMemory
    ) {
        try {
            Class<?> memoryUtil = Class.forName("org.lwjgl.system.MemoryUtil");
            if (preferenceMemory != 0L) {
                memoryUtil
                    .getMethod("nmemFree", long.class)
                    .invoke(null, preferenceMemory);
            }
            if (functionName != null) {
                memoryUtil
                    .getMethod("memFree", Buffer.class)
                    .invoke(null, functionName);
            }
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            // The operating system reclaims these tiny buffers when Minecraft exits.
        }
        if (library == null) return;
        try {
            library.getClass().getMethod("free").invoke(library);
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            // The loaded system DLL remains valid for the lifetime of the process.
        }
    }
}
