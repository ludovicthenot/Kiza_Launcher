package fr.kiza.basemod.vanilla;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.reflect.Method;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

/**
 * Rewriting the game's screen renderer without breaking it.
 *
 * <p>The failure this guards against does not look like a bug in the usual
 * sense. Inserting instructions shifts every offset after them, and a class
 * whose stack map no longer matches its code is not a class that misbehaves --
 * it is one the JVM refuses to load at all, with a {@code VerifyError}, on
 * somebody else's computer, for a version of Minecraft nobody here has.
 *
 * <p>So the test loads what the transformer produced. Verification happens at
 * load, which means a broken frame fails here rather than there.
 */
public final class ScreenTransformerTest {

    /**
     * Stands in for {@code Screen}. The signature is the one Minecraft has --
     * receiver, graphics, two ints, a float -- and the early return is
     * deliberate: it puts a branch and therefore a stack map in the method, so
     * the transformer is tested against the thing that actually breaks.
     */
    public static final class FakeScreen {
        public static int rendered;

        /** Minecraft's own render walks a list like this one. */
        private final java.util.List<Object> widgets =
            java.util.Arrays.asList((Object) "a", (Object) "b", (Object) "c");

        public static boolean blurred;

        /** Stands in for renderBlurredBackground: expensive, and skippable. */
        public void renderBlurredBackground(float delta) {
            blurred = true;
        }

        public void render(Object graphics, int mouseX, int mouseY, float delta) {
            if (mouseX < 0) {
                rendered = -1;
                return;
            }
            // A for-each over a list, on purpose, and not a counted loop.
            //
            // This is the shape that breaks. It compiles to an iterator held in
            // a local slot that exists only inside the loop, so the frame at
            // the loop's exit is one that drops locals -- and it is stored as a
            // delta from the frame before it. Copy those deltas past inserted
            // instructions and the exit frame ends up describing a method with
            // no locals at all, which is a VerifyError at class load. A counted
            // loop over ints does not produce it, and a fixture with one is a
            // test that passes while the real Screen throws.
            int total = 0;
            for (Object widget : widgets) {
                total += widget.hashCode() & 1;
            }
            rendered = mouseX + mouseY + total;
        }
    }

    private static final String INTERNAL_NAME =
        "fr/kiza/basemod/vanilla/ScreenTransformerTest$FakeScreen";
    private static final String DESCRIPTOR = "(Ljava/lang/Object;IIF)V";

    public static void main(String[] args) throws Exception {
        byte[] original = bytesOf(FakeScreen.class);
        ScreenTransformer transformer =
            new ScreenTransformer(INTERNAL_NAME, "render", DESCRIPTOR);
        byte[] transformed = transformer.inject(original);

        theInjectedClassStillVerifies(transformed);
        bothHooksAreCalled(transformed);
        theOriginalBodyIsMovedNotRewritten(original, transformed);
        onlyTheNamedMethodIsTouched(original, transformer);
        theBlurIsLeftAloneUnlessAsked(original, transformed);
        theBlurIsEmptiedWhenAsked(original);

        System.out.println("ScreenTransformerTest OK");
    }

    /**
     * The load itself is the assertion. A stack map that no longer describes
     * the code throws VerifyError here, and nothing else in this file would
     * have noticed.
     */
    private static void theInjectedClassStillVerifies(byte[] transformed) throws Exception {
        Class<?> loaded = load(transformed);
        Method render = loaded.getMethod("render", Object.class, int.class, int.class, float.class);
        // Called for real. Both hooks run, are handed a null graphics, and
        // return immediately -- which is what they do for a frame with nothing
        // to draw on.
        Object screen = loaded.newInstance();
        render.invoke(screen, null, 2, 3, 0f);
        int expected = 2 + 3 + widgetTotal();
        assert loaded.getField("rendered").getInt(null) == expected
            : "the original body must still do what it did, loop included";

        // And the branch, which is where a bad frame would surface.
        render.invoke(loaded.newInstance(), null, -1, 0, 0f);
        assert loaded.getField("rendered").getInt(null) == -1 : "the early return still returns";
    }

    /** What the fixture's loop adds up to, computed the same way it does. */
    private static int widgetTotal() {
        int total = 0;
        for (Object widget : java.util.Arrays.asList((Object) "a", (Object) "b", (Object) "c")) {
            total += widget.hashCode() & 1;
        }
        return total;
    }

    private static void bothHooksAreCalled(byte[] transformed) {
        Calls calls = scan(transformed, "render");
        assert calls.background == 1 : "one background hook, before the original";
        assert calls.foreground == 1 : "one foreground hook, after it";
        assert calls.original == 1 : "and the original body, called once between them";
        assert calls.returns == 1 : "the wrapper is straight-line: one return, no branches";
    }

    /**
     * The original method has to come through unread and unedited.
     *
     * <p>This is the whole reason for wrapping rather than injecting. The game
     * declares its local variables dead at the point it returns, so code
     * inserted there reads variables the class says are gone and the JVM
     * refuses the class -- {@code VerifyError: Bad local variable type},
     * before a single frame is drawn. Moved instead of edited, its branches
     * and its map are never touched.
     */
    private static void theOriginalBodyIsMovedNotRewritten(byte[] original, byte[] transformed) {
        Calls before = scan(original, "render");
        Calls after = scan(transformed, "kiza$render");

        assert after.instructions == before.instructions
            : "the moved method should have the instructions it always had: "
                + before.instructions + " became " + after.instructions;
        assert after.background == 0 && after.foreground == 0
            : "nothing is injected into it";
        assert after.frames == before.frames
            : "and it keeps its own map of live variables";
    }

    /** A transformer built for one class must leave every other one alone. */
    private static void onlyTheNamedMethodIsTouched(byte[] original, ScreenTransformer transformer) {
        assert transformer.transform(null, "some/other/Class", null, null, original) == null
            : "another class is not this transformer's business";

        // A method whose arguments do not match is a different method, and
        // transforming nothing quietly would leave a client that believes it
        // attached. It says so instead, and `transform` turns that into
        // handing the class back untouched.
        ScreenTransformer wrongSignature =
            new ScreenTransformer(INTERNAL_NAME, "render", "(Ljava/lang/String;)V");
        boolean refused = false;
        try {
            wrongSignature.inject(original);
        } catch (IllegalStateException expected) {
            refused = true;
        }
        assert refused : "a signature that matches nothing should not pass quietly";
        assert wrongSignature.transform(null, INTERNAL_NAME, null, null, original) == null
            : "and the class is handed back as it came";
    }

    /** Not asked for, not touched: the blur is a choice the launcher makes. */
    private static void theBlurIsLeftAloneUnlessAsked(byte[] original, byte[] transformed) throws Exception {
        Class<?> loaded = load(transformed);
        loaded.getField("blurred").setBoolean(null, false);
        loaded.getMethod("renderBlurredBackground", float.class).invoke(loaded.newInstance(), 0f);
        assert loaded.getField("blurred").getBoolean(null)
            : "with no blur patch requested the method must run as written";
    }

    /**
     * Asked for, the method returns before doing anything. The rest of the
     * class -- render included -- is exactly what it would have been without
     * the patch, because emptying one method is not a licence to touch others.
     */
    private static void theBlurIsEmptiedWhenAsked(byte[] original) throws Exception {
        ScreenTransformer withBlur = new ScreenTransformer(
            INTERNAL_NAME, "render", DESCRIPTOR, "renderBlurredBackground", "(F)V"
        );
        Class<?> loaded = load(withBlur.inject(original));

        loaded.getField("blurred").setBoolean(null, false);
        loaded.getMethod("renderBlurredBackground", float.class).invoke(loaded.newInstance(), 0f);
        assert !loaded.getField("blurred").getBoolean(null) : "the blur should have been skipped";

        // And render still renders.
        loaded.getMethod("render", Object.class, int.class, int.class, float.class)
            .invoke(loaded.newInstance(), null, 2, 3, 0f);
        assert loaded.getField("rendered").getInt(null) == 2 + 3 + widgetTotal()
            : "emptying the blur must not disturb render";
    }

    /* --------------------------------------------------------------- tools -- */

    private static final class Calls {
        int background;
        int foreground;
        int original;
        int returns;
        int instructions;
        int frames;
    }

    private static Calls scan(byte[] classFile, final String method) {
        final Calls calls = new Calls();
        new ClassReader(classFile).accept(new ClassVisitor(Opcodes.ASM9) {
            @Override
            public MethodVisitor visitMethod(
                int access, String name, String descriptor, String signature, String[] exceptions
            ) {
                if (!name.equals(method) || !descriptor.equals(DESCRIPTOR)) return null;
                return new MethodVisitor(Opcodes.ASM9) {
                    @Override
                    public void visitMethodInsn(
                        int opcode, String owner, String called, String descriptor, boolean isInterface
                    ) {
                        calls.instructions += 1;
                        if (called.equals("kiza$render")) calls.original += 1;
                        if (!owner.equals("fr/kiza/basemod/MenuLogoRenderer")) return;
                        if (called.equals("renderBackground")) calls.background += 1;
                        if (called.equals("render")) calls.foreground += 1;
                    }

                    @Override
                    public void visitInsn(int opcode) {
                        calls.instructions += 1;
                        if (opcode == Opcodes.RETURN) calls.returns += 1;
                    }

                    @Override
                    public void visitVarInsn(int opcode, int index) {
                        calls.instructions += 1;
                    }

                    @Override
                    public void visitFrame(
                        int type, int nLocal, Object[] local, int nStack, Object[] stack
                    ) {
                        calls.frames += 1;
                    }
                };
            }
        }, ClassReader.EXPAND_FRAMES);
        return calls;
    }

    private static byte[] bytesOf(Class<?> type) throws Exception {
        InputStream stream = type.getClassLoader()
            .getResourceAsStream(type.getName().replace('.', '/') + ".class");
        if (stream == null) throw new IllegalStateException("no class file for " + type);
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = stream.read(chunk)) > 0) out.write(chunk, 0, read);
            return out.toByteArray();
        } finally {
            stream.close();
        }
    }

    private static Class<?> load(final byte[] classFile) {
        // loadClass rather than findClass: the parent already holds the
        // untransformed fixture, and the usual delegate-first order would hand
        // it back -- so the test would pass while testing nothing.
        ClassLoader loader = new ClassLoader(ScreenTransformerTest.class.getClassLoader()) {
            private Class<?> defined;

            @Override
            protected synchronized Class<?> loadClass(String name, boolean resolve)
                throws ClassNotFoundException {
                if (!name.equals(INTERNAL_NAME.replace('/', '.'))) {
                    return super.loadClass(name, resolve);
                }
                if (defined == null) {
                    defined = defineClass(name, classFile, 0, classFile.length);
                }
                if (resolve) resolveClass(defined);
                return defined;
            }
        };
        try {
            return loader.loadClass(INTERNAL_NAME.replace('/', '.'));
        } catch (ClassNotFoundException error) {
            throw new IllegalStateException(error);
        }
    }
}
