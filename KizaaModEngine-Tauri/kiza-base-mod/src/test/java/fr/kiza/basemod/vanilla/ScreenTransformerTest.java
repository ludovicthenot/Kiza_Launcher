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

        public void render(Object graphics, int mouseX, int mouseY, float delta) {
            if (mouseX < 0) {
                rendered = -1;
                return;
            }
            rendered = mouseX + mouseY;
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
        everyReturnCarriesTheHook(transformed);
        onlyTheNamedMethodIsTouched(original, transformer);

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
        render.invoke(loaded.newInstance(), null, 2, 3, 0f);
        assert loaded.getField("rendered").getInt(null) == 5
            : "the original body must still do what it did";

        // And the branch, which is where a bad frame would surface.
        render.invoke(loaded.newInstance(), null, -1, 0, 0f);
        assert loaded.getField("rendered").getInt(null) == -1 : "the early return still returns";
    }

    private static void bothHooksAreCalled(byte[] transformed) {
        Calls calls = scan(transformed);
        assert calls.background == 1
            : "the background hook belongs at the head, once: " + calls.background;
        assert calls.foreground > 0 : "the foreground hook should be at the tail";
    }

    /**
     * "The end of a method" is not one place. This method has two returns, and
     * a hook on only the last of them would go silent exactly on the frames
     * where the game took a shortcut.
     */
    private static void everyReturnCarriesTheHook(byte[] transformed) {
        Calls calls = scan(transformed);
        assert calls.foreground == calls.returns
            : "each of the " + calls.returns + " returns needs the hook, found " + calls.foreground;
        assert calls.returns >= 2 : "the fixture should have more than one return";
    }

    /** A transformer built for one class must leave every other one alone. */
    private static void onlyTheNamedMethodIsTouched(byte[] original, ScreenTransformer transformer) {
        assert transformer.transform(null, "some/other/Class", null, null, original) == null
            : "another class is not this transformer's business";

        ScreenTransformer wrongSignature =
            new ScreenTransformer(INTERNAL_NAME, "render", "(Ljava/lang/String;)V");
        Calls calls = scan(wrongSignature.inject(original));
        assert calls.background == 0 && calls.foreground == 0
            : "a method whose arguments do not match is a different method";
    }

    /* --------------------------------------------------------------- tools -- */

    private static final class Calls {
        int background;
        int foreground;
        int returns;
    }

    private static Calls scan(byte[] classFile) {
        final Calls calls = new Calls();
        new ClassReader(classFile).accept(new ClassVisitor(Opcodes.ASM9) {
            @Override
            public MethodVisitor visitMethod(
                int access, String name, String descriptor, String signature, String[] exceptions
            ) {
                if (!name.equals("render") || !descriptor.equals(DESCRIPTOR)) return null;
                return new MethodVisitor(Opcodes.ASM9) {
                    @Override
                    public void visitMethodInsn(
                        int opcode, String owner, String method, String descriptor, boolean isInterface
                    ) {
                        if (!owner.equals("fr/kiza/basemod/MenuLogoRenderer")) return;
                        if (method.equals("renderBackground")) calls.background += 1;
                        if (method.equals("render")) calls.foreground += 1;
                    }

                    @Override
                    public void visitInsn(int opcode) {
                        if (opcode == Opcodes.RETURN) calls.returns += 1;
                    }
                };
            }
        }, 0);
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
