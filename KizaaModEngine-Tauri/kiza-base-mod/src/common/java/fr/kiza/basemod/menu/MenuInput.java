package fr.kiza.basemod.menu;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;

/**
 * The mouse, the wheel, Escape and files dropped on the window, for what Kiza
 * draws on the title screen that Minecraft does not know is there: the
 * settings button and the settings panel.
 *
 * <p>Everything else Kiza draws sits over one of Minecraft's own widgets, which
 * handles the click. These two have no widget under them, so Kiza listens to
 * the window itself. Each GLFW callback is put in front of the one Minecraft
 * installed and hands it every event Kiza does not keep -- so with the panel
 * shut, the only click Kiza takes is the one on its own button.
 *
 * <p>Reached the same way on every loader and every version from 1.13, where
 * the game moved to GLFW: it is the window, not the game, being listened to.
 * Before 1.13 there is no GLFW, and the settings button is not drawn.
 */
public final class MenuInput {
    private MenuInput() {}

    private static final int GLFW_PRESS = 1;
    private static final int GLFW_RELEASE = 0;

    private static Class<?> glfw;
    private static boolean tried;
    private static boolean available;
    private static long window;

    /** When the title screen was last drawn, and at what size in GUI pixels. */
    private static volatile long lastFrame;
    private static volatile int guiWidth;
    private static volatile int guiHeight;

    /** Tests only: draw the settings as if there were a window to listen to. */
    public static void previewMode() {
        tried = true;
        available = true;
    }

    /**
     * Whether somebody is moving through the screen with the keyboard: true
     * after Tab or an arrow key, false again at the next click. Read for the
     * focus outline, which Minecraft only shows in that case.
     */
    private static volatile boolean keyboard;

    public static boolean keyboardNavigation() {
        return keyboard;
    }

    /** Whether Kiza can listen to this window at all. */
    public static boolean available() {
        return available;
    }

    /** Called by the title screen every frame it is drawn. */
    public static void frame(int width, int height) {
        guiWidth = width;
        guiHeight = height;
        lastFrame = System.nanoTime();
        if (!tried) install();
    }

    /** Whether the title screen is the one on show: drawn in the last quarter second. */
    static boolean onTitle() {
        return System.nanoTime() - lastFrame < 250_000_000L;
    }

    /** The pointer, in GUI pixels, or null without a window to ask. */
    public static double[] pointer() {
        if (!available) return null;
        try {
            double[] x = new double[1];
            double[] y = new double[1];
            glfw.getMethod("glfwGetCursorPos", long.class, double[].class, double[].class).invoke(null, window, x, y);
            return toGui(x[0], y[0]);
        } catch (ReflectiveOperationException | RuntimeException error) {
            return null;
        }
    }

    /** Whether the left button is down right now -- for dragging a slider. */
    public static boolean leftDown() {
        if (!available) return false;
        try {
            Object state = glfw.getMethod("glfwGetMouseButton", long.class, int.class).invoke(null, window, 0);
            return state instanceof Number && ((Number) state).intValue() == GLFW_PRESS;
        } catch (ReflectiveOperationException | RuntimeException error) {
            return false;
        }
    }

    private static double[] toGui(double x, double y) throws ReflectiveOperationException {
        int[] w = new int[1];
        int[] h = new int[1];
        glfw.getMethod("glfwGetWindowSize", long.class, int[].class, int[].class).invoke(null, window, w, h);
        if (w[0] <= 0 || h[0] <= 0 || guiWidth <= 0 || guiHeight <= 0) return null;
        return new double[] {x * guiWidth / w[0], y * guiHeight / h[0]};
    }

    private static void install() {
        tried = true;
        try {
            glfw = Class.forName("org.lwjgl.glfw.GLFW");
            Object current = glfw.getMethod("glfwGetCurrentContext").invoke(null);
            window = current instanceof Number ? ((Number) current).longValue() : 0L;
            if (window == 0L) return;
            chain("org.lwjgl.glfw.GLFWMouseButtonCallbackI", "glfwSetMouseButtonCallback", new Handler() {
                @Override
                public boolean handle(Object[] arguments) throws Exception {
                    int button = ((Number) arguments[1]).intValue();
                    int action = ((Number) arguments[2]).intValue();
                    if (action == GLFW_PRESS) keyboard = false;
                    if (!onTitle()) return SettingsPanel.leftTitle();
                    double[] at = pointer();
                    if (at == null) return false;
                    return SettingsPanel.mouse(button, action == GLFW_PRESS, action == GLFW_RELEASE, at[0], at[1]);
                }
            });
            chain("org.lwjgl.glfw.GLFWScrollCallbackI", "glfwSetScrollCallback", new Handler() {
                @Override
                public boolean handle(Object[] arguments) {
                    if (!onTitle()) return SettingsPanel.leftTitle();
                    return SettingsPanel.scroll(((Number) arguments[2]).doubleValue());
                }
            });
            chain("org.lwjgl.glfw.GLFWKeyCallbackI", "glfwSetKeyCallback", new Handler() {
                @Override
                public boolean handle(Object[] arguments) {
                    int key = ((Number) arguments[1]).intValue();
                    // Tab, and the four arrows: GLFW 258 and 262-265.
                    if (((Number) arguments[3]).intValue() == GLFW_PRESS && (key == 258 || (key >= 262 && key <= 265))) {
                        keyboard = true;
                    }
                    if (!onTitle()) return SettingsPanel.leftTitle();
                    return SettingsPanel.key(key, ((Number) arguments[3]).intValue() == GLFW_PRESS);
                }
            });
            chain("org.lwjgl.glfw.GLFWDropCallbackI", "glfwSetDropCallback", new Handler() {
                @Override
                public boolean handle(Object[] arguments) throws Exception {
                    if (!onTitle()) return SettingsPanel.leftTitle();
                    int count = ((Number) arguments[1]).intValue();
                    long names = ((Number) arguments[2]).longValue();
                    Method name = Class.forName("org.lwjgl.glfw.GLFWDropCallback").getMethod("getName", long.class, int.class);
                    String[] paths = new String[count];
                    for (int index = 0; index < count; index += 1) {
                        paths[index] = (String) name.invoke(null, names, index);
                    }
                    return SettingsPanel.drop(paths);
                }
            });
            available = true;
        } catch (Throwable unavailable) {
            // Before 1.13, or a window this cannot reach: no settings button.
            available = false;
        }
    }

    /** What Kiza does with one event; true keeps it from Minecraft. */
    private interface Handler {
        boolean handle(Object[] arguments) throws Exception;
    }

    /**
     * Puts {@code handler} in front of the callback Minecraft set.
     *
     * <p>The callback interfaces are LWJGL's, with default methods LWJGL itself
     * calls to build the native closure; those are passed through as defaults,
     * which needs Java 16's {@code InvocationHandler.invokeDefault} -- what every
     * Minecraft from 1.17 runs on. Anything older keeps Minecraft's callback.
     */
    private static void chain(String interfaceName, String setterName, final Handler handler) throws Exception {
        final Class<?> type = Class.forName(interfaceName);
        final Object[] previous = new Object[1];
        Object proxy = Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] {type}, new InvocationHandler() {
            @Override
            public Object invoke(Object self, Method method, Object[] arguments) throws Throwable {
                if (method.getDeclaringClass() == Object.class) {
                    if (method.getName().equals("hashCode")) return System.identityHashCode(self);
                    if (method.getName().equals("equals")) return self == (arguments == null ? null : arguments[0]);
                    return "KizaMenuInput";
                }
                if (method.isDefault()) {
                    Method invokeDefault = InvocationHandler.class.getMethod(
                        "invokeDefault", Object.class, Method.class, Object[].class
                    );
                    return invokeDefault.invoke(null, self, method, arguments == null ? new Object[0] : arguments);
                }
                if (!method.getName().equals("invoke") || arguments == null) return null;
                boolean kept = false;
                try {
                    kept = handler.handle(arguments);
                } catch (Throwable failure) {
                    // A fault in Kiza's handling must never swallow the game's input.
                    kept = false;
                }
                if (!kept && previous[0] != null) method.invoke(previous[0], arguments);
                return null;
            }
        });
        Method setter = glfw.getMethod(setterName, long.class, type);
        previous[0] = setter.invoke(null, window, proxy);
    }
}
