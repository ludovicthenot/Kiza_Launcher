package fr.kiza.basemod.menu;

import fr.kiza.basemod.shaded.jcodec.codecs.h264.H264Decoder;
import fr.kiza.basemod.shaded.jcodec.codecs.h264.H264Utils;
import fr.kiza.basemod.shaded.jcodec.codecs.h264.io.model.SeqParameterSet;
import fr.kiza.basemod.shaded.jcodec.codecs.h264.io.model.VUIParameters;
import fr.kiza.basemod.shaded.jcodec.common.Codec;
import fr.kiza.basemod.shaded.jcodec.common.DemuxerTrack;
import fr.kiza.basemod.shaded.jcodec.common.DemuxerTrackMeta;
import fr.kiza.basemod.shaded.jcodec.common.SeekableDemuxerTrack;
import fr.kiza.basemod.shaded.jcodec.common.io.NIOUtils;
import fr.kiza.basemod.shaded.jcodec.common.io.SeekableByteChannel;
import fr.kiza.basemod.shaded.jcodec.common.model.ColorSpace;
import fr.kiza.basemod.shaded.jcodec.common.model.Packet;
import fr.kiza.basemod.shaded.jcodec.common.model.Picture;
import fr.kiza.basemod.shaded.jcodec.common.model.Rect;
import fr.kiza.basemod.shaded.jcodec.containers.mp4.demuxer.MP4Demuxer;
import java.awt.image.BufferedImage;
import java.awt.image.DataBufferInt;
import java.awt.image.DirectColorModel;
import java.awt.image.Raster;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Properties;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageOutputStream;

/**
 * Turns an MP4 into the frames the menu plays, once, when it is chosen.
 *
 * <p>Measured on a 16-thread desktop, JCodec decodes H.264 at 58 frames a
 * second at 720p, 23 at 1080p, 10 at 1440p and 6 at 4K, on one core: no
 * resolution worth showing plays live at 60. So the video is decoded once,
 * ahead of time, into a JPEG per frame, which the menu later decodes in 4 ms
 * at 720p, 7 ms at 1080p and 16 ms at 1440p with the stb_image Minecraft
 * already ships -- and, each JPEG standing alone, it can skip straight to the
 * frame that is due.
 *
 * <p>The preparation is split at the video's keyframes. Each keyframe starts
 * a run H.264 can decode on its own, so the runs go to as many threads as
 * half the machine's cores, and the JPEGs are encoded on others. A run decodes
 * a little past its end: B-frames are stored after the frame they precede,
 * and the last ones of a run arrive after the next keyframe.
 *
 * <p>Colours are converted as the stream says it was encoded -- BT.709 or
 * BT.601, studio or full range -- rather than as JPEG would read them, which
 * washed most videos out. Frames larger than the chosen quality are reduced by
 * averaging, not by dropping pixels, which is what kept fine detail from
 * shimmering. The real timestamp of every frame is kept, so playback follows
 * the video's own clock, variable frame rate included.
 *
 * <p>What is written: {@code frames.bin}, the JPEGs one after the other;
 * {@code blur.bin}, a small blurred copy of each for the menus after the
 * title; {@code frames.idx}, where each frame starts and when it is shown;
 * and {@code index.properties}, which says what all of it was made from.
 */
public final class VideoPreparation {
    private VideoPreparation() {}

    /** A background loops: 30 seconds is plenty, and bounds the disk it takes. */
    private static final double MAX_SECONDS = 30D;
    /** Packets decoded past a run's end, for the B-frames that belong to it. */
    private static final int OVERRUN = 16;
    private static final float QUALITY = 0.85F;
    private static final float BLUR_QUALITY = 0.82F;
    /** The blurred copy is this many times smaller on each side. */
    private static final int BLUR_REDUCTION = 4;
    public static final int FORMAT = 2;

    /** One decoded, converted frame of a run. */
    private static final class Made {
        final int run;
        final long pts;
        final File sharp;
        final File soft;

        Made(int run, long pts, File sharp, File soft) {
            this.run = run;
            this.pts = pts;
            this.sharp = sharp;
            this.soft = soft;
        }
    }

    /** How the stream's samples become colours. */
    private static final class Colour {
        /** Fixed point, 16 bits: Y scale and offset, then the four chroma terms. */
        final int yScale;
        final int yOffset;
        final int rv;
        final int gu;
        final int gv;
        final int bu;
        final String name;

        Colour(boolean full, boolean bt709) {
            double ys = full ? 1D : 255D / 219D;
            double cs = full ? 1D : 255D / 224D;
            double kr = bt709 ? 0.2126D : 0.299D;
            double kb = bt709 ? 0.0722D : 0.114D;
            double kg = 1D - kr - kb;
            yScale = (int) Math.round(ys * 65536D);
            yOffset = full ? 0 : 16;
            rv = (int) Math.round(2D * (1D - kr) * cs * 65536D);
            bu = (int) Math.round(2D * (1D - kb) * cs * 65536D);
            gu = (int) Math.round(2D * (1D - kb) * kb / kg * cs * 65536D);
            gv = (int) Math.round(2D * (1D - kr) * kr / kg * cs * 65536D);
            name = (bt709 ? "bt709" : "bt601") + (full ? "-full" : "-limited");
        }
    }

    /**
     * Prepares {@code source} into {@code out}.
     *
     * @param maxHeight the tallest frame kept, 720 to 1440; smaller videos keep their size
     * @param maxFps the most frames a second kept, 30 or 60
     */
    public static void prepare(File source, File out, int maxHeight, int maxFps, VideoProgress progress) throws Exception {
        if (!out.isDirectory() && !out.mkdirs()) throw new IllegalStateException("no folder for the frames");
        File parts = new File(out, "parts");
        if (!parts.isDirectory() && !parts.mkdirs()) throw new IllegalStateException("no folder for the frames");

        long started = System.nanoTime();
        DemuxerTrackMeta meta;
        int[] keyframes;
        SeekableByteChannel probe = NIOUtils.readableChannel(source);
        try {
            DemuxerTrack track = MP4Demuxer.createMP4Demuxer(probe).getVideoTrack();
            if (track == null) throw new IllegalStateException("no video track");
            meta = track.getMeta();
            if (meta.getCodec() != Codec.H264) throw new IllegalStateException("codec " + meta.getCodec());
            keyframes = meta.getSeekFrames();
        } finally {
            probe.close();
        }

        int width = meta.getVideoCodecMeta().getSize().getWidth();
        int height = meta.getVideoCodecMeta().getSize().getHeight();
        double duration = meta.getTotalDuration() > 0 ? meta.getTotalDuration() : MAX_SECONDS;
        int totalFrames = meta.getTotalFrames() > 0 ? meta.getTotalFrames() : (int) (duration * 30D);
        double sourceFps = totalFrames / duration;
        double limit = Math.min(duration, MAX_SECONDS);
        final Colour colour = colour(meta.getCodecPrivate(), height);

        // The frame kept: no larger than asked, no wider than 21:9 of it, even.
        double scale = Math.min(1D, Math.min(maxHeight / (double) height, maxHeight * 21D / 9D / width));
        final int outWidth = Math.max(2, (int) Math.round(width * scale) & ~1);
        final int outHeight = Math.max(2, (int) Math.round(height * scale) & ~1);
        final int softWidth = Math.max(1, outWidth / BLUR_REDUCTION);
        final int softHeight = Math.max(1, outHeight / BLUR_REDUCTION);
        final double keepFps = Math.min(maxFps, sourceFps + 0.5D);

        // Runs: one per keyframe, up to the time limit.
        List<int[]> runs = new ArrayList<int[]>();
        if (keyframes == null || keyframes.length == 0) keyframes = new int[] {0};
        int lastFrame = (int) Math.min(totalFrames, Math.ceil(limit * sourceFps) + 1);
        for (int index = 0; index < keyframes.length; index += 1) {
            int from = keyframes[index];
            if (from >= lastFrame) break;
            int to = index + 1 < keyframes.length ? keyframes[index + 1] : totalFrames;
            runs.add(new int[] {from, to});
        }
        if (runs.isEmpty()) runs.add(new int[] {0, totalFrames});
        final int expected = (int) Math.max(1, Math.min(lastFrame, limit * keepFps));

        int cores = Runtime.getRuntime().availableProcessors();
        int budget = Math.max(2, Math.min(8, cores / 2));
        int decoders = Math.max(1, Math.min(runs.size(), budget / 2));
        int encoders = Math.max(1, budget - decoders);
        ExecutorService decoding = Executors.newFixedThreadPool(decoders, threads("kiza-video-decode"));
        final ExecutorService encoding = Executors.newFixedThreadPool(encoders, threads("kiza-video-encode"));
        // Frames waiting to be encoded, at most two an encoder: the rest of the
        // video waits in the file, not in memory.
        final Semaphore inFlight = new Semaphore(encoders * 2);
        final List<Made> made = Collections.synchronizedList(new ArrayList<Made>());
        final AtomicInteger done = new AtomicInteger();
        final AtomicReference<Throwable> failure = new AtomicReference<Throwable>();
        final File sourceFile = source;
        final File partsFolder = parts;
        final double limitSeconds = limit;
        final VideoProgress report = progress;

        List<Future<?>> pending = new ArrayList<Future<?>>();
        for (int index = 0; index < runs.size(); index += 1) {
            final int run = index;
            final int from = runs.get(index)[0];
            final int to = runs.get(index)[1];
            pending.add(decoding.submit(new Runnable() {
                @Override
                public void run() {
                    try {
                        decodeRun(sourceFile, run, from, to, limitSeconds, keepFps, colour, outWidth, outHeight,
                            softWidth, softHeight, partsFolder, encoding, inFlight, made, done, expected, report);
                    } catch (Throwable error) {
                        // One run lost is a few frames lost; the others carry on.
                        failure.compareAndSet(null, error);
                    }
                }
            }));
        }
        try {
            for (Future<?> future : pending) future.get();
            decoding.shutdown();
            encoding.shutdown();
            encoding.awaitTermination(10L, TimeUnit.MINUTES);
        } finally {
            decoding.shutdownNow();
            encoding.shutdownNow();
        }
        if (!progress.running()) return;

        List<Made> frames = new ArrayList<Made>(made);
        Collections.sort(frames, (a, b) -> a.run != b.run ? Integer.compare(a.run, b.run) : Long.compare(a.pts, b.pts));
        // Two runs never claim the same moment, but a stream can say so.
        List<Made> ordered = new ArrayList<Made>();
        for (Made frame : frames) {
            if (!ordered.isEmpty() && frame.pts <= ordered.get(ordered.size() - 1).pts) continue;
            if (frame.sharp.isFile() && frame.soft.isFile()) ordered.add(frame);
        }
        if (ordered.isEmpty()) {
            Throwable cause = failure.get();
            throw new IllegalStateException("no frame decoded" + (cause == null ? "" : ": " + cause));
        }

        long first = ordered.get(0).pts;
        long typical = Math.round(1_000_000D / Math.min(keepFps, sourceFps));
        long loop = ordered.get(ordered.size() - 1).pts - first + typical;
        File idx = new File(out, "frames.idx");
        DataOutputStream index = new DataOutputStream(new java.io.BufferedOutputStream(new FileOutputStream(idx)));
        OutputStream sharpPack = new java.io.BufferedOutputStream(new FileOutputStream(new File(out, "frames.bin")), 1 << 20);
        OutputStream softPack = new java.io.BufferedOutputStream(new FileOutputStream(new File(out, "blur.bin")), 1 << 18);
        long sharpBytes = 0L;
        long softBytes = 0L;
        try {
            index.writeInt(0x4B5A4656);
            index.writeInt(FORMAT);
            index.writeInt(ordered.size());
            byte[] copy = new byte[1 << 16];
            for (Made frame : ordered) {
                long sharpLength = append(frame.sharp, sharpPack, copy);
                long softLength = append(frame.soft, softPack, copy);
                index.writeLong(frame.pts - first);
                index.writeLong(sharpBytes);
                index.writeInt((int) sharpLength);
                index.writeLong(softBytes);
                index.writeInt((int) softLength);
                sharpBytes += sharpLength;
                softBytes += softLength;
            }
        } finally {
            index.close();
            sharpPack.close();
            softPack.close();
        }
        delete(parts);

        Properties values = new Properties();
        values.setProperty("format", String.valueOf(FORMAT));
        values.setProperty("frames", String.valueOf(ordered.size()));
        values.setProperty("duration.micros", String.valueOf(loop));
        values.setProperty("width", String.valueOf(outWidth));
        values.setProperty("height", String.valueOf(outHeight));
        values.setProperty("blur.width", String.valueOf(softWidth));
        values.setProperty("blur.height", String.valueOf(softHeight));
        values.setProperty("source.width", String.valueOf(width));
        values.setProperty("source.height", String.valueOf(height));
        values.setProperty("source.fps", String.format(java.util.Locale.ROOT, "%.3f", sourceFps));
        values.setProperty("colour", colour.name);
        values.setProperty("prepared.seconds", String.format(java.util.Locale.ROOT, "%.1f", (System.nanoTime() - started) / 1e9));
        values.setProperty("bytes", String.valueOf(sharpBytes + softBytes));
        OutputStream stream = new FileOutputStream(new File(out, "index.properties"));
        try {
            values.store(stream, "Frames of the menu video, prepared by Kiza Client");
        } finally {
            stream.close();
        }
    }

    /** Decodes one run, from its keyframe, handing each kept frame to the encoders. */
    private static void decodeRun(
        File source, int run, int from, int to, double limit, double keepFps, Colour colour,
        int outWidth, int outHeight, int softWidth, int softHeight, final File parts,
        ExecutorService encoding, final Semaphore inFlight, final List<Made> made,
        final AtomicInteger done, final int expected, final VideoProgress progress
    ) throws Exception {
        SeekableByteChannel channel = NIOUtils.readableChannel(source);
        try {
            DemuxerTrack plain = MP4Demuxer.createMP4Demuxer(channel).getVideoTrack();
            DemuxerTrackMeta meta = plain.getMeta();
            if (from > 0) {
                if (!(plain instanceof SeekableDemuxerTrack) || !((SeekableDemuxerTrack) plain).gotoFrame(from)) {
                    throw new IllegalStateException("cannot seek to frame " + from);
                }
            }
            H264Decoder decoder = H264Decoder.createH264DecoderFromCodecPrivate(meta.getCodecPrivate());
            int width = meta.getVideoCodecMeta().getSize().getWidth();
            int height = meta.getVideoCodecMeta().getSize().getHeight();
            byte[][] buffer = Picture.create((width + 15) & ~15, (height + 15) & ~15, ColorSpace.YUV420J).getData();

            // The run is what is shown from its keyframe to the next one. Every
            // packet is decoded, kept or not: the ones after depend on it.
            long runStart = Long.MIN_VALUE;
            long runEnd = Long.MAX_VALUE;
            long limitMicros = (long) (limit * 1_000_000D);
            // Over the frame rate kept, the first frame decoded of each slot of
            // time stays; under it, every frame does.
            boolean thinning = keepFps < meta.getTotalFrames() / meta.getTotalDuration() - 0.5D;
            java.util.Set<Long> slots = new java.util.HashSet<Long>();
            int count = 0;
            for (int frame = from; progress.running(); frame += 1) {
                if (frame >= to + OVERRUN) break;
                Packet packet = plain.nextFrame();
                if (packet == null) break;
                long pts = Math.round(packet.getPtsD() * 1_000_000D);
                if (frame == from) runStart = pts;
                if (frame == to) runEnd = pts;
                Picture picture;
                try {
                    picture = decoder.decodeFrame(packet.getData(), buffer);
                } catch (RuntimeException broken) {
                    // A damaged frame is skipped; what follows may still decode.
                    continue;
                }
                if (picture == null) continue;
                if (pts < runStart || pts >= runEnd || pts >= limitMicros) continue;
                if (thinning && !slots.add(Math.round(pts * keepFps / 1_000_000D))) continue;

                // Converted here, at once: the decoder writes the next frame
                // into the same planes.
                final int[] rgb = toRgb(picture, outWidth, outHeight, colour);
                final int number = count++;
                final int runIndex = run;
                final long time = pts;
                final int w = outWidth;
                final int h = outHeight;
                final int sw = softWidth;
                final int sh = softHeight;
                inFlight.acquire();
                encoding.execute(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            if (!progress.running()) return;
                            File sharp = new File(parts, "s" + runIndex + "_" + number + ".jpg");
                            File soft = new File(parts, "b" + runIndex + "_" + number + ".jpg");
                            writeJpeg(rgb, w, h, sharp, QUALITY);
                            writeJpeg(blurred(rgb, w, h, sw, sh), sw, sh, soft, BLUR_QUALITY);
                            made.add(new Made(runIndex, time, sharp, soft));
                            progress.progress(Math.min(1F, done.incrementAndGet() / (float) expected));
                        } catch (Throwable ignored) {
                            // A frame that will not encode is a frame left out.
                        } finally {
                            inFlight.release();
                        }
                    }
                });
            }
        } finally {
            channel.close();
        }
    }

    /**
     * The stream's own colour rules, from its sequence parameters. Unsaid, it
     * is what nearly every encoder writes: studio range, BT.709 for HD and
     * BT.601 below it.
     */
    private static Colour colour(ByteBuffer codecPrivate, int height) {
        boolean full = false;
        boolean bt709 = height >= 720;
        try {
            if (codecPrivate != null) {
                for (ByteBuffer raw : H264Utils.getRawSPS(codecPrivate.duplicate())) {
                    SeqParameterSet sps = SeqParameterSet.read(raw);
                    VUIParameters vui = sps.getVuiParams();
                    if (vui == null) break;
                    full = vui.videoFullRangeFlag;
                    if (vui.colourDescriptionPresentFlag) {
                        if (vui.matrixCoefficients == 1) bt709 = true;
                        else if (vui.matrixCoefficients == 5 || vui.matrixCoefficients == 6) bt709 = false;
                    }
                    break;
                }
            }
        } catch (RuntimeException unreadable) {
            // The defaults above.
        }
        return new Colour(full, bt709);
    }

    /**
     * The picture as RGB at the size kept. Larger frames are first reduced by
     * a whole factor, averaging each block -- 4K to 1080p averages four
     * samples into one -- and what is left of the ratio, under two, is made
     * up bilinearly.
     */
    static int[] toRgb(Picture picture, int outWidth, int outHeight, Colour colour) {
        Rect crop = picture.getCrop();
        int left = crop == null ? 0 : crop.getX();
        int top = crop == null ? 0 : crop.getY();
        int width = crop == null ? picture.getWidth() : crop.getWidth();
        int height = crop == null ? picture.getHeight() : crop.getHeight();
        byte[] luma = picture.getPlaneData(0);
        byte[] cb = picture.getPlaneData(1);
        byte[] cr = picture.getPlaneData(2);
        int lumaStride = picture.getPlaneWidth(0);
        int chromaStride = picture.getPlaneWidth(1);

        int factor = Math.max(1, Math.min(width / outWidth, height / outHeight));
        int reducedWidth = width / factor;
        int reducedHeight = height / factor;
        int[] rgb = new int[reducedWidth * reducedHeight];
        int area = factor * factor;
        for (int y = 0; y < reducedHeight; y += 1) {
            int sy = top + y * factor;
            int cy0 = sy >> 1;
            int cy1 = (sy + factor - 1) >> 1;
            for (int x = 0; x < reducedWidth; x += 1) {
                int sx = left + x * factor;
                int sum = 0;
                for (int dy = 0; dy < factor; dy += 1) {
                    int row = (sy + dy) * lumaStride + sx;
                    for (int dx = 0; dx < factor; dx += 1) sum += luma[row + dx] + 128;
                }
                int yValue = sum / area;
                int cx0 = sx >> 1;
                int cx1 = (sx + factor - 1) >> 1;
                int u;
                int v;
                if (cx0 == cx1 && cy0 == cy1) {
                    u = cb[cy0 * chromaStride + cx0];
                    v = cr[cy0 * chromaStride + cx0];
                } else {
                    int us = 0;
                    int vs = 0;
                    int n = 0;
                    for (int cy = cy0; cy <= cy1; cy += 1) {
                        for (int cx = cx0; cx <= cx1; cx += 1) {
                            us += cb[cy * chromaStride + cx];
                            vs += cr[cy * chromaStride + cx];
                            n += 1;
                        }
                    }
                    u = us / n;
                    v = vs / n;
                }
                int yScaled = (yValue - colour.yOffset) * colour.yScale;
                int r = (yScaled + colour.rv * v + 32768) >> 16;
                int g = (yScaled - colour.gu * u - colour.gv * v + 32768) >> 16;
                int b = (yScaled + colour.bu * u + 32768) >> 16;
                rgb[y * reducedWidth + x] = (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);
            }
        }
        if (reducedWidth == outWidth && reducedHeight == outHeight) return rgb;
        return resize(rgb, reducedWidth, reducedHeight, outWidth, outHeight);
    }

    /** Bilinear, for a ratio under two either way. */
    static int[] resize(int[] source, int width, int height, int outWidth, int outHeight) {
        int[] out = new int[outWidth * outHeight];
        double sx = width / (double) outWidth;
        double sy = height / (double) outHeight;
        for (int y = 0; y < outHeight; y += 1) {
            double fy = Math.max(0D, (y + 0.5D) * sy - 0.5D);
            int y0 = Math.min(height - 1, (int) fy);
            int y1 = Math.min(height - 1, y0 + 1);
            int wy = (int) ((fy - y0) * 256D);
            for (int x = 0; x < outWidth; x += 1) {
                double fx = Math.max(0D, (x + 0.5D) * sx - 0.5D);
                int x0 = Math.min(width - 1, (int) fx);
                int x1 = Math.min(width - 1, x0 + 1);
                int wx = (int) ((fx - x0) * 256D);
                int a = source[y0 * width + x0];
                int b = source[y0 * width + x1];
                int c = source[y1 * width + x0];
                int d = source[y1 * width + x1];
                int pixel = 0;
                for (int shift = 0; shift <= 16; shift += 8) {
                    int top = ((a >> shift) & 0xFF) * (256 - wx) + ((b >> shift) & 0xFF) * wx;
                    int bottom = ((c >> shift) & 0xFF) * (256 - wx) + ((d >> shift) & 0xFF) * wx;
                    pixel |= (((top * (256 - wy) + bottom * wy) >> 16) & 0xFF) << shift;
                }
                out[y * outWidth + x] = pixel;
            }
        }
        return out;
    }

    /**
     * The menus' copy: reduced by averaging, then three box passes, which is
     * a Gaussian close enough. Small on purpose: a blur has no detail to keep,
     * and the game draws it back up smoothly.
     */
    static int[] blurred(int[] rgb, int width, int height, int outWidth, int outHeight) {
        int fx = Math.max(1, width / outWidth);
        int fy = Math.max(1, height / outHeight);
        int[] small = new int[outWidth * outHeight];
        for (int y = 0; y < outHeight; y += 1) {
            for (int x = 0; x < outWidth; x += 1) {
                int r = 0;
                int g = 0;
                int b = 0;
                int n = 0;
                for (int dy = 0; dy < fy; dy += 1) {
                    int sy = Math.min(height - 1, y * fy + dy);
                    for (int dx = 0; dx < fx; dx += 1) {
                        int p = rgb[sy * width + Math.min(width - 1, x * fx + dx)];
                        r += (p >> 16) & 0xFF;
                        g += (p >> 8) & 0xFF;
                        b += p & 0xFF;
                        n += 1;
                    }
                }
                small[y * outWidth + x] = ((r / n) << 16) | ((g / n) << 8) | (b / n);
            }
        }
        int radius = Math.max(2, outWidth / 120);
        int[] spare = new int[small.length];
        for (int pass = 0; pass < 3; pass += 1) {
            box(small, spare, outWidth, outHeight, radius, true);
            box(spare, small, outWidth, outHeight, radius, false);
        }
        return small;
    }

    private static void box(int[] from, int[] to, int width, int height, int radius, boolean across) {
        int lines = across ? height : width;
        int length = across ? width : height;
        for (int line = 0; line < lines; line += 1) {
            int r = 0;
            int g = 0;
            int b = 0;
            for (int i = -radius; i <= radius; i += 1) {
                int p = from[at(line, Math.max(0, Math.min(length - 1, i)), width, across)];
                r += (p >> 16) & 0xFF;
                g += (p >> 8) & 0xFF;
                b += p & 0xFF;
            }
            int span = radius * 2 + 1;
            for (int i = 0; i < length; i += 1) {
                to[at(line, i, width, across)] = ((r / span) << 16) | ((g / span) << 8) | (b / span);
                int out = from[at(line, Math.max(0, i - radius), width, across)];
                int in = from[at(line, Math.min(length - 1, i + radius + 1), width, across)];
                r += ((in >> 16) & 0xFF) - ((out >> 16) & 0xFF);
                g += ((in >> 8) & 0xFF) - ((out >> 8) & 0xFF);
                b += (in & 0xFF) - (out & 0xFF);
            }
        }
    }

    private static int at(int line, int i, int width, boolean across) {
        return across ? line * width + i : i * width + line;
    }

    private static final ThreadLocal<ImageWriter> WRITERS = new ThreadLocal<ImageWriter>();

    private static void writeJpeg(int[] rgb, int width, int height, File target, float quality) throws IOException {
        DirectColorModel model = new DirectColorModel(24, 0xFF0000, 0xFF00, 0xFF);
        BufferedImage image = new BufferedImage(
            model,
            Raster.createPackedRaster(new DataBufferInt(rgb, rgb.length), width, height, width,
                new int[] {0xFF0000, 0xFF00, 0xFF}, null),
            false,
            null
        );
        ImageWriter writer = WRITERS.get();
        if (writer == null) {
            writer = ImageIO.getImageWritersByFormatName("jpeg").next();
            WRITERS.set(writer);
        }
        ImageWriteParam param = writer.getDefaultWriteParam();
        param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
        param.setCompressionQuality(quality);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(width * height / 4);
        ImageOutputStream output = ImageIO.createImageOutputStream(bytes);
        try {
            writer.setOutput(output);
            writer.write(null, new IIOImage(image, null, null), param);
        } finally {
            output.close();
        }
        OutputStream file = new FileOutputStream(target);
        try {
            bytes.writeTo(file);
        } finally {
            file.close();
        }
    }

    private static long append(File part, OutputStream pack, byte[] copy) throws IOException {
        long length = 0L;
        InputStream input = new FileInputStream(part);
        try {
            for (int read = input.read(copy); read > 0; read = input.read(copy)) {
                pack.write(copy, 0, read);
                length += read;
            }
        } finally {
            input.close();
        }
        return length;
    }

    private static int clamp(int value) {
        return value < 0 ? 0 : value > 255 ? 255 : value;
    }

    private static ThreadFactory threads(final String name) {
        final AtomicInteger number = new AtomicInteger();
        return new ThreadFactory() {
            @Override
            public Thread newThread(Runnable task) {
                Thread thread = new Thread(task, name + "-" + number.incrementAndGet());
                thread.setDaemon(true);
                // The menu is drawn meanwhile: it comes first.
                thread.setPriority(Thread.MIN_PRIORITY);
                return thread;
            }
        };
    }

    static void delete(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) delete(child);
            }
        }
        if (file.exists()) file.delete();
    }
}
