import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.commons.ClassRemapper;
import org.objectweb.asm.commons.Remapper;

/**
 * Copies the part of a library the mod uses, renamed into the mod's own package.
 *
 *     java Shade <out dir> <from prefix> <to prefix> <entry,entry,...> <jar> [<jar>...]
 *
 * <p>Starting from the entry classes it follows every class the bytecode names
 * -- superclasses, fields, calls, casts, signatures -- and copies only those,
 * with every name under {@code from} rewritten to {@code to}. A video decoder
 * that also reads MPEG-2, ProRes, VP8 and AAC ships only what H.264 in MP4
 * reaches, and under a name no other mod can share.
 *
 * <p>What is reached only by reflection is not followed. JCodec's decoding
 * path does not use it; a class missing from that path is a NoClassDefFoundError
 * the first time a video is played, which the player turns into "this video
 * cannot be read" rather than a crash.
 */
public final class Shade {
    public static void main(String[] arguments) throws IOException {
        File out = new File(arguments[0]);
        final String from = arguments[1];
        final String to = arguments[2];
        String[] entries = arguments[3].split(",");

        Map<String, byte[]> library = new HashMap<String, byte[]>();
        for (int index = 4; index < arguments.length; index += 1) {
            ZipFile jar = new ZipFile(arguments[index]);
            try {
                java.util.Enumeration<? extends ZipEntry> all = jar.entries();
                while (all.hasMoreElements()) {
                    ZipEntry entry = all.nextElement();
                    if (!entry.getName().endsWith(".class")) continue;
                    String name = entry.getName().substring(0, entry.getName().length() - ".class".length());
                    library.put(name, read(jar.getInputStream(entry)));
                }
            } finally {
                jar.close();
            }
        }

        final Set<String> seen = new HashSet<String>();
        final Deque<String> pending = new ArrayDeque<String>();
        for (String entry : entries) {
            String name = entry.trim().replace('.', '/');
            if (seen.add(name)) pending.add(name);
        }

        int copied = 0;
        long bytes = 0;
        while (!pending.isEmpty()) {
            String name = pending.poll();
            byte[] original = library.get(name);
            if (original == null) continue;

            Remapper remapper = new Remapper() {
                @Override
                public String map(String internalName) {
                    if (!internalName.startsWith(from)) return internalName;
                    // Every library class this one names is one it may need.
                    if (library.containsKey(internalName) && seen.add(internalName)) {
                        pending.add(internalName);
                    }
                    return to + internalName.substring(from.length());
                }
            };
            ClassReader reader = new ClassReader(original);
            ClassWriter writer = new ClassWriter(0);
            reader.accept(new ClassRemapper(writer, remapper), 0);
            byte[] relocated = writer.toByteArray();

            File target = new File(out, remapper.map(name) + ".class");
            target.getParentFile().mkdirs();
            FileOutputStream stream = new FileOutputStream(target);
            try {
                stream.write(relocated);
            } finally {
                stream.close();
            }
            copied += 1;
            bytes += relocated.length;
        }
        System.out.println("Shaded " + copied + " of " + library.size() + " classes (" + (bytes / 1024) + " KB).");
    }

    private static byte[] read(InputStream input) throws IOException {
        try {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int count;
            while ((count = input.read(chunk)) > 0) buffer.write(chunk, 0, count);
            return buffer.toByteArray();
        } finally {
            input.close();
        }
    }
}
