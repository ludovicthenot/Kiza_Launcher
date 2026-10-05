import { useEffect, useRef, useState } from "react";
import kizaBackdrop from "../../assets/kiza-backdrop.jpg";

/**
 * The launcher's own moving background: slow violet waves turning on
 * themselves, drawn by the graphics card rather than played from a file.
 *
 * Drawn small and shown large. The canvas is a few hundred pixels wide and the
 * page stretches it, which is both the look — soft folds of light, nothing
 * with an edge — and the reason it costs next to nothing: the shader runs on a
 * postage stamp, thirty times a second at most.
 *
 * The softness and the glow are the shader's own. They used to be a CSS blur
 * on the stretched canvas, which is a blur the size of the window redone on
 * every frame — and every pane of frosted glass above it had to redo its own
 * blur each time too. That was most of what the launcher spent on being idle.
 *
 * It holds still when nobody is looking (the window is hidden, minimised, or
 * another window has the focus — a game, most often) and when the launcher
 * has been asked to hold still, and falls back to a still picture when the
 * machine has no WebGL.
 *
 * Its colours are the theme's: the window's background for the dark between
 * the bands, the primary for their light, and a deep shade of the primary in
 * between — which, for Nebula, is exactly the violet it was drawn in. A theme
 * may name its own (`components.backdrop.glow` and `.depth`) and slow the
 * movement down or stop it (`.movement`), all read from the custom properties
 * the theme engine writes, so the Maker repaints them live like any colour.
 */

const VERTEX = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const FRAGMENT = `
precision mediump float;
uniform vec2 resolution;
uniform float time;
uniform vec3 night;  // between the bands: the window's background
uniform vec3 deep;   // the body of a band
uniform vec3 glow;   // its light: the theme's primary

// The waves at one point, before any softening.
vec3 waves(vec2 uv) {
  float radius = length(uv);
  float angle = atan(uv.y, uv.x);

  // A slow twirl: the further out, the more it has turned.
  float turn = angle + 3.4 * radius - time * 0.08;
  vec2 p = vec2(cos(turn), sin(turn)) * radius;

  // Folded once more, so the bands bend instead of running straight.
  p += 0.22 * vec2(sin(p.y * 3.4 + time * 0.13), cos(p.x * 3.0 - time * 0.11));
  float band = sin(p.x * 7.0 + sin(p.y * 2.6 + time * 0.09) * 1.8);
  float light = smoothstep(-0.7, 0.9, band);

  vec3 colour = mix(night, deep, light);
  colour = mix(colour, glow, pow(light, 3.0) * 0.85);
  return colour * (1.0 - 0.3 * radius);
}

void main() {
  // Scaled as the old, oversized canvas showed it.
  vec2 uv = (gl_FragCoord.xy - 0.5 * resolution) / resolution.y / 1.12;

  // The glow: a small gaussian over nine points (weights 1-2-1 by 1-2-1),
  // the light of each band spilling into the dark beside it. On a canvas
  // this small that is nine cheap samples, where the CSS blur it replaces
  // was a blur the size of the window.
  const float S = 0.042;
  vec3 colour = vec3(0.0);
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      float weight = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0);
      colour += weight * waves(uv + vec2(float(x), float(y)) * S);
    }
  }
  colour /= 16.0;

  // What the CSS filter used to add after the blur: more colour, more light.
  float luma = dot(colour, vec3(0.2126, 0.7152, 0.0722));
  colour = mix(vec3(luma), colour, 1.3) * 1.15;
  gl_FragColor = vec4(colour, 1.0);
}
`;

/** Pixels across the canvas really draws; the page scales it up. */
const DRAW_WIDTH = 256;
const FRAME_MS = 1000 / 30;

type Rgb = [number, number, number];

/** An HSL triple as the theme writes it — `258 90% 66%` — or nothing. */
function parseTriple(value: string): [number, number, number] | null {
  const parts = value.trim().split(/\s+/).map((part) => Number.parseFloat(part));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return [parts[0], parts[1], parts[2]];
}

function hslToRgb([hue, saturation, lightness]: [number, number, number]): Rgb {
  const s = Math.min(100, Math.max(0, saturation)) / 100;
  const l = Math.min(100, Math.max(0, lightness)) / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/**
 * What the waves are painted with right now, read off the document.
 *
 * Nebula's own values are the fallbacks, so a first paint before any theme
 * has been applied is the launcher everybody knows.
 */
function palette() {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => parseTriple(style.getPropertyValue(name));
  const background = read("--background") ?? [242, 30, 5];
  const glow = read("--kiza-backdrop-glow") ?? read("--primary") ?? [258, 90, 66];
  // The deep shade: the glow's own hue, a little less saturated, at a quarter
  // of the light. From Nebula's primary that is the violet the bands always had.
  const depth = read("--kiza-backdrop-depth") ?? [glow[0], glow[1] * 0.91, 27];
  const movement = Number.parseFloat(style.getPropertyValue("--kiza-backdrop-movement"));
  return {
    night: hslToRgb(background),
    deep: hslToRgb(depth),
    glow: hslToRgb(glow),
    movement: Number.isFinite(movement) ? Math.min(1, Math.max(0, movement)) : 1,
  };
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function KizaWaves() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
    const vertex = gl && compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = gl && compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl?.createProgram();
    if (!gl || !vertex || !fragment || !program) {
      setFailed(true);
      return;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      setFailed(true);
      return;
    }
    gl.useProgram(program);

    // One triangle pair covering the canvas.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const resolution = gl.getUniformLocation(program, "resolution");
    const time = gl.getUniformLocation(program, "time");
    const night = gl.getUniformLocation(program, "night");
    const deep = gl.getUniformLocation(program, "deep");
    const glow = gl.getUniformLocation(program, "glow");
    let movement = 1;
    const paint = () => {
      const colours = palette();
      gl.uniform3fv(night, colours.night);
      gl.uniform3fv(deep, colours.deep);
      gl.uniform3fv(glow, colours.glow);
      movement = colours.movement;
    };
    paint();

    const size = () => {
      const ratio = canvas.clientHeight / Math.max(1, canvas.clientWidth);
      canvas.width = DRAW_WIDTH;
      canvas.height = Math.max(1, Math.round(DRAW_WIDTH * ratio));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resolution, canvas.width, canvas.height);
    };
    size();
    const observer = new ResizeObserver(size);
    observer.observe(canvas);

    // Time is kept across pauses, so the waves resume where they stopped
    // rather than jumping.
    let elapsed = 0;
    let last = performance.now();
    let frame = 0;
    const draw = () => {
      gl.uniform1f(time, elapsed / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    const moving = () =>
      movement > 0 &&
      document.visibilityState === "visible" &&
      document.hasFocus() &&
      document.documentElement.dataset.animations !== "off";

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const step = now - last;
      if (step < FRAME_MS) return;
      last = now;
      elapsed += Math.min(step, 100) * movement;
      draw();
    };
    const settle = () => {
      cancelAnimationFrame(frame);
      last = performance.now();
      draw();
      if (moving()) frame = requestAnimationFrame(tick);
    };
    settle();
    document.addEventListener("visibilitychange", settle);
    window.addEventListener("focus", settle);
    window.addEventListener("blur", settle);
    // A theme is custom properties on <html>, written inline: a change of theme,
    // a colour dragged in the Maker or an accent picked in Settings all arrive
    // as a change to its style. Read once per frame however many there were.
    let repaint = 0;
    const watcher = new MutationObserver(() => {
      cancelAnimationFrame(repaint);
      repaint = requestAnimationFrame(() => {
        paint();
        settle();
      });
    });
    watcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-animations", "style"],
    });

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(repaint);
      observer.disconnect();
      watcher.disconnect();
      document.removeEventListener("visibilitychange", settle);
      window.removeEventListener("focus", settle);
      window.removeEventListener("blur", settle);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  if (failed) {
    return <img src={kizaBackdrop} alt="" className="h-full w-full object-cover" draggable={false} />;
  }
  return (
    <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
  );
}
