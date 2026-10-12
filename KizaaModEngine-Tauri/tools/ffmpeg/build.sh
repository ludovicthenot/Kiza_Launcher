#!/usr/bin/env bash
# Builds kiza-ffmpeg.exe: the FFmpeg the Kiza Client prepares menu videos with.
#
# FFmpeg, LGPL 2.1, static, for Windows x64, cross-compiled with mingw-w64 on
# Ubuntu (WSL works). Everything is disabled, then only what turns a video
# file into JPEG frames is put back:
#
#   decoders   H.264, H.265, VP8, VP9, AV1 (dav1d), MPEG-4 Part 2, ProRes
#   demuxers   MP4/MOV, Matroska/WebM
#   filters    zscale (zimg) to resize and convert colours, tonemap for HDR,
#              transpose and flips for a phone's rotated video, fps, format,
#              split, scale, gblur, and a graph's buffers
#   encoder    MJPEG, written as numbered files or to a pipe
#
# No network, no audio, no ffplay or ffprobe, no external library but dav1d
# (BSD 2-clause) and zimg (WTFPL). No --enable-gpl and no --enable-nonfree: the result stays
# LGPL and may ship inside the launcher, with this script and the source
# versions below as the corresponding source.
#
# Needs: mingw-w64 nasm pkg-config meson ninja-build make curl xz-utils, and
# autoconf automake libtool for zimg
#   sudo apt-get install mingw-w64 nasm pkg-config meson ninja-build xz-utils autoconf automake libtool
#
# Usage: tools/ffmpeg/build.sh    writes src-tauri/assets/ffmpeg/, which the launcher embeds
set -euo pipefail

FFMPEG_VERSION=8.1.3
FFMPEG_SHA256=7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3
DAV1D_VERSION=1.5.4
DAV1D_SHA256=a1d5b63d2d38ec9bd03acf643caa51fa22edd1e89c5a109c4807717216bbec07
ZIMG_VERSION=3.0.6
ZIMG_SHA256=be89390f13a5c9b2388ce0f44a5e89364a20c1c57ce46d382b1fcc3967057577

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../../src-tauri/assets/ffmpeg"
WORK="${WORK:-$HOME/kiza-ffmpeg-build}"
PREFIX="$WORK/prefix"
JOBS="$(nproc)"
mkdir -p "$WORK" "$PREFIX" "$OUT"
cd "$WORK"

fetch() {
  local url="$1" file="$2" sum="$3"
  [ -f "$file" ] || curl -fL --retry 3 -o "$file" "$url"
  local actual
  actual="$(sha256sum "$file" | cut -d' ' -f1)"
  if [ "$sum" = "PIN_ME" ]; then
    echo "sha256 of $file: $actual (pin it in build.sh)"
  elif [ "$actual" != "$sum" ]; then
    echo "sha256 mismatch for $file: $actual" >&2
    exit 1
  fi
}

fetch "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz" "ffmpeg-$FFMPEG_VERSION.tar.xz" "$FFMPEG_SHA256"
fetch "https://code.videolan.org/videolan/dav1d/-/archive/$DAV1D_VERSION/dav1d-$DAV1D_VERSION.tar.gz" "dav1d-$DAV1D_VERSION.tar.gz" "$DAV1D_SHA256"
fetch "https://github.com/sekrit-twc/zimg/archive/refs/tags/release-$ZIMG_VERSION.tar.gz" "zimg-$ZIMG_VERSION.tar.gz" "$ZIMG_SHA256"

# ---- zimg, static: zscale, to bring HDR video down to the menu's SDR ----------
rm -rf "zimg-release-$ZIMG_VERSION"
tar xf "zimg-$ZIMG_VERSION.tar.gz"
(
  cd "zimg-release-$ZIMG_VERSION"
  ./autogen.sh
  ./configure --host=x86_64-w64-mingw32 --prefix="$PREFIX" --enable-static --disable-shared
  make -j"$JOBS"
  make install
)

# ---- dav1d, static -------------------------------------------------------------
rm -rf "dav1d-$DAV1D_VERSION"
tar xf "dav1d-$DAV1D_VERSION.tar.gz"
cat > mingw-cross.txt <<CROSS
[binaries]
c = 'x86_64-w64-mingw32-gcc'
ar = 'x86_64-w64-mingw32-ar'
strip = 'x86_64-w64-mingw32-strip'
windres = 'x86_64-w64-mingw32-windres'
nasm = 'nasm'

[host_machine]
system = 'windows'
cpu_family = 'x86_64'
cpu = 'x86_64'
endian = 'little'
CROSS
(
  cd "dav1d-$DAV1D_VERSION"
  meson setup build --cross-file ../mingw-cross.txt --prefix "$PREFIX" --libdir lib \
    --default-library=static --buildtype=release \
    -Denable_tools=false -Denable_tests=false -Denable_examples=false
  ninja -C build install
)

# ---- FFmpeg ------------------------------------------------------------------
rm -rf "ffmpeg-$FFMPEG_VERSION"
tar xf "ffmpeg-$FFMPEG_VERSION.tar.xz"
(
  cd "ffmpeg-$FFMPEG_VERSION"
  PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig" ./configure \
    --prefix="$PREFIX" \
    --target-os=mingw32 --arch=x86_64 --cross-prefix=x86_64-w64-mingw32- \
    --pkg-config=pkg-config --pkg-config-flags=--static \
    --enable-static --disable-shared \
    --disable-everything --disable-autodetect \
    --disable-doc --disable-debug --disable-network \
    --disable-ffplay --disable-ffprobe --enable-ffmpeg \
    --disable-avdevice \
    --enable-w32threads \
    --enable-libdav1d --enable-libzimg \
    --enable-protocol=file,pipe \
    --enable-demuxer=mov,matroska \
    --enable-parser=h264,hevc,vp8,vp9,av1,mpeg4video \
    --enable-bsf=vp9_superframe_split,av1_frame_split,av1_frame_merge,extract_extradata \
    --enable-decoder=h264,hevc,vp8,vp9,libdav1d,mpeg4,prores \
    --enable-filter=buffer,buffersink,format,scale,fps,split,gblur,null,setsar,zscale,tonemap,transpose,hflip,vflip \
    --enable-encoder=mjpeg,wrapped_avframe \
    --enable-muxer=image2,image2pipe,mjpeg,null \
    --extra-cflags="-I$PREFIX/include" \
    --extra-ldflags="-L$PREFIX/lib -static -static-libgcc"
  make -j"$JOBS"
  x86_64-w64-mingw32-strip -o "$OUT/kiza-ffmpeg.exe" ffmpeg.exe
  cp COPYING.LGPLv2.1 "$OUT/LICENSE-ffmpeg.txt"
)
cp "dav1d-$DAV1D_VERSION/COPYING" "$OUT/LICENSE-dav1d.txt"
cp "zimg-release-$ZIMG_VERSION/COPYING" "$OUT/LICENSE-zimg.txt"
cat > "$OUT/SOURCES.txt" <<SOURCES
kiza-ffmpeg.exe is FFmpeg $FFMPEG_VERSION (LGPL 2.1 or later) with dav1d $DAV1D_VERSION (BSD 2-clause)
and zimg $ZIMG_VERSION (WTFPL), unmodified, built by build.sh beside it (tools/ffmpeg/build.sh
in the Kiza Launcher repository) from:
  https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz
  https://code.videolan.org/videolan/dav1d/-/archive/$DAV1D_VERSION/dav1d-$DAV1D_VERSION.tar.gz
  https://github.com/sekrit-twc/zimg/archive/refs/tags/release-$ZIMG_VERSION.tar.gz
SOURCES
ls -la "$OUT"
