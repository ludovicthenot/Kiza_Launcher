package fr.kiza.basemod;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.Charset;

/**
 * Finding a Minecraft class on a game that kept none of its names.
 *
 * <p>There is no obfuscated Minecraft to test against, and there does not need
 * to be: the question is whether a lookup that fails under every loader's
 * spelling then asks the mapping and tries what it answers. So the mapping
 * here points Mojang's name at a class that really is on the classpath, and
 * resolving it proves the path -- property read, file parsed, translated name
 * loaded.
 */
public final class McNamesTest {

    /** Stands in for the obfuscated class the game would actually carry. */
    public static final class Obfuscated {}

    public static void main(String[] args) throws Exception {
        withoutAMappingNothingChanges();
        aLoadersOwnSpellingWinsWithoutReadingAnything();
        anObfuscatedNameIsFoundThroughTheMapping();
        aMappingForAnotherReleaseIsNotForced();
        System.out.println("McNamesTest OK");
    }

    private static void withoutAMappingNothingChanges() {
        System.clearProperty("kiza.minecraft.mappings");
        McNames.forget();

        assert McNames.firstClass("net.minecraft.client.gui.GuiGraphics") == null
            : "with no mapping and no loader, a Minecraft class simply is not there";
        // And a real class is still found, mapping or no mapping.
        assert McNames.firstClass("java.lang.String") == String.class;
    }

    /**
     * The common case, and the one that must stay free: under a loader the
     * first spelling resolves, so the ten-megabyte file is never opened.
     */
    private static void aLoadersOwnSpellingWinsWithoutReadingAnything() throws Exception {
        File mapping = mappingFile("net.minecraft.client.gui.GuiGraphics -> java.lang.Integer:\n");
        System.setProperty("kiza.minecraft.mappings", mapping.getAbsolutePath());
        McNames.forget();

        // java.lang.String is present, so the mapping's answer is never reached.
        assert McNames.firstClass("java.lang.String", "net.minecraft.client.gui.GuiGraphics")
            == String.class : "a name that loads wins over the mapping";
    }

    private static void anObfuscatedNameIsFoundThroughTheMapping() throws Exception {
        File mapping = mappingFile(
            "# a comment\n"
            + "net.minecraft.client.gui.GuiGraphics -> "
            + Obfuscated.class.getName() + ":\n"
            + "    void flush() -> c\n"
            + "net.minecraft.client.Other -> java.lang.Integer:\n"
        );
        System.setProperty("kiza.minecraft.mappings", mapping.getAbsolutePath());
        McNames.forget();

        Class<?> found = McNames.firstClass(
            "net.minecraft.class_332",
            "net.minecraft.client.gui.GuiGraphics"
        );
        assert found == Obfuscated.class
            : "the mapping should have answered with the class the jar carries, got " + found;
    }

    /**
     * A mapping from another release names classes this jar does not have.
     * Nothing here can fix that, and inventing a substitute would be worse
     * than admitting the lookup failed.
     */
    private static void aMappingForAnotherReleaseIsNotForced() throws Exception {
        File mapping = mappingFile(
            "net.minecraft.client.gui.GuiGraphics -> zzz.NotOnThisClasspath:\n"
        );
        System.setProperty("kiza.minecraft.mappings", mapping.getAbsolutePath());
        McNames.forget();

        assert McNames.firstClass("net.minecraft.client.gui.GuiGraphics") == null
            : "a name the jar does not carry resolves to nothing";
    }

    private static File mappingFile(String content) throws Exception {
        File file = File.createTempFile("kiza-mapping", ".txt");
        file.deleteOnExit();
        Writer writer = new OutputStreamWriter(
            new FileOutputStream(file),
            Charset.forName("UTF-8")
        );
        try {
            writer.write(content);
        } finally {
            writer.close();
        }
        return file;
    }
}
