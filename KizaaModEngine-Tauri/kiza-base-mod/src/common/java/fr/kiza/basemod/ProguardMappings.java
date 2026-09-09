package fr.kiza.basemod;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.Reader;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * Mojang's own names for a Minecraft that does not carry them.
 *
 * <p>Every other loader hands the client readable names: Fabric has Yarn or
 * intermediary, Forge has SRG, and the reflection in this mod asks for a class
 * by the name that loader uses. A plain Minecraft has none of that. Its jar is
 * obfuscated -- {@code Screen} is {@code fod}, {@code GuiGraphics} is
 * {@code fhz} -- so every lookup in this mod finds nothing, which is why the
 * client has been launcher-only there rather than broken: it never started.
 *
 * <p>Mojang publish the mapping for every release since 1.14.4, as a file the
 * version manifest already points at. This reads it. It is the fourth
 * generation of names the client understands, and the only one that has to be
 * fetched rather than guessed.
 *
 * <h2>Only what is asked for</h2>
 *
 * <p>The file is around ten megabytes and a couple of hundred thousand lines,
 * and this client needs about forty classes out of it. Keeping all of it would
 * mean holding the names of every class in the game -- inside the game's own
 * heap, while it renders -- to answer forty questions. So the wanted classes
 * are declared up front and everything else is read past and dropped.
 *
 * <h2>Why methods are keyed by their arguments</h2>
 *
 * <p>Obfuscation reuses short names heavily. Inside {@code Screen}, both
 * {@code render} and {@code renderPanorama} come out as {@code a}, and so do
 * several more. A lookup by name alone would pick whichever came first and be
 * wrong most of the time, silently, at the point where this mod injects
 * itself. The parameter types are part of the key for that reason, not for
 * tidiness.
 */
public final class ProguardMappings {

    /** Official class name to the name in the jar: {@code Screen} to {@code fod}. */
    private final Map<String, String> classes;

    /**
     * Members, keyed {@code officialClass#member(officialArgType,...)}.
     *
     * <p>One flat map rather than a map per class: the key already carries the
     * class, and forty small maps cost more than one with a few hundred
     * entries.
     */
    private final Map<String, String> members;

    private ProguardMappings(Map<String, String> classes, Map<String, String> members) {
        this.classes = classes;
        this.members = members;
    }

    /** A mapping that knows nothing, for when the file is missing or unreadable. */
    public static ProguardMappings empty() {
        return new ProguardMappings(
            Collections.<String, String>emptyMap(),
            Collections.<String, String>emptyMap()
        );
    }

    public boolean isEmpty() {
        return classes.isEmpty();
    }

    /**
     * Reads the mapping, keeping only the classes named in {@code wanted}.
     *
     * <p>Never throws for content: a line this does not understand is skipped
     * rather than failing the parse. The file is written by somebody else's
     * tool and read while a game is starting, and refusing to launch over an
     * unexpected line would be the wrong trade -- what comes back is a mapping
     * missing that entry, and a missing entry is already handled everywhere it
     * is asked for.
     */
    public static ProguardMappings read(Reader source, Set<String> wanted) throws IOException {
        Map<String, String> classes = new HashMap<String, String>();
        Map<String, String> members = new HashMap<String, String>();
        Set<String> want = new HashSet<String>(wanted);

        BufferedReader reader = new BufferedReader(source);
        String officialClass = null;
        boolean keeping = false;

        String line;
        while ((line = reader.readLine()) != null) {
            if (line.isEmpty() || line.charAt(0) == '#') continue;

            // A class line starts at column zero; its members are indented.
            if (line.charAt(0) != ' ' && line.charAt(0) != '\t') {
                officialClass = null;
                keeping = false;

                int arrow = line.indexOf(" -> ");
                if (arrow < 0 || !line.endsWith(":")) continue;

                String official = line.substring(0, arrow);
                String obfuscated = line.substring(arrow + 4, line.length() - 1);
                if (!want.contains(official)) continue;

                officialClass = official;
                keeping = true;
                classes.put(official, obfuscated);
                continue;
            }

            if (!keeping) continue;

            String member = line.trim();
            int arrow = member.indexOf(" -> ");
            if (arrow < 0) continue;
            String obfuscated = member.substring(arrow + 4);
            String declaration = member.substring(0, arrow);

            // Methods carry their source line numbers as "start:end:" before
            // the return type. Fields have no such prefix, and no arguments.
            int afterLineNumbers = declaration.lastIndexOf(':');
            if (afterLineNumbers >= 0) {
                declaration = declaration.substring(afterLineNumbers + 1);
            }

            int space = declaration.indexOf(' ');
            if (space < 0) continue;
            String signature = declaration.substring(space + 1);

            String key;
            int open = signature.indexOf('(');
            if (open < 0) {
                key = officialClass + "#" + signature;
            } else {
                int close = signature.indexOf(')', open);
                if (close < 0) continue;
                key = officialClass
                    + "#"
                    + signature.substring(0, open)
                    + "("
                    + signature.substring(open + 1, close)
                    + ")";
            }
            members.put(key, obfuscated);
        }

        return new ProguardMappings(classes, members);
    }

    /**
     * The name this class has in the jar, or {@code null} if the mapping does
     * not mention it.
     */
    public String classNamed(String officialName) {
        return classes.get(officialName);
    }

    /**
     * The name this method has in the jar.
     *
     * <p>{@code arguments} are the official parameter types, spelled as the
     * mapping spells them: fully qualified, and arrays as {@code Type[]}.
     */
    public String methodNamed(String officialClass, String method, String... arguments) {
        StringBuilder key = new StringBuilder(officialClass).append('#').append(method).append('(');
        for (int index = 0; index < arguments.length; index += 1) {
            if (index > 0) key.append(',');
            key.append(arguments[index]);
        }
        return members.get(key.append(')').toString());
    }

    /** The name this field has in the jar. */
    public String fieldNamed(String officialClass, String field) {
        return members.get(officialClass + "#" + field);
    }
}
