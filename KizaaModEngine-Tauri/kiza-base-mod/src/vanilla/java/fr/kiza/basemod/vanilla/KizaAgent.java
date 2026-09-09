package fr.kiza.basemod.vanilla;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.lang.instrument.Instrumentation;
import java.nio.charset.Charset;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

import fr.kiza.basemod.ProguardMappings;

/**
 * The Kiza client on a Minecraft with no loader.
 *
 * <p>Fabric and Forge give a mod two things: somewhere to put code that runs
 * at startup, and a way to get that code called while the game draws. A plain
 * Minecraft gives neither. A Java agent gives the first -- {@code premain}
 * runs before the game's own main -- and the second is bought by rewriting one
 * method as it is loaded.
 *
 * <h2>One method</h2>
 *
 * <p>{@code Screen.render} and nothing else. Every screen in the game inherits
 * it, so decorating it decorates all of them, which is the same reach the
 * Mixin has on the other loaders. Wanting more than that would mean more
 * methods to find and more ways to be wrong about a jar whose names change
 * every release.
 *
 * <h2>Nothing here is allowed to stop a launch</h2>
 *
 * <p>Every failure -- no mapping, a mapping for another release, a screen this
 * does not recognise, a transformer that throws -- ends the same way: the
 * agent stands down and the game starts as though it were not there. It is a
 * decoration. A player whose menu is plain has lost a decoration; a player
 * whose game will not open has lost the game.
 */
public final class KizaAgent {

    /** Set by the launcher, pointing at the mapping it fetched from Mojang. */
    private static final String MAPPINGS_PROPERTY = "kiza.minecraft.mappings";

    private static final String SCREEN = "net.minecraft.client.gui.screens.Screen";

    /**
     * What {@code Screen.render} takes, newest first.
     *
     * <p>Mojang changed the first argument twice: a {@code GuiGraphics} from
     * 1.20.2, a {@code PoseStack} before that, and a {@code MatrixStack} before
     * that again. The rest of the signature has never moved. Listed rather than
     * detected because the mapping can be asked directly, and asking three
     * times costs nothing.
     */
    private static final String[] GRAPHICS_TYPES = {
        "net.minecraft.client.gui.GuiGraphics",
        "com.mojang.blaze3d.vertex.PoseStack",
        "com.mojang.blaze3d.matrix.MatrixStack",
    };

    private KizaAgent() {}

    public static void premain(String argument, Instrumentation instrumentation) {
        try {
            attach(instrumentation);
        } catch (Throwable error) {
            // Includes anything thrown while loading our own classes. The game
            // has not started yet, and it is going to.
            System.err.println("[Kiza Launcher] The client could not attach: " + error);
        }
    }

    private static void attach(Instrumentation instrumentation) throws Exception {
        String path = System.getProperty(MAPPINGS_PROPERTY);
        if (path == null || path.trim().isEmpty()) {
            System.err.println("[Kiza Launcher] No Minecraft mapping was given; the menu stays vanilla.");
            return;
        }

        File file = new File(path.trim());
        if (!file.isFile()) {
            System.err.println("[Kiza Launcher] No Minecraft mapping at " + file);
            return;
        }

        Set<String> wanted = new HashSet<String>();
        wanted.add(SCREEN);
        wanted.addAll(Arrays.asList(GRAPHICS_TYPES));

        ProguardMappings mappings;
        Reader reader = new InputStreamReader(new FileInputStream(file), Charset.forName("UTF-8"));
        try {
            mappings = ProguardMappings.read(reader, wanted);
        } finally {
            reader.close();
        }

        String screen = mappings.classNamed(SCREEN);
        if (screen == null) {
            System.err.println("[Kiza Launcher] That mapping does not describe this Minecraft.");
            return;
        }

        for (String graphics : GRAPHICS_TYPES) {
            // The name alone would be ambiguous: obfuscation gives several of
            // Screen's methods the same letter, so the arguments are what tell
            // render from renderPanorama.
            String render = mappings.methodNamed(SCREEN, "render", graphics, "int", "int", "float");
            if (render == null) continue;

            String graphicsInternal = mappings.classNamed(graphics);
            if (graphicsInternal == null) continue;

            instrumentation.addTransformer(new ScreenTransformer(
                screen.replace('.', '/'),
                render,
                "(L" + graphicsInternal.replace('.', '/') + ";IIF)V"
            ));
            return;
        }

        System.err.println("[Kiza Launcher] This Minecraft draws its screens in a way the client does not know.");
    }
}
