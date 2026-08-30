package fr.kiza.basemod.window;

import fr.kiza.basemod.WindowTitleManager;

public final class BorderlessWindowManager {
    private static final BorderlessWindowManager INSTANCE = new BorderlessWindowManager();
    private static final int MIN_WIDTH = 640;
    private static final int MIN_HEIGHT = 360;
    private static final int RESIZE_EDGE_PX = 8;
    private static final long DOUBLE_CLICK_MS = 350L;
    private static final double DOUBLE_CLICK_DISTANCE = 6.0D;

    private enum Interaction {
        NONE,
        DRAG,
        RESIZE
    }

    private static final int EDGE_LEFT = 1;
    private static final int EDGE_RIGHT = 2;
    private static final int EDGE_TOP = 4;
    private static final int EDGE_BOTTOM = 8;

    private boolean requested;
    private boolean active;
    private boolean activationFailed;
    private long handle;
    private WindowPlatform platform;
    private WindowState state = WindowState.NORMAL;
    private WindowPlatform.Bounds normalBounds;
    private int guiWidth;
    private int guiHeight;
    private double cursorGuiX;
    private double cursorGuiY;
    private Interaction interaction = Interaction.NONE;
    private int resizeEdges;
    private WindowPlatform.Bounds interactionStartBounds;
    private double interactionStartScreenX;
    private double interactionStartScreenY;
    private long lastTitleClickAt;
    private double lastTitleClickX;
    private double lastTitleClickY;
    private boolean consumeMouseRelease;

    private BorderlessWindowManager() {}

    public static void install() {
        INSTANCE.requested = true;
    }

    public static BorderlessWindowManager instance() {
        return INSTANCE;
    }

    public void onFrame(int guiWidth, int guiHeight) {
        if (!requested || guiWidth <= 0 || guiHeight <= 0) return;
        this.guiWidth = guiWidth;
        this.guiHeight = guiHeight;

        if (!active && !activationFailed) activate();
        if (!active) return;

        state = platform.state(handle);
        updateCursor();
        if (state == WindowState.FULLSCREEN || state == WindowState.MINIMIZED) {
            interaction = Interaction.NONE;
            platform.setCursorShape(handle, WindowPlatform.CursorShape.DEFAULT);
            return;
        }
        if (interaction != Interaction.NONE) updateInteraction();
        if (state == WindowState.NORMAL && interaction == Interaction.NONE) {
            normalBounds = platform.bounds(handle);
        }
    }

    public boolean isTitleBarVisible() {
        return active && state != WindowState.FULLSCREEN && state != WindowState.MINIMIZED;
    }

    public boolean isMaximized() {
        return state == WindowState.MAXIMIZED;
    }

    public CustomTitleBar.Target hoverTarget() {
        if (!isTitleBarVisible()) return CustomTitleBar.Target.NONE;
        return CustomTitleBar.hitTest(cursorGuiX, cursorGuiY, guiWidth);
    }

    private void activate() {
        try {
            handle = WindowTitleManager.currentHandle();
            if (handle == 0L) return;
            platform = createPlatform();
            WindowPlatform.Bounds original = platform.bounds(handle);
            platform.setDecorated(handle, false);
            platform.setResizable(handle, true);
            platform.setBounds(handle, original);
            platform.installMouseButtonHandler(handle, this::handleMouseButton);
            normalBounds = original;
            state = platform.state(handle);
            active = true;
            System.out.println(
                "[Kiza Launcher/Window] Borderless Minecraft window manager ready."
            );
        } catch (ReflectiveOperationException | RuntimeException error) {
            activationFailed = true;
            Throwable cause = error;
            while (cause.getCause() != null && cause.getCause() != cause) {
                cause = cause.getCause();
            }
            String message = cause.getMessage();
            System.err.println(
                "[Kiza Launcher/Window] Borderless mode is unavailable: "
                    + cause.getClass().getSimpleName()
                    + (message == null || message.trim().isEmpty() ? "" : " - " + message)
            );
        }
    }

    private WindowPlatform createPlatform() {
        String osName = System.getProperty("os.name", "").toLowerCase();
        return osName.contains("win")
            ? new WindowsNativeWindowPlatform()
            : new GlfwWindowPlatform();
    }

    private boolean handleMouseButton(
        int button,
        int action,
        int mods,
        double cursorX,
        double cursorY
    ) {
        if (!active || state == WindowState.FULLSCREEN) return false;
        updateGuiCursor(cursorX, cursorY);

        boolean wasInteracting = interaction != Interaction.NONE;
        if (button == GlfwWindowPlatform.GLFW_MOUSE_BUTTON_LEFT
            && action != GlfwWindowPlatform.GLFW_PRESS) {
            interaction = Interaction.NONE;
            resizeEdges = 0;
            boolean consumed = consumeMouseRelease
                || wasInteracting
                || CustomTitleBar.isInside(cursorGuiY);
            consumeMouseRelease = false;
            return consumed;
        }
        if (button != GlfwWindowPlatform.GLFW_MOUSE_BUTTON_LEFT) {
            return CustomTitleBar.isInside(cursorGuiY);
        }

        if (state == WindowState.NORMAL) {
            int edges = resizeEdges(cursorX, cursorY, platform.bounds(handle));
            if (edges != 0) {
                beginInteraction(Interaction.RESIZE, edges, cursorX, cursorY);
                consumeMouseRelease = true;
                return true;
            }
        }

        CustomTitleBar.Target target = CustomTitleBar.hitTest(
            cursorGuiX,
            cursorGuiY,
            guiWidth
        );
        boolean consumed;
        switch (target) {
            case MINIMIZE:
                platform.minimize(handle);
                consumed = true;
                break;
            case MAXIMIZE_RESTORE:
                toggleMaximize();
                consumed = true;
                break;
            case CLOSE:
                platform.requestClose(handle);
                consumed = true;
                break;
            case DRAG:
                handleTitleDragPress(cursorX, cursorY);
                consumed = true;
                break;
            default:
                consumed = false;
                break;
        }
        consumeMouseRelease = consumed;
        return consumed;
    }

    private void handleTitleDragPress(double cursorX, double cursorY) {
        long now = System.currentTimeMillis();
        double deltaX = cursorX - lastTitleClickX;
        double deltaY = cursorY - lastTitleClickY;
        if (now - lastTitleClickAt <= DOUBLE_CLICK_MS
            && Math.hypot(deltaX, deltaY) <= DOUBLE_CLICK_DISTANCE) {
            lastTitleClickAt = 0L;
            interaction = Interaction.NONE;
            toggleMaximize();
            return;
        }
        lastTitleClickAt = now;
        lastTitleClickX = cursorX;
        lastTitleClickY = cursorY;

        WindowPlatform.Bounds bounds = platform.bounds(handle);
        double screenX = bounds.x() + cursorX;
        double screenY = bounds.y() + cursorY;
        if (state == WindowState.MAXIMIZED) {
            double horizontalRatio = bounds.width() <= 0
                ? 0.5D
                : Math.max(0.0D, Math.min(1.0D, cursorX / bounds.width()));
            platform.restore(handle);
            WindowPlatform.Bounds restored = normalBounds != null
                ? normalBounds
                : platform.bounds(handle);
            int targetX = (int) Math.round(screenX - restored.width() * horizontalRatio);
            int targetY = (int) Math.round(screenY - CustomTitleBar.HEIGHT / 2.0D);
            bounds = new WindowPlatform.Bounds(
                targetX,
                targetY,
                restored.width(),
                restored.height()
            );
            platform.setBounds(handle, bounds);
            state = WindowState.NORMAL;
        }
        interaction = Interaction.DRAG;
        interactionStartBounds = bounds;
        interactionStartScreenX = screenX;
        interactionStartScreenY = screenY;
    }

    private void beginInteraction(
        Interaction next,
        int edges,
        double cursorX,
        double cursorY
    ) {
        interaction = next;
        resizeEdges = edges;
        interactionStartBounds = platform.bounds(handle);
        interactionStartScreenX = interactionStartBounds.x() + cursorX;
        interactionStartScreenY = interactionStartBounds.y() + cursorY;
    }

    private void updateInteraction() {
        if (!platform.isLeftButtonPressed(handle)) {
            interaction = Interaction.NONE;
            resizeEdges = 0;
            return;
        }

        WindowPlatform.Bounds current = platform.bounds(handle);
        WindowPlatform.Point cursor = platform.cursor(handle);
        double screenX = current.x() + cursor.x();
        double screenY = current.y() + cursor.y();
        int deltaX = (int) Math.round(screenX - interactionStartScreenX);
        int deltaY = (int) Math.round(screenY - interactionStartScreenY);

        if (interaction == Interaction.DRAG) {
            platform.setPosition(
                handle,
                interactionStartBounds.x() + deltaX,
                interactionStartBounds.y() + deltaY
            );
            return;
        }
        if (interaction == Interaction.RESIZE) {
            platform.setBounds(
                handle,
                resizedBounds(interactionStartBounds, resizeEdges, deltaX, deltaY)
            );
        }
    }

    static WindowPlatform.Bounds resizedBounds(
        WindowPlatform.Bounds start,
        int edges,
        int deltaX,
        int deltaY
    ) {
        int x = start.x();
        int y = start.y();
        int width = start.width();
        int height = start.height();

        if ((edges & EDGE_LEFT) != 0) {
            int proposed = Math.max(MIN_WIDTH, start.width() - deltaX);
            x = start.x() + start.width() - proposed;
            width = proposed;
        } else if ((edges & EDGE_RIGHT) != 0) {
            width = Math.max(MIN_WIDTH, start.width() + deltaX);
        }
        if ((edges & EDGE_TOP) != 0) {
            int proposed = Math.max(MIN_HEIGHT, start.height() - deltaY);
            y = start.y() + start.height() - proposed;
            height = proposed;
        } else if ((edges & EDGE_BOTTOM) != 0) {
            height = Math.max(MIN_HEIGHT, start.height() + deltaY);
        }
        return new WindowPlatform.Bounds(x, y, width, height);
    }

    private int resizeEdges(
        double cursorX,
        double cursorY,
        WindowPlatform.Bounds bounds
    ) {
        if (cursorX < -RESIZE_EDGE_PX
            || cursorY < -RESIZE_EDGE_PX
            || cursorX > bounds.width() + RESIZE_EDGE_PX
            || cursorY > bounds.height() + RESIZE_EDGE_PX) {
            return 0;
        }

        int edges = 0;
        if (cursorX <= RESIZE_EDGE_PX) edges |= EDGE_LEFT;
        else if (cursorX >= bounds.width() - RESIZE_EDGE_PX) edges |= EDGE_RIGHT;
        if (cursorY <= RESIZE_EDGE_PX) edges |= EDGE_TOP;
        else if (cursorY >= bounds.height() - RESIZE_EDGE_PX) edges |= EDGE_BOTTOM;
        return edges;
    }

    static WindowPlatform.CursorShape cursorShapeForEdges(int edges) {
        boolean left = (edges & EDGE_LEFT) != 0;
        boolean right = (edges & EDGE_RIGHT) != 0;
        boolean top = (edges & EDGE_TOP) != 0;
        boolean bottom = (edges & EDGE_BOTTOM) != 0;

        if ((left && top) || (right && bottom)) {
            return WindowPlatform.CursorShape.DIAGONAL_NW_SE_RESIZE;
        }
        if ((right && top) || (left && bottom)) {
            return WindowPlatform.CursorShape.DIAGONAL_NE_SW_RESIZE;
        }
        if (left || right) return WindowPlatform.CursorShape.HORIZONTAL_RESIZE;
        if (top || bottom) return WindowPlatform.CursorShape.VERTICAL_RESIZE;
        return WindowPlatform.CursorShape.DEFAULT;
    }

    private void toggleMaximize() {
        if (state == WindowState.MAXIMIZED) {
            platform.restore(handle);
            state = WindowState.NORMAL;
        } else {
            if (state == WindowState.NORMAL) normalBounds = platform.bounds(handle);
            platform.maximize(handle);
            state = WindowState.MAXIMIZED;
        }
        interaction = Interaction.NONE;
    }

    private void updateCursor() {
        WindowPlatform.Point cursor = platform.cursor(handle);
        updateGuiCursor(cursor.x(), cursor.y());

        int edges = 0;
        if (state == WindowState.NORMAL) {
            if (interaction == Interaction.RESIZE) {
                edges = resizeEdges;
            } else if (interaction == Interaction.NONE) {
                edges = resizeEdges(cursor.x(), cursor.y(), platform.bounds(handle));
            }
        }
        platform.setCursorShape(handle, cursorShapeForEdges(edges));
    }

    private void updateGuiCursor(double cursorX, double cursorY) {
        WindowPlatform.Bounds bounds = platform.bounds(handle);
        if (bounds.width() <= 0 || bounds.height() <= 0) return;
        cursorGuiX = cursorX * guiWidth / bounds.width();
        cursorGuiY = cursorY * guiHeight / bounds.height();
    }
}
