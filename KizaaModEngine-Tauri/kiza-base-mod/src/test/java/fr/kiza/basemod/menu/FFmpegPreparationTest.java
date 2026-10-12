package fr.kiza.basemod.menu;

/** How the colours a video says it is in are read from FFmpeg's description of it. */
public final class FFmpegPreparationTest {
    private FFmpegPreparationTest() {}

    private static FFmpegPreparation.Probe read(String video) {
        FFmpegPreparation.Probe probe = new FFmpegPreparation.Probe();
        FFmpegPreparation.colours(probe, video);
        return probe;
    }

    public static void main(String[] arguments) {
        FFmpegPreparation.Probe sdr = read("h264 (Main) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 5021 kb/s, 30.01 fps");
        assert "709".equals(sdr.matrix) && "limited".equals(sdr.range) && !sdr.hdr : "BT.709 in limited range";

        FFmpegPreparation.Probe pq = read("hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/smpte2084, progressive), 3840x2160, 30 fps");
        assert "2020_ncl".equals(pq.matrix) && "2020".equals(pq.primaries) && "smpte2084".equals(pq.transfer) && pq.hdr : "HDR10";

        FFmpegPreparation.Probe hlg = read("hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 1920x1080, 60 fps");
        assert hlg.hdr && "arib-std-b67".equals(hlg.transfer) : "HLG, as phones film";

        FFmpegPreparation.Probe full = read("mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 1280x720, 25 fps");
        assert "470bg".equals(full.matrix) && "full".equals(full.range) && !full.hdr : "full range BT.601";

        FFmpegPreparation.Probe silent = read("h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080, 30 fps");
        assert silent.matrix == null && silent.range == null && !silent.hdr : "nothing said, nothing assumed here";

        FFmpegPreparation.Probe jpegRange = read("h264 (High), yuvj420p(progressive), 640x360, 30 fps");
        assert "full".equals(jpegRange.range) : "a yuvj format is full range";

        System.out.println("FFmpegPreparationTest OK");
    }
}
