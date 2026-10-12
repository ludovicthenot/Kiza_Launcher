package fr.kiza.basemod.menu;

import java.io.BufferedReader;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.Properties;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Prepares a menu video with the FFmpeg the launcher ships, kiza-ffmpeg.exe.
 *
 * <p>JCodec, the decoder the mod carries, reads H.264 alone and misreads some
 * of it: a video from NVIDIA's encoder came out with coloured trails that
 * grew until the next keyframe. FFmpeg reads H.264 of any encoder, H.265,
 * AV1, VP9 and ProRes, in MP4, MOV, MKV and WebM, and is what this uses when
 * the launcher said where it is ({@code kiza.ffmpeg.path}); JCodec stays the
 * way without it.
 *
 * <p>One run of FFmpeg makes everything: the video at a steady rate, scaled
 * by averaging to the quality chosen, converted to JPEG's colours, written as
 * numbered JPEGs; and beside it a quarter-size copy, blurred, for the menus
 * after the title. Those are then packed exactly as {@code VideoPreparation}
 * packs its own, so playing them is the same.
 */
final class FFmpegPreparation {
    private FFmpegPreparation() {}

    private static final double MAX_SECONDS = 30D;
    private static final int FORMAT = 2;
    /**
     * The JPEG quantiser, 2 best to 31 worst. Measured on a 1080p video
     * against a near-lossless copy: 3 kept 41.3 dB in 415 KB a frame and
     * 8.6 ms to decode, 5 kept 38.3 dB in 283 KB and 7.7 ms -- no difference
     * to see on a moving background, a third less on disk.
     */
    private static final int QUALITY = 5;
    private static final long STALLED_NANOS = 60_000_000_000L;

    /** The launcher's FFmpeg, or null without one. */
    static File executable() {
        String named = System.getProperty("kiza.ffmpeg.path", "").trim();
        if (named.isEmpty()) return null;
        File file = new File(named);
        return file.isFile() ? file : null;
    }

    /** What FFmpeg says of a video before reading it all. */
    static final class Probe {
        String codec = "";
        int width;
        int height;
        double fps;
        double seconds;
        /** Filmed in HDR (PQ or HLG), as phones do: brought down to SDR on the way. */
        boolean hdr;
        /** The video's colours, in zimg's words: matrix, range, primaries, transfer. */
        String matrix;
        String range;
        String primaries;
        String transfer;
    }

    private static final Pattern SIZE = Pattern.compile("\\b(\\d{2,5})x(\\d{2,5})\\b");
    private static final Pattern FPS = Pattern.compile("([\\d.]+) fps");
    private static final Pattern DURATION = Pattern.compile("Duration: (\\d+):(\\d+):([\\d.]+)");
    /** ", yuv420p(tv, bt709, progressive)" or ", yuv420p10le(tv, bt2020nc/bt2020/smpte2084)". */
    private static final Pattern PIXELS = Pattern.compile(", ([a-z0-9]+)\\(([^)]*)\\)");
    private static final Pattern ROTATION = Pattern.compile("rotation of (-?[\\d.]+) degrees");

    static Probe probe(File ffmpeg, File source) throws IOException, InterruptedException {
        Process process = new ProcessBuilder(ffmpeg.getAbsolutePath(), "-hide_banner", "-nostdin", "-i", source.getAbsolutePath())
            .redirectErrorStream(true)
            .start();
        Probe probe = new Probe();
        boolean rotated = false;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
            for (String line; (line = reader.readLine()) != null; ) {
                Matcher duration = DURATION.matcher(line);
                if (duration.find()) {
                    probe.seconds = Integer.parseInt(duration.group(1)) * 3600D
                        + Integer.parseInt(duration.group(2)) * 60D + Double.parseDouble(duration.group(3));
                }
                int video = line.indexOf("Video: ");
                if (video >= 0 && probe.width == 0) {
                    String rest = line.substring(video + 7);
                    probe.codec = rest.split("[ ,]")[0];
                    Matcher size = SIZE.matcher(rest);
                    if (size.find()) {
                        probe.width = Integer.parseInt(size.group(1));
                        probe.height = Integer.parseInt(size.group(2));
                    }
                    Matcher fps = FPS.matcher(rest);
                    if (fps.find()) probe.fps = Double.parseDouble(fps.group(1));
                    colours(probe, rest);
                }
                Matcher rotation = ROTATION.matcher(line);
                if (rotation.find() && Math.abs(Math.abs(Double.parseDouble(rotation.group(1))) - 90D) < 1D) rotated = true;
            }
        }
        process.waitFor();
        // FFmpeg turns a phone's upright video upright on the way out: its
        // size, as it comes out, has its sides the other way round.
        if (rotated) {
            int width = probe.width;
            probe.width = probe.height;
            probe.height = width;
        }
        if (probe.width <= 0 || probe.height <= 0) throw new IOException("no video stream FFmpeg can read");
        // What players assume of a video that does not say: HD in BT.709,
        // smaller in BT.601, limited range.
        if (probe.matrix == null) probe.matrix = Math.min(probe.width, probe.height) >= 720 ? "709" : "170m";
        if (probe.range == null) probe.range = "limited";
        return probe;
    }

    /** zimg's name of a matrix, in FFmpeg's scaler's words. */
    private static String swscaleMatrix(String matrix) {
        switch (matrix) {
            case "709":
                return "bt709";
            case "170m":
                return "smpte170m";
            case "2020_ncl":
            case "2020_cl":
                return "bt2020";
            default:
                return "bt601";
        }
    }

    /** FFmpeg's name of a matrix, in zimg's words, or null for one it does not say. */
    private static String zimgMatrix(String matrix) {
        switch (matrix) {
            case "bt709":
                return "709";
            case "bt470bg":
                return "470bg";
            case "smpte170m":
                return "170m";
            case "bt2020nc":
                return "2020_ncl";
            case "bt2020c":
                return "2020_cl";
            default:
                return null;
        }
    }

    /** FFmpeg's name of primaries, in zimg's words, for the two HDR needs told. */
    private static String zimgPrimaries(String primaries) {
        switch (primaries) {
            case "bt2020":
                return "2020";
            case "bt709":
                return "709";
            default:
                return null;
        }
    }

    /**
     * Reads the colours FFmpeg names after the pixel format. zimg must be
     * told the matrix a video was made in: a stream that does not say it
     * stops it with "no path between colorspaces".
     */
    static void colours(Probe probe, String video) {
        Matcher pixels = PIXELS.matcher(video);
        if (!pixels.find()) return;
        if (pixels.group(1).startsWith("yuvj")) probe.range = "full";
        for (String token : pixels.group(2).split(",\\s*")) {
            if (token.equals("pc")) probe.range = "full";
            else if (token.equals("tv")) probe.range = "limited";
            else if (token.startsWith("bt") || token.startsWith("smpte") || token.startsWith("arib") || token.contains("/")) {
                String[] parts = token.split("/");
                // One name for all three, or matrix/primaries/transfer.
                String primaries = parts.length > 1 ? parts[1] : parts[0];
                String transfer = parts.length > 2 ? parts[2] : parts[0];
                probe.matrix = zimgMatrix(parts[0]);
                probe.primaries = zimgPrimaries(primaries);
                probe.transfer = transfer.equals("smpte2084") || transfer.equals("arib-std-b67") ? transfer : null;
                probe.hdr = probe.transfer != null;
            }
        }
    }

    static void prepare(File ffmpeg, File source, File out, int maxHeight, int maxFps, VideoProgress progress) throws Exception {
        long started = System.nanoTime();
        Probe probe = probe(ffmpeg, source);
        double scale = Math.min(1D, Math.min(maxHeight / (double) probe.height, maxHeight * 21D / 9D / probe.width));
        int width = Math.max(2, (int) Math.round(probe.width * scale) & ~1);
        int height = Math.max(2, (int) Math.round(probe.height * scale) & ~1);
        int softWidth = Math.max(2, width / 4 & ~1);
        int softHeight = Math.max(2, height / 4 & ~1);
        int fps = (int) Math.max(1, Math.min(maxFps, probe.fps > 0 ? Math.round(probe.fps) : maxFps));
        double seconds = Math.min(MAX_SECONDS, probe.seconds > 0 ? probe.seconds : MAX_SECONDS);
        int expected = (int) Math.max(1, Math.round(seconds * fps));

        File parts = new File(out, "parts");
        if (!parts.isDirectory() && !parts.mkdirs()) throw new IOException("no folder for the frames");
        // JPEG is full range in BT.601: the colours are converted to that on
        // the way, from what the video says it is in -- told outright, as a
        // stream that does not say would otherwise be read as BT.601. Measured
        // on a 1080p frame with this FFmpeg: decoding 2.9 ms of processor,
        // this conversion 5.5 (zimg's 8.3), the JPEG 13.6.
        String scaler = ":flags=area:in_color_matrix=" + swscaleMatrix(probe.matrix) + ":in_range=" + probe.range
            + ":out_color_matrix=bt601:out_range=full";
        // HDR, read as it is, comes out grey and washed out: zimg makes its
        // light linear, brings its colours into the screen's and rolls its
        // highlights off (mobius: what fits the screen stays as it was).
        String convert = probe.hdr
            ? "zscale=w=" + width + ":h=" + height + ":f=spline36:min=" + probe.matrix + ":rin=" + probe.range
                + ":pin=" + (probe.primaries == null ? "2020" : probe.primaries) + ":tin=" + probe.transfer
                + ":t=linear:npl=100,format=gbrpf32le,zscale=p=709,tonemap=tonemap=mobius:desat=0,zscale=t=709:m=470bg:r=full"
            : "scale=" + width + ":" + height + scaler;
        // The blurred copy is made from the converted frame, where nothing
        // is left to convert.
        String graph = "[0:v]fps=" + fps + "," + convert + ",format=yuvj420p,setsar=1,split=2[s][c];"
            + "[c]scale=" + softWidth + ":" + softHeight + ":flags=area,gblur=sigma=" + Math.max(2, softWidth / 90)
            + ",format=yuvj420p,setsar=1[t]";
        // Measured with a game-like loop running beside it: on 16 threads,
        // 4 prepared as fast as 16 (3.0 s against 3.1) and kept its 1 % low
        // at 127 fps against 105; on 4 cores, 1 thread kept it at 98 where 4
        // brought it to 12. A quarter of the processors, then, for decoding,
        // the filters and the encoder alike.
        String threads = String.valueOf(Math.max(1, Math.min(4, Runtime.getRuntime().availableProcessors() / 4)));
        List<String> command = Arrays.asList(
            ffmpeg.getAbsolutePath(), "-hide_banner", "-nostdin", "-v", "error", "-y",
            "-threads", threads, "-filter_threads", threads, "-filter_complex_threads", threads,
            "-t", String.valueOf(seconds),
            "-i", source.getAbsolutePath(),
            "-an", "-sn", "-dn",
            "-filter_complex", graph,
            "-map", "[s]", "-threads", threads, "-c:v", "mjpeg", "-q:v", String.valueOf(QUALITY), "-f", "image2", new File(parts, "s_%05d.jpg").getAbsolutePath(),
            "-map", "[t]", "-threads", threads, "-c:v", "mjpeg", "-q:v", "5", "-f", "image2", new File(parts, "b_%05d.jpg").getAbsolutePath()
        );
        Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
        final StringBuilder errors = new StringBuilder();
        final InputStream output = process.getInputStream();
        Thread drain = new Thread(() -> {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(output, StandardCharsets.UTF_8))) {
                for (String line; (line = reader.readLine()) != null; ) {
                    if (errors.length() < 2000) errors.append(line).append('\n');
                }
            } catch (IOException ignored) {
                // The process is gone.
            }
        }, "kiza-ffmpeg-output");
        drain.setDaemon(true);
        drain.start();
        int madeBefore = -1;
        long movedAt = System.nanoTime();
        while (process.isAlive()) {
            if (!progress.running()) {
                process.destroyForcibly();
                return;
            }
            String[] made = parts.list((dir, name) -> name.startsWith("s_"));
            int count = made == null ? 0 : made.length;
            progress.progress(Math.min(0.99F, count / (float) expected));
            // A file that holds FFmpeg without giving a frame for a minute
            // will not give one: stopped, rather than left running.
            if (count != madeBefore) {
                madeBefore = count;
                movedAt = System.nanoTime();
            } else if (System.nanoTime() - movedAt > STALLED_NANOS) {
                process.destroyForcibly();
                throw new IOException("FFmpeg made no frame for a minute");
            }
            Thread.sleep(250L);
        }
        drain.join(2000L);
        if (process.exitValue() != 0) throw new IOException("FFmpeg failed: " + errors.toString().trim());

        String[] sharp = parts.list((dir, name) -> name.startsWith("s_"));
        String[] soft = parts.list((dir, name) -> name.startsWith("b_"));
        if (sharp == null || soft == null || sharp.length == 0) throw new IOException("FFmpeg made no frame");
        Arrays.sort(sharp);
        Arrays.sort(soft);
        int count = Math.min(sharp.length, soft.length);
        long frameMicros = Math.round(1_000_000D / fps);

        long sharpBytes = 0L;
        long softBytes = 0L;
        byte[] copy = new byte[1 << 16];
        try (DataOutputStream index = new DataOutputStream(new java.io.BufferedOutputStream(new FileOutputStream(new File(out, "frames.idx"))));
             OutputStream sharpPack = new java.io.BufferedOutputStream(new FileOutputStream(new File(out, "frames.bin")), 1 << 20);
             OutputStream softPack = new java.io.BufferedOutputStream(new FileOutputStream(new File(out, "blur.bin")), 1 << 18)) {
            index.writeInt(0x4B5A4656);
            index.writeInt(FORMAT);
            index.writeInt(count);
            for (int frame = 0; frame < count; frame += 1) {
                long sharpLength = append(new File(parts, sharp[frame]), sharpPack, copy);
                long softLength = append(new File(parts, soft[frame]), softPack, copy);
                index.writeLong(frame * frameMicros);
                index.writeLong(sharpBytes);
                index.writeInt((int) sharpLength);
                index.writeLong(softBytes);
                index.writeInt((int) softLength);
                sharpBytes += sharpLength;
                softBytes += softLength;
            }
        }
        File[] leftovers = parts.listFiles();
        if (leftovers != null) {
            for (File leftover : leftovers) leftover.delete();
        }
        parts.delete();

        Properties values = new Properties();
        values.setProperty("format", String.valueOf(FORMAT));
        values.setProperty("frames", String.valueOf(count));
        values.setProperty("duration.micros", String.valueOf(count * frameMicros));
        values.setProperty("width", String.valueOf(width));
        values.setProperty("height", String.valueOf(height));
        values.setProperty("blur.width", String.valueOf(softWidth));
        values.setProperty("blur.height", String.valueOf(softHeight));
        values.setProperty("source.width", String.valueOf(probe.width));
        values.setProperty("source.height", String.valueOf(probe.height));
        values.setProperty("source.fps", String.format(java.util.Locale.ROOT, "%.3f", probe.fps));
        values.setProperty("source.codec", probe.codec);
        values.setProperty("source.hdr", String.valueOf(probe.hdr));
        values.setProperty("colour", "ffmpeg");
        values.setProperty("prepared.seconds", String.format(java.util.Locale.ROOT, "%.1f", (System.nanoTime() - started) / 1e9));
        values.setProperty("bytes", String.valueOf(sharpBytes + softBytes));
        try (OutputStream stream = new FileOutputStream(new File(out, "index.properties"))) {
            values.store(stream, "Frames of the menu video, prepared by Kiza Client with FFmpeg");
        }
    }

    private static long append(File part, OutputStream pack, byte[] copy) throws IOException {
        long length = 0L;
        try (InputStream input = new FileInputStream(part)) {
            for (int read = input.read(copy); read > 0; read = input.read(copy)) {
                pack.write(copy, 0, read);
                length += read;
            }
        }
        return length;
    }
}
