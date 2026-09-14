/**
 * Reading a skin texture: which arm width it was drawn for, and a flat
 * front view for thumbnails.
 *
 * Both are pure functions of the pixels, so they can be tested without a
 * canvas, and both follow the layout Minecraft has used since 1.8 (with the
 * 64x32 layout before it, which mirrored the right limbs onto the left).
 */

export type SkinVariant = "classic" | "slim";

export function pngDataUrl(base64: string): string {
  return `data:image/png;base64,${base64}`;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be decoded."));
    image.src = src;
  });
}

type Rect = [x: number, y: number, w: number, h: number];

/** Every pixel of the region has alpha 0. */
function transparent(pixels: Uint8ClampedArray, width: number, [x, y, w, h]: Rect): boolean {
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      if (pixels[(row * width + col) * 4 + 3] !== 0) return false;
    }
  }
  return true;
}

/**
 * A slim skin leaves the outer column of each arm unpainted — the strip a
 * classic arm would use and a three-pixel arm never reaches. When every one
 * of those strips is fully transparent, the texture was drawn for slim arms.
 */
export function detectVariant(pixels: Uint8ClampedArray, width: number, height: number): SkinVariant {
  if (width !== 64 || (height !== 64 && height !== 32)) return "classic";
  const strips: Rect[] = [
    [50, 16, 2, 4],
    [54, 20, 2, 12],
  ];
  if (height === 64) strips.push([42, 48, 2, 4], [46, 52, 2, 12]);
  return strips.every((strip) => transparent(pixels, width, strip)) ? "slim" : "classic";
}

/** `detectVariant` on a decoded image, through a scratch canvas. */
export function detectVariantOf(image: HTMLImageElement): SkinVariant {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) return "classic";
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  return detectVariant(data, canvas.width, canvas.height);
}

interface Part {
  /** Where the part lands, in skin units (the figure is 16 wide, 32 tall). */
  at: [x: number, y: number];
  base: Rect;
  overlay?: Rect;
  /** Drawn mirrored, for the left limbs of a 64x32 skin. */
  mirror?: boolean;
}

/**
 * The front faces, base then overlay, laid out as the figure stands.
 */
export function frontParts(legacy: boolean, slim: boolean): Part[] {
  const arm = slim ? 3 : 4;
  const parts: Part[] = [
    { at: [4, 0], base: [8, 8, 8, 8], overlay: [40, 8, 8, 8] },
    { at: [4, 8], base: [20, 20, 8, 12], overlay: legacy ? undefined : [20, 36, 8, 12] },
    // Right arm and leg: the viewer's left.
    { at: [4 - arm, 8], base: [44, 20, arm, 12], overlay: legacy ? undefined : [44, 36, arm, 12] },
    { at: [4, 20], base: [4, 20, 4, 12], overlay: legacy ? undefined : [4, 36, 4, 12] },
  ];
  if (legacy) {
    parts.push(
      { at: [12, 8], base: [44, 20, arm, 12], mirror: true },
      { at: [8, 20], base: [4, 20, 4, 12], mirror: true },
    );
  } else {
    parts.push(
      { at: [12, 8], base: [36, 52, arm, 12], overlay: [52, 52, arm, 12] },
      { at: [8, 20], base: [20, 52, 4, 12], overlay: [4, 52, 4, 12] },
    );
  }
  return parts;
}

/**
 * The figure seen from the front, `scale` pixels per skin unit, drawn into
 * the top-left of the canvas. Sixteen by thirty-two units.
 */
export function drawSkinFront(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource & { width: number; height: number },
  variant: SkinVariant,
  scale: number,
): void {
  const legacy = image.height === 32;
  context.imageSmoothingEnabled = false;
  for (const part of frontParts(legacy, variant === "slim")) {
    const [x, y] = part.at;
    for (const source of [part.base, part.overlay]) {
      if (!source) continue;
      const [sx, sy, sw, sh] = source;
      context.save();
      if (part.mirror) {
        context.translate((x + sw) * scale, y * scale);
        context.scale(-1, 1);
        context.drawImage(image, sx, sy, sw, sh, 0, 0, sw * scale, sh * scale);
      } else {
        context.drawImage(image, sx, sy, sw, sh, x * scale, y * scale, sw * scale, sh * scale);
      }
      context.restore();
    }
  }
}

/** The front of a cape: ten by sixteen units at (1,1) of a 64x32 texture. */
export function drawCapeFront(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource & { width: number; height: number },
  scale: number,
): void {
  const unit = image.width / 64;
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 1 * unit, 1 * unit, 10 * unit, 16 * unit, 0, 0, 10 * scale, 16 * scale);
}
