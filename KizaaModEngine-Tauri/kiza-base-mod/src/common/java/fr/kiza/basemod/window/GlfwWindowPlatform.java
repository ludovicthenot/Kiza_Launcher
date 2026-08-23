package fr.kiza.basemod.window;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.EnumMap;
import java.util.Map;

class GlfwWindowPlatform implements WindowPlatform {
    static final int GLFW_FALSE = 0;
    static final int GLFW_TRUE = 1;
    static final int GLFW_PRESS = 1;
    static final int GLFW_MOUSE_BUTTON_LEFT = 0;
    static final int GLFW_ICONIFIED = 0x00020002;
    static final int GLFW_RESIZABLE = 0x00020003;
    static final int GLFW_DECORATED = 0x00020005;
    static final int GLFW_MAXIMIZED = 0x00020008;
    private static final int GLFW_HRESIZE_CURSOR = 0x00036005;
    private static final int GLFW_VRESIZE_CURSOR = 0x00036006;
    private static final int GLFW_RESIZE_NWSE_CURSOR = 0x00036007;
    private static final int GLFW_RESIZE_NESW_CURSOR = 0x00036008;

    private final Class<?> glfw;
    private final Map<CursorShape, Long> cursors = new EnumMap<>(CursorShape.class);
    private Object mouseCallback;
    private Object previousMouseCallback;
    private CursorShape activeCursorShape = CursorShape.DEFAULT;

    GlfwWindowPlatform() {
        try {
            glfw = Class.forName("org.lwjgl.glfw.GLFW");
        } catch (ClassNotFoundException error) {
            throw new IllegalStateException("LWJGL GLFW is unavailable.", error);
        }
    }

    @Override
    public void setDecorated(long handle, boolean decorated) {
        invoke(
            "glfwSetWindowAttrib",
            new Class<?>[] {long.class, int.class, int.class},
            handle,
            GLFW_DECORATED,
            decorated ? GLFW_TRUE : GLFW_FALSE
        );
    }

    @Override
    public void setResizable(long handle, boolean resizable) {
        invoke(
            "glfwSetWindowAttrib",
            new Class<?>[] {long.class, int.class, int.class},
            handle,
            GLFW_RESIZABLE,
            resizable ? GLFW_TRUE : GLFW_FALSE
        );
    }

    @Override
    public void minimize(long handle) {
        invoke("glfwIconifyWindow", new Class<?>[] {long.class}, handle);
    }

    @Override
    public void maximize(long handle) {
        invoke("glfwMaximizeWindow", new Class<?>[] {long.class}, handle);
    }

    @Override
    public void restore(long handle) {
        invoke("glfwRestoreWindow", new Class<?>[] {long.class}, handle);
    }

    @Override
    public void requestClose(long handle) {
        invoke(
            "glfwSetWindowShouldClose",
            new Class<?>[] {long.class, boolean.class},
            handle,
            true
        );
    }

    @Override
    public WindowState state(long handle) {
        long monitor = ((Number) invoke(
            "glfwGetWindowMonitor",
            new Class<?>[] {long.class},
            handle
        )).longValue();
        if (monitor != 0L) return WindowState.FULLSCREEN;
        if (windowAttribute(handle, GLFW_ICONIFIED) == GLFW_TRUE) return WindowState.MINIMIZED;
        if (windowAttribute(handle, GLFW_MAXIMIZED) == GLFW_TRUE) return WindowState.MAXIMIZED;
        return WindowState.NORMAL;
    }

    @Override
    public Bounds bounds(long handle) {
        int[] x = new int[1];
        int[] y = new int[1];
        int[] width = new int[1];
        int[] height = new int[1];
        invoke(
            "glfwGetWindowPos",
            new Class<?>[] {long.class, int[].class, int[].class},
            handle,
            x,
            y
        );
        invoke(
            "glfwGetWindowSize",
            new Class<?>[] {long.class, int[].class, int[].class},
            handle,
            width,
            height
        );
        return new Bounds(x[0], y[0], width[0], height[0]);
    }

    @Override
    public void setPosition(long handle, int x, int y) {
        invoke(
            "glfwSetWindowPos",
            new Class<?>[] {long.class, int.class, int.class},
            handle,
            x,
            y
        );
    }

    @Override
    public void setSize(long handle, int width, int height) {
        invoke(
            "glfwSetWindowSize",
            new Class<?>[] {long.class, int.class, int.class},
            handle,
            width,
            height
        );
    }

    @Override
    public Point cursor(long handle) {
        double[] x = new double[1];
        double[] y = new double[1];
        invoke(
            "glfwGetCursorPos",
            new Class<?>[] {long.class, double[].class, double[].class},
            handle,
            x,
            y
        );
        return new Point(x[0], y[0]);
    }

    @Override
    public void setCursorShape(long handle, CursorShape shape) {
        if (shape == activeCursorShape) return;

        long cursorHandle = cursorHandle(shape);
        if (cursorHandle == 0L && isDiagonal(shape)) {
            cursorHandle = cursorHandle(CursorShape.HORIZONTAL_RESIZE);
        }
        invoke(
            "glfwSetCursor",
            new Class<?>[] {long.class, long.class},
            handle,
            cursorHandle
        );
        activeCursorShape = shape;
    }

    @Override
    public boolean isLeftButtonPressed(long handle) {
        int state = ((Number) invoke(
            "glfwGetMouseButton",
            new Class<?>[] {long.class, int.class},
            handle,
            GLFW_MOUSE_BUTTON_LEFT
        )).intValue();
        return state == GLFW_PRESS;
    }

    @Override
    public void installMouseButtonHandler(long handle, MouseButtonHandler handler) {
        try {
            Class<?> callbackType = Class.forName("org.lwjgl.glfw.GLFWMouseButtonCallbackI");
            Object[] previous = new Object[1];
            mouseCallback = Proxy.newProxyInstance(
                callbackType.getClassLoader(),
                new Class<?>[] {callbackType},
                (proxy, method, arguments) -> {
                    if (method.getDeclaringClass() == Object.class) {
                        return objectMethod(proxy, method, arguments);
                    }
                    if (method.isDefault()) {
                        return invokeDefaultMethod(proxy, method, arguments);
                    }
                    if (!method.getName().equals("invoke") || arguments == null) return null;

                    long callbackHandle = ((Number) arguments[0]).longValue();
                    int button = ((Number) arguments[1]).intValue();
                    int action = ((Number) arguments[2]).intValue();
                    int mods = ((Number) arguments[3]).intValue();
                    Point cursor = cursor(callbackHandle);
                    boolean consumed = handler.handle(
                        button,
                        action,
                        mods,
                        cursor.x(),
                        cursor.y()
                    );
                    if (!consumed && previous[0] != null) {
                        method.invoke(previous[0], arguments);
                    }
                    return null;
                }
            );
            Method setter = glfw.getMethod(
                "glfwSetMouseButtonCallback",
                long.class,
                callbackType
            );
            previousMouseCallback = setter.invoke(null, handle, mouseCallback);
            previous[0] = previousMouseCallback;
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("Could not install the GLFW mouse callback.", error);
        }
    }

    @Override
    public boolean supportsNativeResize() {
        return false;
    }

    private long cursorHandle(CursorShape shape) {
        if (shape == CursorShape.DEFAULT) return 0L;
        Long existing = cursors.get(shape);
        if (existing != null) return existing;

        int glfwShape;
        switch (shape) {
            case HORIZONTAL_RESIZE:
                glfwShape = GLFW_HRESIZE_CURSOR;
                break;
            case VERTICAL_RESIZE:
                glfwShape = GLFW_VRESIZE_CURSOR;
                break;
            case DIAGONAL_NW_SE_RESIZE:
                glfwShape = GLFW_RESIZE_NWSE_CURSOR;
                break;
            case DIAGONAL_NE_SW_RESIZE:
                glfwShape = GLFW_RESIZE_NESW_CURSOR;
                break;
            default:
                glfwShape = 0;
                break;
        }
        long created = ((Number) invoke(
            "glfwCreateStandardCursor",
            new Class<?>[] {int.class},
            glfwShape
        )).longValue();
        cursors.put(shape, created);
        return created;
    }

    private static boolean isDiagonal(CursorShape shape) {
        return shape == CursorShape.DIAGONAL_NW_SE_RESIZE
            || shape == CursorShape.DIAGONAL_NE_SW_RESIZE;
    }

    private int windowAttribute(long handle, int attribute) {
        return ((Number) invoke(
            "glfwGetWindowAttrib",
            new Class<?>[] {long.class, int.class},
            handle,
            attribute
        )).intValue();
    }

    private Object invoke(String name, Class<?>[] parameterTypes, Object... arguments) {
        try {
            return glfw.getMethod(name, parameterTypes).invoke(null, arguments);
        } catch (InvocationTargetException error) {
            throw new IllegalStateException(
                "GLFW " + name + " failed.",
                error.getTargetException()
            );
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("GLFW " + name + " is unavailable.", error);
        }
    }

    /**
     * InvocationHandler.invokeDefault only exists from Java 16, and these
     * sources also build the Java 8 legacy jar. Resolving it reflectively keeps
     * one source tree; on an older runtime the default method is simply skipped,
     * which is what happened before this path existed at all.
     */
    private static Object invokeDefaultMethod(Object proxy, Method method, Object[] arguments)
        throws ReflectiveOperationException {
        Method invokeDefault;
        try {
            invokeDefault = InvocationHandler.class.getMethod(
                "invokeDefault", Object.class, Method.class, Object[].class
            );
        } catch (NoSuchMethodException unsupported) {
            return null;
        }
        return invokeDefault.invoke(
            null, proxy, method, arguments == null ? new Object[0] : arguments
        );
    }

    private static Object objectMethod(Object proxy, Method method, Object[] arguments) {
        switch (method.getName()) {
            case "toString":
                return "KizaGlfwMouseButtonCallback";
            case "hashCode":
                return System.identityHashCode(proxy);
            case "equals":
                return proxy == (arguments == null ? null : arguments[0]);
            default:
                return null;
        }
    }
}
