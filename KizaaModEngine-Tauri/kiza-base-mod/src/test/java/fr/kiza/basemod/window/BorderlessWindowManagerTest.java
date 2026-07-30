package fr.kiza.basemod.window;

public final class BorderlessWindowManagerTest {
    private BorderlessWindowManagerTest() {}

    public static void main(String[] args) {
        assert CustomTitleBar.hitTest(20, 10, 800) == CustomTitleBar.Target.DRAG;
        assert CustomTitleBar.hitTest(700, 10, 800) == CustomTitleBar.Target.MINIMIZE;
        assert CustomTitleBar.hitTest(738, 10, 800)
            == CustomTitleBar.Target.MAXIMIZE_RESTORE;
        assert CustomTitleBar.hitTest(776, 10, 800) == CustomTitleBar.Target.CLOSE;
        assert CustomTitleBar.hitTest(755, 10, 800) == CustomTitleBar.Target.DRAG;
        assert CustomTitleBar.hitTest(780, 40, 800) == CustomTitleBar.Target.NONE;

        assert BorderlessWindowManager.cursorShapeForEdges(0)
            == WindowPlatform.CursorShape.DEFAULT;
        assert BorderlessWindowManager.cursorShapeForEdges(1)
            == WindowPlatform.CursorShape.HORIZONTAL_RESIZE;
        assert BorderlessWindowManager.cursorShapeForEdges(4)
            == WindowPlatform.CursorShape.VERTICAL_RESIZE;
        assert BorderlessWindowManager.cursorShapeForEdges(1 | 4)
            == WindowPlatform.CursorShape.DIAGONAL_NW_SE_RESIZE;
        assert BorderlessWindowManager.cursorShapeForEdges(2 | 4)
            == WindowPlatform.CursorShape.DIAGONAL_NE_SW_RESIZE;

        WindowPlatform.Bounds start = new WindowPlatform.Bounds(100, 100, 800, 600);
        WindowPlatform.Bounds resized = BorderlessWindowManager.resizedBounds(
            start,
            1 | 4,
            120,
            80
        );
        assert resized.x() == 220;
        assert resized.y() == 180;
        assert resized.width() == 680;
        assert resized.height() == 520;

        WindowPlatform.Bounds clamped = BorderlessWindowManager.resizedBounds(
            start,
            1 | 4,
            400,
            400
        );
        assert clamped.width() == 640;
        assert clamped.height() == 360;
        assert clamped.x() == 260;
        assert clamped.y() == 340;
    }
}
