package fr.kiza.basemod.mixin.fabric;

import fr.kiza.basemod.KizaClientManager;
import java.util.List;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Adds the client line to the F3 overlay, right under Minecraft's own version
 * lines.
 *
 * <p>The returned list is the live one the debug screen is about to draw, so
 * the entry is appended in place. {@code require = 0} keeps a mapping change
 * from turning this into a startup crash: the worst case is no extra line.
 */
@Mixin(targets = "net.minecraft.class_340", remap = false)
public abstract class FabricDebugHudMixin {
    @Inject(method = "method_1839", at = @At("RETURN"), require = 0, remap = false)
    private void kiza$addClientLine(CallbackInfoReturnable<List<String>> callback) {
        List<String> lines = callback.getReturnValue();
        if (lines == null) return;
        try {
            lines.add(KizaClientManager.debugLabel());
        } catch (UnsupportedOperationException immutable) {
            // Some versions hand back a fixed list; leave the overlay alone.
        }
    }
}
