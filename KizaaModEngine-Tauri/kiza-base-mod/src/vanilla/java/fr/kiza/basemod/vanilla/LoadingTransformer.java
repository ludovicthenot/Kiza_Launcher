package fr.kiza.basemod.vanilla;

import java.lang.instrument.ClassFileTransformer;
import java.security.ProtectionDomain;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Label;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;

/**
 * The loading screen, Kiza's, under the Vanilla agent -- what the mixin does on
 * Fabric ({@code KizaLoading}):
 *
 * <ul>
 *   <li>wherever the screen asks its {@code IntSupplier} for its background
 *       colour, the answer goes through {@code KizaLoading.background(this,
 *       colour)} on its way. {@code IntSupplier} is the JDK's, so the call is
 *       found the same way whatever the release calls its own methods;</li>
 *   <li>its drawing is wrapped: the original, moved aside, then
 *       {@code KizaLoading.afterOverlay(this, graphics)};</li>
 *   <li>its progress bar is wrapped likewise, and skipped while Kiza draws
 *       its own.</li>
 * </ul>
 *
 * <p>Wrapped rather than edited, as the screens are ({@link ScreenTransformer}):
 * the game's own methods are moved through unread, so their branches and stack
 * maps are never touched. The colour call gets two instructions after it, which
 * leave the stack as it was. Anything unexpected and the class is returned as
 * the game shipped it.
 */
final class LoadingTransformer implements ClassFileTransformer {
    private static final String HOOK = "fr/kiza/basemod/KizaLoading";

    private final String overlayInternalName;
    /** The screen's drawing and progress bar, or null where the mapping did not say. */
    private final String renderName;
    private final String renderDescriptor;
    private final String barName;
    private final String barDescriptor;

    LoadingTransformer(String overlayInternalName) {
        this(overlayInternalName, null, null, null, null);
    }

    LoadingTransformer(String overlayInternalName, String renderName, String renderDescriptor, String barName, String barDescriptor) {
        this.overlayInternalName = overlayInternalName;
        this.renderName = renderName;
        this.renderDescriptor = renderDescriptor;
        this.barName = barName;
        this.barDescriptor = barDescriptor;
    }

    @Override
    public byte[] transform(
        ClassLoader loader,
        String className,
        Class<?> beingRedefined,
        ProtectionDomain protectionDomain,
        byte[] classfileBuffer
    ) {
        if (className == null || !className.equals(overlayInternalName)) return null;
        try {
            return inject(classfileBuffer);
        } catch (Throwable error) {
            System.err.println("[Kiza Client] The loading screen stays as it is: " + error);
            return null;
        }
    }

    byte[] inject(byte[] original) {
        ClassReader reader = new ClassReader(original);
        ClassWriter writer = new ClassWriter(reader, ClassWriter.COMPUTE_MAXS);
        Visitor visitor = new Visitor(writer);
        reader.accept(visitor, 0);
        if (visitor.colours == 0) throw new IllegalStateException("no background colour read in " + overlayInternalName);
        return writer.toByteArray();
    }

    private static boolean is(String name, String descriptor, String wantedName, String wantedDescriptor) {
        return wantedName != null && name.equals(wantedName) && descriptor.equals(wantedDescriptor);
    }

    private final class Visitor extends ClassVisitor {
        int colours;
        private boolean renderFound;
        private boolean barFound;
        private int renderAccess;
        private int barAccess;

        Visitor(ClassWriter writer) {
            super(Opcodes.ASM9, writer);
        }

        @Override
        public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
            // Moved aside, private, so the wrapper's call can never be answered by a subclass.
            int moved = (access & ~(Opcodes.ACC_PUBLIC | Opcodes.ACC_PROTECTED)) | Opcodes.ACC_PRIVATE;
            String visitedName = name;
            int visitedAccess = access;
            if (is(name, descriptor, renderName, renderDescriptor)) {
                renderFound = true;
                renderAccess = access;
                visitedName = "kiza$" + name;
                visitedAccess = moved;
            } else if (is(name, descriptor, barName, barDescriptor)) {
                barFound = true;
                barAccess = access;
                visitedName = "kiza$bar";
                visitedAccess = moved;
            }
            MethodVisitor method = super.visitMethod(visitedAccess, visitedName, descriptor, signature, exceptions);
            // The supplier's own body is a static lambda; the screen's
            // drawing, which asks it, is not.
            if ((access & Opcodes.ACC_STATIC) != 0) return method;
            return new MethodVisitor(Opcodes.ASM9, method) {
                @Override
                public void visitMethodInsn(int opcode, String owner, String called, String calledDescriptor, boolean isInterface) {
                    super.visitMethodInsn(opcode, owner, called, calledDescriptor, isInterface);
                    if (opcode == Opcodes.INVOKEINTERFACE
                        && owner.equals("java/util/function/IntSupplier")
                        && called.equals("getAsInt")
                        && calledDescriptor.equals("()I")) {
                        // [colour] -> [this, colour] -> [colour]
                        super.visitVarInsn(Opcodes.ALOAD, 0);
                        super.visitInsn(Opcodes.SWAP);
                        super.visitMethodInsn(Opcodes.INVOKESTATIC, HOOK, "background", "(Ljava/lang/Object;I)I", false);
                        colours += 1;
                    }
                }
            };
        }

        @Override
        public void visitEnd() {
            if (renderFound) wrapRender();
            if (barFound) wrapBar();
            super.visitEnd();
        }

        /** The drawing, then Kiza's over it: straight-line, so it needs no stack map. */
        private void wrapRender() {
            MethodVisitor method = super.visitMethod(renderAccess, renderName, renderDescriptor, null, null);
            method.visitCode();
            callMoved(method, "kiza$" + renderName, renderDescriptor);
            method.visitVarInsn(Opcodes.ALOAD, 0);
            method.visitVarInsn(Opcodes.ALOAD, 1);
            method.visitMethodInsn(Opcodes.INVOKESTATIC, HOOK, "afterOverlay", "(Ljava/lang/Object;Ljava/lang/Object;)V", false);
            method.visitInsn(Opcodes.RETURN);
            method.visitMaxs(0, 0);
            method.visitEnd();
        }

        /** The bar, unless Kiza draws its own. */
        private void wrapBar() {
            MethodVisitor method = super.visitMethod(barAccess, barName, barDescriptor, null, null);
            method.visitCode();
            Label skip = new Label();
            method.visitMethodInsn(Opcodes.INVOKESTATIC, HOOK, "hidesProgressBar", "()Z", false);
            method.visitJumpInsn(Opcodes.IFNE, skip);
            callMoved(method, "kiza$bar", barDescriptor);
            method.visitLabel(skip);
            // Nothing on the stack, the locals as the method began: the same frame.
            method.visitFrame(Opcodes.F_SAME, 0, null, 0, null);
            method.visitInsn(Opcodes.RETURN);
            method.visitMaxs(0, 0);
            method.visitEnd();
        }

        /** this.moved(arguments...), the arguments as the wrapper received them. */
        private void callMoved(MethodVisitor method, String moved, String descriptor) {
            method.visitVarInsn(Opcodes.ALOAD, 0);
            int slot = 1;
            for (Type argument : Type.getArgumentTypes(descriptor)) {
                method.visitVarInsn(argument.getOpcode(Opcodes.ILOAD), slot);
                slot += argument.getSize();
            }
            method.visitMethodInsn(Opcodes.INVOKESPECIAL, overlayInternalName, moved, descriptor, false);
        }
    }
}
