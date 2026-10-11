package fr.kiza.basemod.menu;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;

/**
 * Which codec an MP4's video is in, read from its boxes without decoding a
 * frame: the sample description of the track whose handler is {@code vide}.
 *
 * <p>The menu plays H.264 only. A phone or a recent screen recorder writes
 * H.265 more and more, and JCodec read such a file as "not a video track",
 * which said nothing useful; this names the codec, and does it before a
 * hundred megabytes are copied for nothing.
 */
final class VideoCodec {
    private VideoCodec() {}

    /** Boxes that hold other boxes, on the way to the sample description. */
    private static final String[] CONTAINERS = {"moov", "trak", "mdia", "minf", "stbl", "edts"};

    /**
     * The four-character code of the video's sample entry -- {@code avc1},
     * {@code hvc1}... -- or null when the file has none this can find.
     */
    static String fourcc(File file) {
        try (RandomAccessFile input = new RandomAccessFile(file, "r")) {
            long[] moov = find(input, 0L, input.length(), "moov", false);
            if (moov == null) return null;
            // Each track: its handler says what it is, its sample description
            // what it is in.
            for (long at = moov[0]; at + 8 <= moov[1]; ) {
                long[] box = box(input, at, moov[1]);
                if (box == null) return null;
                if (box[3] == 1L) {
                    long[] handler = find(input, box[0], box[1], "hdlr", true);
                    if (handler != null) {
                        input.seek(handler[0] + 8);
                        if (type(input).equals("vide")) {
                            long[] description = find(input, box[0], box[1], "stsd", true);
                            if (description == null) return null;
                            // Version and flags, the entry count, then the
                            // first entry's size: its code comes after those.
                            input.seek(description[0] + 12);
                            return type(input);
                        }
                    }
                }
                at = box[2];
            }
            return null;
        } catch (IOException | RuntimeException unreadable) {
            return null;
        }
    }

    /**
     * The box at {@code at}: where its content starts and ends, where the
     * next box starts, and 1 when it is a track. Null when it is broken.
     */
    private static long[] box(RandomAccessFile input, long at, long limit) throws IOException {
        input.seek(at);
        long size = input.readInt() & 0xFFFFFFFFL;
        String type = type(input);
        long header = 8;
        if (size == 1) {
            size = input.readLong();
            header = 16;
        } else if (size == 0) {
            size = limit - at;
        }
        if (size < header || at + size > limit) return null;
        return new long[] {at + header, at + size, at + size, type.equals("trak") ? 1L : 0L, typeCode(type)};
    }

    /** The first box called {@code wanted} between two offsets, going into containers when {@code deep}. */
    private static long[] find(RandomAccessFile input, long from, long to, String wanted, boolean deep) throws IOException {
        for (long at = from; at + 8 <= to; ) {
            long[] box = box(input, at, to);
            if (box == null) return null;
            String type = typeName(box[4]);
            if (type.equals(wanted)) return box;
            if (deep && contains(type)) {
                long[] inside = find(input, box[0], box[1], wanted, true);
                if (inside != null) return inside;
            }
            at = box[2];
        }
        return null;
    }

    private static long typeCode(String type) {
        long code = 0;
        for (int index = 0; index < 4; index += 1) code = (code << 8) | (type.charAt(index) & 0xFF);
        return code;
    }

    private static String typeName(long code) {
        char[] name = new char[4];
        for (int index = 3; index >= 0; index -= 1) {
            name[index] = (char) (code & 0xFF);
            code >>= 8;
        }
        return new String(name);
    }

    /** Whether the menu can play it: H.264, or something this could not read, which the decoder then judges. */
    static boolean playable(String fourcc) {
        return fourcc == null || fourcc.equals("avc1") || fourcc.equals("avc3");
    }

    /** A name a player knows for a code. */
    static String name(String fourcc) {
        if (fourcc == null) return "?";
        switch (fourcc) {
            case "hvc1":
            case "hev1":
                return "H.265 (HEVC)";
            case "av01":
                return "AV1";
            case "vp09":
                return "VP9";
            case "vp08":
                return "VP8";
            case "mp4v":
                return "MPEG-4";
            case "apcn":
            case "apch":
            case "apcs":
            case "apco":
            case "ap4h":
                return "ProRes";
            default:
                return fourcc;
        }
    }

    private static boolean contains(String type) {
        for (String container : CONTAINERS) if (container.equals(type)) return true;
        return false;
    }

    private static String type(RandomAccessFile input) throws IOException {
        byte[] code = new byte[4];
        input.readFully(code);
        return new String(code, java.nio.charset.StandardCharsets.ISO_8859_1);
    }
}
