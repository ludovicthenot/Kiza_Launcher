package fr.kiza.basemod.vanilla;

import java.lang.instrument.ClassFileTransformer;
import java.security.ProtectionDomain;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

/**
 * Puts the two calls into {@code Screen.render} that every loader's Mixin puts
 * there.
 *
 * <p>On Fabric and Forge this is declared, not written: a Mixin says "at HEAD"
 * and "at TAIL" of the screen's render method and the loader does the rest.
 * A plain Minecraft has no loader to ask, so the same two calls are placed by
 * hand, into the same method, in the same order:
 *
 * <ul>
 *   <li>at the top, {@code renderBackground(graphics, screen)} -- before
 *       vanilla paints, so the menu background is underneath rather than over
 *       it;</li>
 *   <li>at every return, {@code render(graphics, screen, mouseX, mouseY)} --
 *       after vanilla has drawn its widgets, so Kiza's are on top.</li>
 * </ul>
 *
 * <h2>Why the method is wrapped rather than edited</h2>
 *
 * <p>The obvious way is to insert the calls into the method: one at the top,
 * one before each return. It does not work, and the reason is worth writing
 * down because it looks like it should.
 *
 * <p>A class file carries a map of which local variables are alive at each
 * branch target, and the JVM checks the code against it before running any of
 * it. Minecraft's own {@code Screen.render} declares its locals <em>dead</em>
 * at the point it returns -- nothing there needs them any more, so the
 * compiler stopped tracking them. Injected code that reads the graphics and
 * the mouse position at that point reads variables the map says are gone, and
 * the JVM refuses the class outright: {@code VerifyError: Bad local variable
 * type}, before the game draws a single frame.
 *
 * <p>So the original method is not touched at all. It is renamed, and a new
 * method takes its place under the old name:
 *
 * <pre>
 *   render(graphics, mouseX, mouseY, delta) {   // new
 *       Kiza.renderBackground(graphics, this);
 *       this.kiza$render(graphics, mouseX, mouseY, delta);   // the original
 *       Kiza.render(graphics, this, mouseX, mouseY);
 *   }
 * </pre>
 *
 * <p>The original keeps its bytecode, its branches and its map, untouched and
 * unexamined. The new method is three calls in a straight line, with no
 * branches, so it needs no map of its own and there is nothing to get wrong.
 * Every call that reached the old method reaches this one, including a
 * subclass calling {@code super}.
 *
 * <h2>Why the hooks take Object</h2>
 *
 * <p>The receiver and the graphics are obfuscated types whose names change
 * every release, so nothing here can name them. It does not need to: the hooks
 * on the other side already take {@code Object} and resolve what they were
 * handed by reflection, which is how they serve four loader generations at
 * once. That makes the injected call site the same three instructions on every
 * version of the game.
 */
final class ScreenTransformer implements ClassFileTransformer {

    /** Where the injected calls land. Slashes: this is a bytecode name. */
    private static final String HOOK = "fr/kiza/basemod/MenuLogoRenderer";

    private static final String BACKGROUND_DESCRIPTOR = "(Ljava/lang/Object;Ljava/lang/Object;)V";
    private static final String FOREGROUND_DESCRIPTOR = "(Ljava/lang/Object;Ljava/lang/Object;II)V";

    private final String screenInternalName;
    private final String renderName;
    private final String renderDescriptor;
    private boolean done;

    ScreenTransformer(String screenInternalName, String renderName, String renderDescriptor) {
        this.screenInternalName = screenInternalName;
        this.renderName = renderName;
        this.renderDescriptor = renderDescriptor;
    }

    /** Whether the class this was built for has actually been transformed. */
    boolean hasRun() {
        return done;
    }

    @Override
    public byte[] transform(
        ClassLoader loader,
        String className,
        Class<?> beingRedefined,
        ProtectionDomain protectionDomain,
        byte[] classfileBuffer
    ) {
        if (className == null || !className.equals(screenInternalName)) return null;
        try {
            byte[] transformed = inject(classfileBuffer);
            done = true;
            return transformed;
        } catch (Throwable error) {
            // Returning null leaves the class exactly as the game shipped it.
            // A client that could not decorate the menu is a client without
            // its menu; a transformer that threw here would be a game that
            // does not start, and the two are not close.
            System.err.println("[Kiza Launcher] Could not attach to the screen renderer: " + error);
            return null;
        }
    }

    byte[] inject(byte[] original) {
        ClassReader reader = new ClassReader(original);
        // The reader is handed to the writer so the constant pool is copied
        // rather than rebuilt, and COMPUTE_MAXS rather than COMPUTE_FRAMES:
        // computing frames would make ASM ask what class is a supertype of
        // what, which loads classes, in the middle of a class being loaded.
        ClassWriter writer = new ClassWriter(reader, ClassWriter.COMPUTE_MAXS);
        ScreenVisitor visitor = new ScreenVisitor(writer);
        reader.accept(visitor, ClassReader.EXPAND_FRAMES);
        if (!visitor.found) throw new IllegalStateException("no " + renderName + renderDescriptor);
        return writer.toByteArray();
    }

    /** The name the original method is moved to. */
    private String movedName() {
        return "kiza$" + renderName;
    }

    private final class ScreenVisitor extends ClassVisitor {
        private String owner;
        private int access;
        boolean found;

        ScreenVisitor(ClassWriter writer) {
            super(Opcodes.ASM9, writer);
        }

        @Override
        public void visit(
            int version, int access, String name, String signature, String superName, String[] interfaces
        ) {
            this.owner = name;
            super.visit(version, access, name, signature, superName, interfaces);
        }

        @Override
        public MethodVisitor visitMethod(
            int access,
            String name,
            String descriptor,
            String signature,
            String[] exceptions
        ) {
            if (!name.equals(renderName) || !descriptor.equals(renderDescriptor)) {
                return super.visitMethod(access, name, descriptor, signature, exceptions);
            }

            found = true;
            this.access = access;
            // Private, so the wrapper's call to it can never be answered by a
            // subclass. Everything else about the method -- its code, its
            // branches, its frames -- is copied through without being read.
            int moved = (access & ~(Opcodes.ACC_PUBLIC | Opcodes.ACC_PROTECTED)) | Opcodes.ACC_PRIVATE;
            return super.visitMethod(moved, movedName(), descriptor, signature, exceptions);
        }

        @Override
        public void visitEnd() {
            if (found) writeWrapper(owner, access);
            super.visitEnd();
        }

        /**
         * The replacement, written from nothing: three calls and a return.
         *
         * <p>Straight line on purpose. A method with no branches has no branch
         * targets, so it carries no map of live variables and there is nothing
         * about it for the verifier to disagree with.
         */
        private void writeWrapper(String owner, int access) {
            MethodVisitor method = cv.visitMethod(access, renderName, renderDescriptor, null, null);
            method.visitCode();

            // Kiza.renderBackground(graphics, this) -- before the original, so
            // the menu background is painted underneath it.
            method.visitVarInsn(Opcodes.ALOAD, 1);
            method.visitVarInsn(Opcodes.ALOAD, 0);
            method.visitMethodInsn(
                Opcodes.INVOKESTATIC, HOOK, "renderBackground", BACKGROUND_DESCRIPTOR, false
            );

            // this.kiza$render(graphics, mouseX, mouseY, delta) -- what the
            // game shipped, unchanged.
            method.visitVarInsn(Opcodes.ALOAD, 0);
            method.visitVarInsn(Opcodes.ALOAD, 1);
            method.visitVarInsn(Opcodes.ILOAD, 2);
            method.visitVarInsn(Opcodes.ILOAD, 3);
            method.visitVarInsn(Opcodes.FLOAD, 4);
            method.visitMethodInsn(
                Opcodes.INVOKESPECIAL, owner, movedName(), renderDescriptor, false
            );

            // Kiza.render(graphics, this, mouseX, mouseY) -- after, so what it
            // draws is on top of the game's own widgets.
            method.visitVarInsn(Opcodes.ALOAD, 1);
            method.visitVarInsn(Opcodes.ALOAD, 0);
            method.visitVarInsn(Opcodes.ILOAD, 2);
            method.visitVarInsn(Opcodes.ILOAD, 3);
            method.visitMethodInsn(
                Opcodes.INVOKESTATIC, HOOK, "render", FOREGROUND_DESCRIPTOR, false
            );

            method.visitInsn(Opcodes.RETURN);
            // Recomputed by COMPUTE_MAXS; the numbers here are the minimum it
            // is allowed to arrive at.
            method.visitMaxs(5, 5);
            method.visitEnd();
        }
    }
}
