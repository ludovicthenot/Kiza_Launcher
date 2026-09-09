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
 * <h2>Why every return and not just the last instruction</h2>
 *
 * <p>"The end of a method" is not a place. A method with an early return has
 * several ends, and a hook attached only to the final one is a hook that does
 * not run whenever the game takes a shortcut -- which for a screen render is
 * exactly the frames where something unusual is happening.
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
        // The frames already in the method stay correct because everything
        // injected leaves the stack as it found it.
        ClassWriter writer = new ClassWriter(reader, ClassWriter.COMPUTE_MAXS);
        reader.accept(new ScreenVisitor(writer), 0);
        return writer.toByteArray();
    }

    private final class ScreenVisitor extends ClassVisitor {
        ScreenVisitor(ClassWriter writer) {
            super(Opcodes.ASM9, writer);
        }

        @Override
        public MethodVisitor visitMethod(
            int access,
            String name,
            String descriptor,
            String signature,
            String[] exceptions
        ) {
            MethodVisitor delegate = super.visitMethod(access, name, descriptor, signature, exceptions);
            if (delegate == null) return null;
            if (!name.equals(renderName) || !descriptor.equals(renderDescriptor)) {
                return delegate;
            }
            return new RenderVisitor(delegate);
        }
    }

    /**
     * The method itself. Slot 0 is the screen, 1 the graphics, 2 and 3 the
     * mouse -- the shape of {@code render(GuiGraphics, int, int, float)}, which
     * is the only method this visitor is ever given.
     */
    private static final class RenderVisitor extends MethodVisitor {
        RenderVisitor(MethodVisitor delegate) {
            super(Opcodes.ASM9, delegate);
        }

        @Override
        public void visitCode() {
            super.visitCode();
            super.visitVarInsn(Opcodes.ALOAD, 1);
            super.visitVarInsn(Opcodes.ALOAD, 0);
            super.visitMethodInsn(
                Opcodes.INVOKESTATIC, HOOK, "renderBackground", BACKGROUND_DESCRIPTOR, false
            );
        }

        @Override
        public void visitInsn(int opcode) {
            if (opcode == Opcodes.RETURN) {
                super.visitVarInsn(Opcodes.ALOAD, 1);
                super.visitVarInsn(Opcodes.ALOAD, 0);
                super.visitVarInsn(Opcodes.ILOAD, 2);
                super.visitVarInsn(Opcodes.ILOAD, 3);
                super.visitMethodInsn(
                    Opcodes.INVOKESTATIC, HOOK, "render", FOREGROUND_DESCRIPTOR, false
                );
            }
            super.visitInsn(opcode);
        }
    }
}
