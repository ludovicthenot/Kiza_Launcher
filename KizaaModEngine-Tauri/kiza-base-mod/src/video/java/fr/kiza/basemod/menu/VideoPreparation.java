package fr.kiza.basemod.menu;

import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.Map;
import java.util.Properties;
import java.util.TreeMap;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageOutputStream;

/**
 * Turns an MP4 into the frames the menu plays, once, when it is chosen.
 *
 * <p>Decoding H.264 in Java while the menu is drawn is what made the video
 * stutter: a 1080p frame takes longer to decode than a 60 Hz frame lasts.
 * Done once, ahead of time, it can take as long as it needs; what is played
 * afterwards is a JPEG per frame, which a thread decodes in a few
 * milliseconds and which can be skipped to directly when one is late.
 *
 * <p>The frames are put back in the order they are shown. A video with
 * B-frames stores them out of that order -- a frame that depends on the one
 * after it is stored after it -- and JCodec hands them back as stored, so
 * they wait in a small window sorted by their time before being written.
 *
 * <p>At most 30 seconds and 60 frames a second, at most 960 by 540: a
 * background loops, and is under a veil.
 */
public final class VideoPreparation {
    private VideoPreparation() {}

    private static final double MAX_SECONDS = 30D;
    private static final double MAX_FPS = 60D;
    private static final int REORDER = 8;

    public static void prepare(File source, File out, VideoProgress progress) throws Exception {
        if (!out.isDirectory() && !out.mkdirs()) throw new IllegalStateException("no folder for the frames");
        fr.kiza.basemod.shaded.jcodec.common.io.SeekableByteChannel channel =
            fr.kiza.basemod.shaded.jcodec.common.io.NIOUtils.readableChannel(source);
        try {
            fr.kiza.basemod.shaded.jcodec.containers.mp4.demuxer.MP4Demuxer demuxer =
                fr.kiza.basemod.shaded.jcodec.containers.mp4.demuxer.MP4Demuxer.createMP4Demuxer(channel);
            fr.kiza.basemod.shaded.jcodec.common.DemuxerTrack track = demuxer.getVideoTrack();
            if (track == null) throw new IllegalStateException("no video track");
            fr.kiza.basemod.shaded.jcodec.common.DemuxerTrackMeta meta = track.getMeta();
            if (meta.getCodec() != fr.kiza.basemod.shaded.jcodec.common.Codec.H264) {
                throw new IllegalStateException("codec " + meta.getCodec());
            }
            fr.kiza.basemod.shaded.jcodec.codecs.h264.H264Decoder decoder =
                fr.kiza.basemod.shaded.jcodec.codecs.h264.H264Decoder.createH264DecoderFromCodecPrivate(meta.getCodecPrivate());
            int width = meta.getVideoCodecMeta().getSize().getWidth();
            int height = meta.getVideoCodecMeta().getSize().getHeight();
            byte[][] buffer = fr.kiza.basemod.shaded.jcodec.common.model.Picture.create(
                (width + 15) & ~15, (height + 15) & ~15,
                fr.kiza.basemod.shaded.jcodec.common.model.ColorSpace.YUV420J
            ).getData();

            double duration = meta.getTotalDuration() > 0 ? meta.getTotalDuration() : MAX_SECONDS;
            double sourceFps = meta.getTotalFrames() > 0 ? meta.getTotalFrames() / duration : 30D;
            double fps = Math.min(MAX_FPS, sourceFps);
            double limit = Math.min(duration, MAX_SECONDS);
            double step = 1D / fps;

            ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
            ImageWriteParam param = writer.getDefaultWriteParam();
            param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            param.setCompressionQuality(0.86F);

            TreeMap<Double, BufferedImage> window = new TreeMap<Double, BufferedImage>();
            double next = 0D;
            int written = 0;
            int frameWidth = 0;
            int frameHeight = 0;
            boolean done = false;
            while (!done && progress.running()) {
                fr.kiza.basemod.shaded.jcodec.common.model.Packet packet = track.nextFrame();
                if (packet != null) {
                    fr.kiza.basemod.shaded.jcodec.common.model.Picture picture =
                        decoder.decodeFrame(packet.getData(), buffer);
                    if (picture != null && packet.getPtsD() <= limit) {
                        // Copied out at once: the decoder writes the next frame
                        // into the same buffer.
                        window.put(packet.getPtsD(), MenuBackground.fit(
                            fr.kiza.basemod.shaded.jcodec.scale.AWTUtil.toBufferedImage(picture.cropped())
                        ));
                    }
                }
                if (packet == null || packet.getPtsD() > limit + 1D) done = true;
                while (!window.isEmpty() && (window.size() > REORDER || done)) {
                    Map.Entry<Double, BufferedImage> first = window.pollFirstEntry();
                    double pts = first.getKey();
                    // Fewer frames than the source when it is faster than 60.
                    if (pts + 1e-6 < next) continue;
                    BufferedImage frame = first.getValue();
                    frameWidth = frame.getWidth();
                    frameHeight = frame.getHeight();
                    File target = new File(out, String.format("frame_%05d.jpg", written));
                    ImageOutputStream output = ImageIO.createImageOutputStream(target);
                    try {
                        writer.setOutput(output);
                        writer.write(null, new IIOImage(frame, null, null), param);
                    } finally {
                        output.close();
                    }
                    written += 1;
                    next += step;
                    progress.progress((float) Math.min(1D, pts / limit));
                }
            }
            writer.dispose();
            if (!progress.running()) return;
            if (written == 0) throw new IllegalStateException("no frame decoded");

            Properties index = new Properties();
            index.setProperty("frames", String.valueOf(written));
            index.setProperty("fps", String.valueOf(fps));
            index.setProperty("width", String.valueOf(frameWidth));
            index.setProperty("height", String.valueOf(frameHeight));
            OutputStream stream = new FileOutputStream(new File(out, "index.properties"));
            try {
                index.store(stream, "Frames of the menu video, prepared by Kiza Client");
            } finally {
                stream.close();
            }
        } finally {
            channel.close();
        }
    }
}
