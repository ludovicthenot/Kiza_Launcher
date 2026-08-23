package fr.kiza.basemod.window;

interface WindowPlatform {
    enum CursorShape {
        DEFAULT,
        HORIZONTAL_RESIZE,
        VERTICAL_RESIZE,
        DIAGONAL_NW_SE_RESIZE,
        DIAGONAL_NE_SW_RESIZE
    }

    final class Point {
        private final double x;
        private final double y;

        Point(double x, double y) {
            this.x = x;
            this.y = y;
        }

        double x() {
            return x;
        }

        double y() {
            return y;
        }
    }

    final class Bounds {
        private final int x;
        private final int y;
        private final int width;
        private final int height;

        Bounds(int x, int y, int width, int height) {
            this.x = x;
            this.y = y;
            this.width = width;
            this.height = height;
        }

        int x() {
            return x;
        }

        int y() {
            return y;
        }

        int width() {
            return width;
        }

        int height() {
            return height;
        }
    }

    @FunctionalInterface
    interface MouseButtonHandler {
        boolean handle(int button, int action, int mods, double cursorX, double cursorY);
    }

    void setDecorated(long handle, boolean decorated);

    void setResizable(long handle, boolean resizable);

    void minimize(long handle);

    void maximize(long handle);

    void restore(long handle);

    void requestClose(long handle);

    WindowState state(long handle);

    Bounds bounds(long handle);

    void setPosition(long handle, int x, int y);

    void setSize(long handle, int width, int height);

    default void setBounds(long handle, Bounds bounds) {
        setPosition(handle, bounds.x(), bounds.y());
        setSize(handle, bounds.width(), bounds.height());
    }

    Point cursor(long handle);

    void setCursorShape(long handle, CursorShape shape);

    boolean isLeftButtonPressed(long handle);

    void installMouseButtonHandler(long handle, MouseButtonHandler handler);

    boolean supportsNativeResize();
}
