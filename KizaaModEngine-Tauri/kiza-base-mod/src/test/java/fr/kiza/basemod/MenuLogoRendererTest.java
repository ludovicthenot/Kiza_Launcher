package fr.kiza.basemod;

import java.lang.reflect.Method;

public final class MenuLogoRendererTest {
    private MenuLogoRendererTest() {}

    public static void main(String[] args) throws Exception {
        Method method = MenuLogoRenderer.findScaledDrawMethod(
            FakeGraphics.class,
            FakeIdentifier.class
        );
        assert method.getName().equals("drawTexture");

        try {
            MenuLogoRenderer.findScaledDrawMethod(UnsupportedGraphics.class, FakeIdentifier.class);
            throw new AssertionError("An incompatible draw method must be rejected");
        } catch (NoSuchMethodException expected) {
            // Expected.
        }

        // Screen height is read by field name, walking up the class hierarchy.
        assert MenuLogoRenderer.screenHeight(new FakeScreen()) == 480;
        assert MenuLogoRenderer.screenHeight(new FakeInventoryScreen()) == 300;
        assert MenuLogoRenderer.screenHeight(null) == 0;
    }

    public static class FakeScreen {
        public int width = 640;
        public int height = 480;
    }

    public static final class FakeInventoryScreen extends FakeScreen {
        {
            height = 300;
        }
    }

    public static final class FakeIdentifier {}

    public static final class FakeGraphics {
        public void drawTexture(
            FakeIdentifier identifier,
            int x,
            int y,
            int width,
            int height,
            float u,
            float v,
            int regionWidth,
            int regionHeight,
            int textureWidth,
            int textureHeight
        ) {}
    }

    public static final class UnsupportedGraphics {
        public void drawTexture(FakeIdentifier identifier, int x, int y) {}
    }
}
