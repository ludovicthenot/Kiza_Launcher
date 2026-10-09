package fr.kiza.basemod.menu;

import java.io.File;

/**
 * The menu video, decoded with JCodec -- relocated under
 * {@code fr.kiza.basemod.shaded}, pure Java, H.264 in MP4.
 *
 * <p>Kept apart from the menu so that only the jars that carry the decoder
 * compile this class; {@code MenuBackground} finds it by name.
 */
public final class VideoDecoding {
    private VideoDecoding() {}

    /** Plays the file once through; false when it should not be tried again. */
    public static boolean play(File file, VideoSink player) throws Exception {
        fr.kiza.basemod.shaded.jcodec.common.io.SeekableByteChannel channel =
            fr.kiza.basemod.shaded.jcodec.common.io.NIOUtils.readableChannel(file);
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

            long start = System.nanoTime();
            fr.kiza.basemod.shaded.jcodec.common.model.Packet packet;
            boolean any = false;
            while (player.running() && (packet = track.nextFrame()) != null) {
                fr.kiza.basemod.shaded.jcodec.common.model.Picture picture =
                    decoder.decodeFrame(packet.getData(), buffer);
                if (picture == null) continue;
                // Wait for this frame's moment, so the video plays at its own speed.
                long due = start + (long) (packet.getPtsD() * 1_000_000_000D);
                long wait = due - System.nanoTime();
                if (wait > 0) Thread.sleep(wait / 1_000_000L, (int) (wait % 1_000_000L));
                player.show(fr.kiza.basemod.shaded.jcodec.scale.AWTUtil.toBufferedImage(picture.cropped()));
                any = true;
            }
            return any;
        } finally {
            channel.close();
        }
    }
}
