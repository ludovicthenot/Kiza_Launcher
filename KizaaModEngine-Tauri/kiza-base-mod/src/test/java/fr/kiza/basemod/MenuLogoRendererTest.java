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
        Method modernMethod = MenuLogoRenderer.findScaledDrawMethod(
            FakeModernGraphics.class,
            FakeIdentifier.class
        );
        assert modernMethod.getParameterCount() == 13;
        assert MenuLogoRenderer.findFillMethod(FakeGraphics.class).getName().equals("fill");
        assert MenuLogoRenderer.findStringDrawMethod(FakeGraphics.class)
            .getName()
            .equals("drawString");

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

        String previousClientVersion = System.getProperty("kiza.client.version");
        String previousMinecraftVersion = System.getProperty("kiza.minecraft.version");
        try {
            System.setProperty("kiza.client.version", "0.0.245");
            System.setProperty("kiza.minecraft.version", "1.21.11");
            ClientIdentity identity = ClientIdentity.fromSystemProperties();
            assert identity.windowTitle().equals("Kiza Client 1.21.11 (v0.0.245)");

            System.setProperty("kiza.client.version", "../invalid");
            assert ClientIdentity.fromSystemProperties().clientVersion().equals("dev");
        } finally {
            restoreProperty("kiza.client.version", previousClientVersion);
            restoreProperty("kiza.minecraft.version", previousMinecraftVersion);
        }
    }

    public static class FakeScreen {
        public int width = 640;
        public int height = 480;
        public FakeFont font = new FakeFont();
    }

    public static final class FakeInventoryScreen extends FakeScreen {
        {
            height = 300;
        }
    }

    public static final class FakeIdentifier {}
    public static final class FakePipeline {}
    public static final class FakeFont {}

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

        public void fill(int left, int top, int right, int bottom, int color) {}

        public int drawString(
            FakeFont font,
            String text,
            int x,
            int y,
            int color,
            boolean shadow
        ) {
            return text.length();
        }
    }

    public static final class UnsupportedGraphics {
        public void drawTexture(FakeIdentifier identifier, int x, int y) {}
    }

    public static final class FakeModernGraphics {
        public void drawTexture(
            com.mojang.blaze3d.pipeline.RenderPipeline pipeline,
            FakeIdentifier identifier,
            int x,
            int y,
            float u,
            float v,
            int width,
            int height,
            int regionWidth,
            int regionHeight,
            int textureWidth,
            int textureHeight,
            int color
        ) {}
    }

    private static void restoreProperty(String name, String value) {
        if (value == null) System.clearProperty(name);
        else System.setProperty(name, value);
    }
}
