package fr.kiza.basemod.window;

import fr.kiza.basemod.MenuLogoRenderer;

public final class CustomTitleBar {
    public static final int HEIGHT = 32;
    private static final int BUTTON_WIDTH = 34;
    private static final int BUTTON_HEIGHT = 24;
    private static final int BUTTON_GAP = 4;
    private static final int BUTTON_MARGIN = 7;
    private static final int BUTTON_TOP = 4;
    private static final int COLOR_TEXT = 0xFFF4F1FF;
    private static final int COLOR_MUTED = 0xFFAAA5BA;
    private static final int COLOR_BUTTON = 0xA6000000;
    private static final int COLOR_HOVER = 0xD90D0A14;
    private static final int COLOR_CLOSE_HOVER = 0xD9A62939;

    public enum Target {
        NONE,
        DRAG,
        MINIMIZE,
        MAXIMIZE_RESTORE,
        CLOSE
    }

    private CustomTitleBar() {}

    public static void render(Object graphics, Object screen, int width, int height) {
        BorderlessWindowManager manager = BorderlessWindowManager.instance();
        manager.onFrame(width, height);
        if (!manager.isTitleBarVisible()) return;

        Target hover = manager.hoverTarget();
        int closeLeft = width - BUTTON_MARGIN - BUTTON_WIDTH;
        int maximizeLeft = closeLeft - BUTTON_GAP - BUTTON_WIDTH;
        int minimizeLeft = maximizeLeft - BUTTON_GAP - BUTTON_WIDTH;

        drawButtonBackground(
            graphics,
            minimizeLeft,
            hover == Target.MINIMIZE,
            false
        );
        drawButtonBackground(
            graphics,
            maximizeLeft,
            hover == Target.MAXIMIZE_RESTORE,
            false
        );
        drawButtonBackground(graphics, closeLeft, hover == Target.CLOSE, true);

        drawMinimize(graphics, minimizeLeft, hover == Target.MINIMIZE);
        drawMaximize(
            graphics,
            maximizeLeft,
            hover == Target.MAXIMIZE_RESTORE
        );
        drawClose(graphics, closeLeft, hover == Target.CLOSE);
    }

    public static Target hitTest(double x, double y, int width) {
        if (!isInside(y) || x < 0 || x >= width) return Target.NONE;
        if (y < BUTTON_TOP || y >= BUTTON_TOP + BUTTON_HEIGHT) return Target.DRAG;

        int closeLeft = width - BUTTON_MARGIN - BUTTON_WIDTH;
        int maximizeLeft = closeLeft - BUTTON_GAP - BUTTON_WIDTH;
        int minimizeLeft = maximizeLeft - BUTTON_GAP - BUTTON_WIDTH;
        if (x >= closeLeft && x < closeLeft + BUTTON_WIDTH) return Target.CLOSE;
        if (x >= maximizeLeft && x < maximizeLeft + BUTTON_WIDTH) {
            return Target.MAXIMIZE_RESTORE;
        }
        if (x >= minimizeLeft && x < minimizeLeft + BUTTON_WIDTH) {
            return Target.MINIMIZE;
        }
        return Target.DRAG;
    }

    public static boolean isInside(double y) {
        return y >= 0 && y < HEIGHT;
    }

    private static void drawButtonBackground(
        Object graphics,
        int left,
        boolean hovered,
        boolean close
    ) {
        MenuLogoRenderer.roundedFill(
            graphics,
            left,
            BUTTON_TOP,
            left + BUTTON_WIDTH,
            BUTTON_TOP + BUTTON_HEIGHT,
            5,
            hovered
                ? close ? COLOR_CLOSE_HOVER : COLOR_HOVER
                : COLOR_BUTTON
        );
    }

    private static void drawMinimize(
        Object graphics,
        int left,
        boolean hovered
    ) {
        MenuLogoRenderer.fill(
            graphics,
            left + 12,
            16,
            left + 22,
            17,
            hovered ? COLOR_TEXT : COLOR_MUTED
        );
    }

    private static void drawMaximize(
        Object graphics,
        int left,
        boolean hovered
    ) {
        int color = hovered ? COLOR_TEXT : COLOR_MUTED;
        MenuLogoRenderer.fill(graphics, left + 11, 10, left + 15, 11, color);
        MenuLogoRenderer.fill(graphics, left + 11, 10, left + 12, 14, color);
        MenuLogoRenderer.fill(graphics, left + 19, 10, left + 23, 11, color);
        MenuLogoRenderer.fill(graphics, left + 22, 10, left + 23, 14, color);
        MenuLogoRenderer.fill(graphics, left + 11, 20, left + 15, 21, color);
        MenuLogoRenderer.fill(graphics, left + 11, 17, left + 12, 21, color);
        MenuLogoRenderer.fill(graphics, left + 19, 20, left + 23, 21, color);
        MenuLogoRenderer.fill(graphics, left + 22, 17, left + 23, 21, color);
    }

    private static void drawClose(
        Object graphics,
        int left,
        boolean hovered
    ) {
        int color = hovered ? COLOR_TEXT : COLOR_MUTED;
        for (int offset = 0; offset < 9; offset += 1) {
            MenuLogoRenderer.fill(
                graphics,
                left + 13 + offset,
                12 + offset,
                left + 14 + offset,
                13 + offset,
                color
            );
            MenuLogoRenderer.fill(
                graphics,
                left + 21 - offset,
                12 + offset,
                left + 22 - offset,
                13 + offset,
                color
            );
        }
    }
}
