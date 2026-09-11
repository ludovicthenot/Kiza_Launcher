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
 * <h2>One class</h2>
 *
 * <p>{@code Screen}, and two methods on it. {@code render} carries the client:
 * every screen in the game inherits it, so decorating it decorates all of
 * them, which is the same reach the Mixin has on the other loaders. And when
 * the launcher asks, {@code renderBlurredBackground} is emptied -- the
 * per-frame blur behind in-world menus, which this client paints over anyway.
 * Each further patch is one more method to find in a jar whose names change
 * every release, so they are added when they pay for themselves and not
 * before.
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

    /**
     * Which optional patches the launcher asked for, comma-separated.
     *
     * <p>Decided on the launcher's side and not here, so a patch can be tied
     * to a performance profile, turned off for one instance, or dropped from
     * a release without rebuilding the agent. The agent only knows how; the
     * launcher says whether.
     */
    private static final String PATCHES_PROPERTY = "kiza.vanilla.patches";

    /** Empties the per-frame blur behind in-world menus. */
    private static final String PATCH_MENU_BLUR = "menu-blur";

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

    private static boolean wants(String patch) {
        String asked = System.getProperty(PATCHES_PROPERTY);
        if (asked == null) return false;
        for (String name : asked.split(",")) {
            if (name.trim().equalsIgnoreCase(patch)) return true;
        }
        return false;
    }

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

            // The blur exists from 1.20.5; on anything older the mapping has
            // no such method and the patch has nothing to do.
            String blur = null;
            if (wants(PATCH_MENU_BLUR)) {
                blur = mappings.methodNamed(SCREEN, "renderBlurredBackground", "float");
                if (blur == null) {
                    System.err.println("[Kiza Launcher] This Minecraft has no menu blur to skip.");
                }
            }

            instrumentation.addTransformer(new ScreenTransformer(
                screen.replace('.', '/'),
                render,
                "(L" + graphicsInternal.replace('.', '/') + ";IIF)V",
                blur,
                blur == null ? null : "(F)V"
            ));
            System.err.println(
                "[Kiza Launcher] Client attached to " + screen
                    + (blur == null ? "" : ", menu blur skipped")
            );
            return;
        }

        System.err.println("[Kiza Launcher] This Minecraft draws its screens in a way the client does not know.");
    }
}
