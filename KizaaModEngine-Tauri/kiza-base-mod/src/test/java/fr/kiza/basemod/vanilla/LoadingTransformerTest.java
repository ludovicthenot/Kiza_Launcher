package fr.kiza.basemod.vanilla;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.util.function.IntSupplier;

/**
 * The loading screen's colour, rewritten under the Vanilla agent: loaded for
 * real, so a stack map broken by the insert would fail here, and run, so the
 * colour it draws is seen to be Kiza's.
 */
public final class LoadingTransformerTest {
    private static final String INTERNAL_NAME = "fr/kiza/basemod/vanilla/LoadingTransformerTest$FakeOverlay";

    /** Stands in for LoadingOverlay: a static supplier of its colour, asked while it draws, past a branch. */
    public static final class FakeOverlay {
        private static final IntSupplier BRAND = () -> 0xFFEF323D;
        public static int drawn;
        public static boolean barDrawn;

        public void render(Object graphics, int mouseX, int mouseY, float delta) {
            if (mouseX < 0) {
                drawn = -1;
                return;
            }
            int faded = (BRAND.getAsInt() & 0x00FFFFFF) | 0x80000000;
            drawn = faded;
            drawProgressBar(graphics, 0, 0, 10, 2, 1F);
        }

        private void drawProgressBar(Object graphics, int left, int top, int right, int bottom, float opacity) {
            if (right > left) barDrawn = true;
        }
    }

    private LoadingTransformerTest() {}

    public static void main(String[] args) throws Exception {
        byte[] transformed = new LoadingTransformer(INTERNAL_NAME, "render", "(Ljava/lang/Object;IIF)V",
            "drawProgressBar", "(Ljava/lang/Object;IIIIF)V").inject(bytesOf(FakeOverlay.class));
        Class<?> loaded = load(transformed);
        Method render = loaded.getMethod("render", Object.class, int.class, int.class, float.class);
        render.invoke(loaded.newInstance(), null, 1, 1, 0F);
        int drawn = loaded.getField("drawn").getInt(null);
        assert (drawn & 0xFFFFFF) == 0x0E0B16 : "Kiza's colour, not Mojang's red: " + Integer.toHexString(drawn);
        assert (drawn >>> 24) == 0x80 : "the alpha the screen asked for is kept";
        render.invoke(loaded.newInstance(), null, -1, 0, 0F);
        assert loaded.getField("drawn").getInt(null) == -1 : "the early return still returns";
        assert !loaded.getField("barDrawn").getBoolean(null) : "Minecraft's bar is skipped while Kiza draws its own";
        boolean wrapped = false;
        for (Method method : loaded.getDeclaredMethods()) wrapped |= method.getName().equals("kiza$render");
        assert wrapped : "the drawing is moved aside and wrapped, not edited";

        boolean refused = false;
        try {
            new LoadingTransformer("x/Y").inject(bytesOf(LoadingTransformerTest.class));
        } catch (IllegalStateException expected) {
            refused = true;
        }
        assert refused : "a class with no colour read is left alone, not half-patched";
        System.out.println("LoadingTransformerTest OK");
    }

    private static byte[] bytesOf(Class<?> type) throws Exception {
        try (InputStream stream = type.getClassLoader().getResourceAsStream(type.getName().replace('.', '/') + ".class")) {
            if (stream == null) throw new IllegalStateException("no class file for " + type);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            for (int read = stream.read(chunk); read > 0; read = stream.read(chunk)) out.write(chunk, 0, read);
            return out.toByteArray();
        }
    }

    /** Defines the transformed class itself and leaves everything else to the usual loader. */
    private static Class<?> load(final byte[] classFile) throws Exception {
        final String name = INTERNAL_NAME.replace('/', '.');
        ClassLoader loader = new ClassLoader(LoadingTransformerTest.class.getClassLoader()) {
            private Class<?> defined;

            @Override
            protected Class<?> loadClass(String requested, boolean resolve) throws ClassNotFoundException {
                if (!requested.equals(name)) return super.loadClass(requested, resolve);
                if (defined == null) defined = defineClass(name, classFile, 0, classFile.length);
                if (resolve) resolveClass(defined);
                return defined;
            }
        };
        return loader.loadClass(name);
    }
}
