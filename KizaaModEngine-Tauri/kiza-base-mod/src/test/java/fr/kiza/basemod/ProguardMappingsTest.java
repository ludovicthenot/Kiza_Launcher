package fr.kiza.basemod;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.Reader;
import java.io.StringReader;
import java.nio.charset.Charset;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Reading Mojang's names for an obfuscated Minecraft.
 *
 * <p>The failures worth guarding here are the quiet ones. Obfuscation reuses
 * one-letter names, so a lookup that ignores parameter types returns a real
 * method that is the wrong method -- and this mod uses the answer to decide
 * where to inject itself. Nothing about that failure looks like a failure
 * until the game draws the wrong thing or throws inside somebody else's frame.
 */
public final class ProguardMappingsTest {

    /** A few lines in the shape Mojang publish, including the traps. */
    private static final String SAMPLE =
        "# a comment the parser must ignore\n"
        + "net.minecraft.client.gui.screens.Screen -> fod:\n"
        + "    net.minecraft.client.Minecraft minecraft -> l\n"
        + "    java.util.List renderables -> v\n"
        + "    126:130:void render(net.minecraft.client.gui.GuiGraphics,int,int,float) -> a\n"
        + "    345:350:void renderBackground(net.minecraft.client.gui.GuiGraphics,int,int,float) -> b\n"
        + "    358:359:void renderPanorama(net.minecraft.client.gui.GuiGraphics,float) -> a\n"
        + "    362:363:void renderMenuBackground(net.minecraft.client.gui.GuiGraphics) -> a\n"
        + "net.minecraft.client.gui.GuiGraphics -> fhz:\n"
        + "    void flush() -> c\n"
        + "net.minecraft.client.NotWanted -> zzz:\n"
        + "    void ignored() -> a\n";

    public static void main(String[] arguments) throws Exception {
        readsClassesAndMembers();
        tellsApartMethodsThatShareAName();
        keepsOnlyWhatWasAskedFor();
        survivesRubbish();
        answersNullRatherThanGuessing();
        readsTheRealFileWhenItIsHere();
        System.out.println("ProguardMappingsTest OK");
    }

    private static ProguardMappings sample() throws IOException {
        return ProguardMappings.read(new StringReader(SAMPLE), wanted());
    }

    private static Set<String> wanted() {
        return new HashSet<String>(Arrays.asList(
            "net.minecraft.client.gui.screens.Screen",
            "net.minecraft.client.gui.GuiGraphics"
        ));
    }

    private static void readsClassesAndMembers() throws IOException {
        ProguardMappings mappings = sample();
        assertEquals("fod", mappings.classNamed("net.minecraft.client.gui.screens.Screen"));
        assertEquals("fhz", mappings.classNamed("net.minecraft.client.gui.GuiGraphics"));
        assertEquals("l", mappings.fieldNamed("net.minecraft.client.gui.screens.Screen", "minecraft"));
        assertEquals("v", mappings.fieldNamed("net.minecraft.client.gui.screens.Screen", "renderables"));
        assert !mappings.isEmpty() : "a mapping that read two classes is not empty";
    }

    /**
     * The reason parameter types are part of the key.
     *
     * <p>Four methods on Screen come out as "a". Asked only for "render", a
     * parser keyed by name would answer with whichever it saw last -- here
     * renderMenuBackground -- and the injection would land in the wrong method.
     */
    private static void tellsApartMethodsThatShareAName() throws IOException {
        ProguardMappings mappings = sample();
        String screen = "net.minecraft.client.gui.screens.Screen";
        String graphics = "net.minecraft.client.gui.GuiGraphics";

        assertEquals("a", mappings.methodNamed(screen, "render", graphics, "int", "int", "float"));
        assertEquals("b", mappings.methodNamed(screen, "renderBackground", graphics, "int", "int", "float"));
        assertEquals("a", mappings.methodNamed(screen, "renderPanorama", graphics, "float"));

        // The same name with the wrong arguments is not a match, and must not
        // fall back to one that happens to share the name.
        assert mappings.methodNamed(screen, "render", graphics) == null
            : "render(GuiGraphics) does not exist and must not resolve";
    }

    private static void keepsOnlyWhatWasAskedFor() throws IOException {
        ProguardMappings mappings = sample();
        assert mappings.classNamed("net.minecraft.client.NotWanted") == null
            : "a class nobody asked for should not be held in memory";
        assert mappings.fieldNamed("net.minecraft.client.NotWanted", "ignored") == null
            : "nor its members";
    }

    /**
     * A file written by somebody else's tool, read while a game is starting.
     * A line this does not understand is skipped; it never stops a launch.
     */
    private static void survivesRubbish() throws IOException {
        String rubbish =
            "not a class line at all\n"
            + "    an indented line with no owner -> x\n"
            + "net.minecraft.client.gui.GuiGraphics -> fhz:\n"
            + "    malformed member with no arrow\n"
            + "    void flush() -> c\n"
            + "net.minecraft.Truncated -> \n";
        ProguardMappings mappings = ProguardMappings.read(new StringReader(rubbish), wanted());
        assertEquals("fhz", mappings.classNamed("net.minecraft.client.gui.GuiGraphics"));
        assertEquals("c", mappings.methodNamed("net.minecraft.client.gui.GuiGraphics", "flush"));
    }

    private static void answersNullRatherThanGuessing() throws IOException {
        ProguardMappings mappings = sample();
        assert mappings.classNamed("net.minecraft.Absent") == null;
        assert mappings.methodNamed("net.minecraft.Absent", "gone") == null;
        assert ProguardMappings.empty().isEmpty() : "the empty mapping is empty";
        assert ProguardMappings.empty().classNamed("anything") == null;
    }

    /**
     * Against the file Mojang actually publish, when it has been fetched.
     *
     * <p>Skipped rather than failed when it is absent: this has to pass on a
     * machine with no network. The sample above is the shape; this is the
     * proof that the shape is the real one.
     */
    private static void readsTheRealFileWhenItIsHere() throws IOException {
        String path = System.getProperty("kiza.test.mappings");
        if (path == null || !new File(path).isFile()) {
            System.out.println("  (real 1.21.1 mapping not present, skipped)");
            return;
        }

        Reader reader = new InputStreamReader(new FileInputStream(path), Charset.forName("UTF-8"));
        try {
            ProguardMappings mappings = ProguardMappings.read(reader, wanted());
            String screen = "net.minecraft.client.gui.screens.Screen";
            String graphics = "net.minecraft.client.gui.GuiGraphics";

            assertEquals("fod", mappings.classNamed(screen));
            assertEquals("fhz", mappings.classNamed(graphics));
            assertEquals("a", mappings.methodNamed(screen, "render", graphics, "int", "int", "float"));
            assertEquals("b", mappings.methodNamed(screen, "renderBackground", graphics, "int", "int", "float"));
            System.out.println("  (real 1.21.1 mapping read)");
        } finally {
            reader.close();
        }
    }

    private static void assertEquals(String expected, String actual) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError("expected " + expected + " but was " + actual);
        }
    }
}
