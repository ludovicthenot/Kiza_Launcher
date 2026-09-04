import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(root, "build");
const testClassesDir = path.join(buildDir, "test-classes");
const assetsDir = path.join(root, "..", "src-tauri", "assets");
const modVersion = "1.3.4";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function rgbaPng(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue, alpha] = pixel(x, y);
      const offset = row + 1 + x * 4;
      raw[offset] = red;
      raw[offset + 1] = green;
      raw[offset + 2] = blue;
      raw[offset + 3] = alpha;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function generateUiAssets(classesDir) {
  const guiDir = path.join(
    classesDir,
    "assets",
    "minecraft",
    "textures",
    "gui",
  );
  const widgetDir = path.join(
    guiDir,
    "sprites",
    "widget",
  );
  await mkdir(widgetDir, { recursive: true });
  const bundledUiDir = path.join(assetsDir, "kiza-ui");
  await mkdir(bundledUiDir, { recursive: true });

  const styles = {
    "button.png": {
      surface: [23, 21, 34, 248],
      border: [55, 50, 69, 255],
      accent: [91, 71, 132, 255],
    },
    "button_highlighted.png": {
      surface: [34, 27, 51, 252],
      border: [139, 92, 246, 255],
      accent: [139, 92, 246, 255],
    },
    "button_disabled.png": {
      surface: [17, 16, 25, 220],
      border: [40, 37, 49, 220],
      accent: [56, 48, 72, 220],
    },
  };

  const roundedInside = (x, y, width, height, radius) => {
    const px = x + 0.5;
    const py = y + 0.5;
    const dx = Math.max(radius - px, 0, px - (width - radius));
    const dy = Math.max(radius - py, 0, py - (height - radius));
    return dx * dx + dy * dy <= radius * radius;
  };

  const buttonPixel = (style, x, y) => {
    if (!roundedInside(x, y, 200, 20, 4)) return [0, 0, 0, 0];
    const inner = x > 0
      && x < 199
      && y > 0
      && y < 19
      && roundedInside(x - 1, y - 1, 198, 18, 3);
    if (!inner) return style.border;
    if (x <= 2 && y >= 4 && y <= 15) return style.accent;
    return style.surface;
  };

  for (const [fileName, style] of Object.entries(styles)) {
    const image = rgbaPng(200, 20, (x, y) => buttonPixel(style, x, y));
    await writeFile(path.join(widgetDir, fileName), image);
    await writeFile(path.join(bundledUiDir, fileName), image);
  }

  // Minecraft 1.7-1.12 reads all three button states from widgets.png
  // instead of the modern widget sprite directory.
  const legacyStates = [
    { top: 46, style: styles["button_disabled.png"] },
    { top: 66, style: styles["button.png"] },
    { top: 86, style: styles["button_highlighted.png"] },
  ];
  const legacyWidgets = rgbaPng(256, 256, (x, y) => {
    if (x >= 200) return [0, 0, 0, 0];
    const state = legacyStates.find(({ top }) => y >= top && y < top + 20);
    return state ? buttonPixel(state.style, x, y - state.top) : [0, 0, 0, 0];
  });
  await writeFile(path.join(guiDir, "widgets.png"), legacyWidgets);
  await writeFile(path.join(bundledUiDir, "widgets.png"), legacyWidgets);
}

async function filesUnder(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(entryPath, extension));
    else if (entry.name.endsWith(extension)) files.push(entryPath);
  }
  return files;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function buildVariant(name, options = {}) {
  // Minecraft 1.17.x declares Java 16 in its Mojang manifest, so class files
  // targeting 17 are rejected outright there. The legacy variant goes lower
  // still: 1.8-1.12 run on the Java 8 the game ships with.
  const { release = "16", extraSources = [] } = options;
  const classesDir = path.join(buildDir, `${name}-classes`);
  const outputJar = path.join(buildDir, "libs", `kiza-base-mod-${name}-${modVersion}.jar`);
  const bundledJar = path.join(assetsDir, `kiza-base-mod-${name}.jar`);
  const commonSources = await filesUnder(path.join(root, "src", "common", "java"), ".java");
  const { sourceLoader = name, stubLoader = name } = options;
  const loaderSources = await filesUnder(path.join(root, "src", sourceLoader, "java"), ".java");
  const commonStubSources = await filesUnder(path.join(root, "src", "stubs", "common", "java"), ".java");
  const loaderStubSources = await filesUnder(path.join(root, "src", "stubs", stubLoader, "java"), ".java");

  await mkdir(classesDir, { recursive: true });
  await run("javac", [
    "--release", release,
    "-encoding", "UTF-8",
    "-d", classesDir,
    ...commonSources,
    ...loaderSources,
    ...extraSources,
    ...commonStubSources,
    ...loaderStubSources,
  ]);

  // The loader supplies compile-time stubs at runtime. Never package them.
  await rm(path.join(classesDir, "net"), { recursive: true, force: true });
  await rm(path.join(classesDir, "org"), { recursive: true, force: true });
  await rm(path.join(classesDir, "com"), { recursive: true, force: true });
  await cp(path.join(root, "src", "common", "resources"), classesDir, { recursive: true });
  await cp(path.join(root, "src", name, "resources"), classesDir, { recursive: true });
  await generateUiAssets(classesDir);
  await mkdir(path.dirname(outputJar), { recursive: true });
  await run("jar", [
    "--create",
    "--file", outputJar,
    "--date=2025-01-01T00:00:00Z",
    "-C", classesDir,
    ".",
  ]);

  await mkdir(assetsDir, { recursive: true });
  await cp(outputJar, bundledJar);
  return classesDir;
}

await rm(buildDir, { recursive: true, force: true });
await rm(path.join(assetsDir, "kiza-base-mod.jar"), { force: true });
const fabricClassesDir = await buildVariant("fabric");
const forgeClassesDir = await buildVariant("forge");
// 1.14-1.16 Fabric runs on Java 8 and still uses the immediate/MatrixStack
// transition-era screen renderers. Keep it separate from the Java 16+ jar.
await buildVariant("fabric-legacy", {
  release: "8",
  sourceLoader: "fabric",
  stubLoader: "fabric",
});
// 1.7-1.12 Forge: Java 8 bytecode, and it reuses the modern variant's state
// detector, which is pure reflection over net.minecraft.client.Minecraft.
await buildVariant("forge-legacy", {
  release: "8",
  extraSources: [
    path.join(root, "src", "forge", "java", "fr", "kiza", "basemod", "ForgeMinecraftStateDetector.java"),
  ],
});
// 1.13-1.16 Forge: same sources and mods.toml shape as the modern variant, but
// the game runs on Java 8, so the bytecode target is the only real difference.
await buildVariant("forge-mid", {
  release: "8",
  sourceLoader: "forge",
  stubLoader: "forge",
});

if (process.argv.includes("--preview")) {
  // The HUD is the one part of the runtime whose defect is visual: a panel too
  // transparent over snow, a stack that collides with the hotbar. Neither shows
  // up in a unit test, and launching Minecraft to find out is a loop nobody
  // runs twice. So it renders itself to a file.
  await mkdir(testClassesDir, { recursive: true });
  const previewSources = await filesUnder(path.join(root, "src", "test", "java"), ".java");
  // The same stubs the tests compile against: some of those sources stand in
  // for Minecraft classes that are not on this classpath.
  const previewStubs = await filesUnder(
    path.join(root, "src", "stubs", "common", "java"),
    ".java",
  );
  await run("javac", [
    "--release", "17",
    "-encoding", "UTF-8",
    "-cp", `${fabricClassesDir}${path.delimiter}${forgeClassesDir}`,
    "-d", testClassesDir,
    ...previewStubs,
    ...previewSources,
  ]);
  const output = path.join(buildDir, "hud-preview.png");
  await run("java", [
    "-Djava.awt.headless=true",
    "-cp", `${fabricClassesDir}${path.delimiter}${testClassesDir}`,
    "fr.kiza.basemod.hud.HudPreview",
    output,
  ]);
}

if (process.argv.includes("--test")) {
  await mkdir(testClassesDir, { recursive: true });
  const testSources = await filesUnder(path.join(root, "src", "test", "java"), ".java");
  const testStubSources = await filesUnder(
    path.join(root, "src", "stubs", "common", "java"),
    ".java",
  );
  await run("javac", [
    "--release", "17",
    "-encoding", "UTF-8",
    "-cp", `${fabricClassesDir}${path.delimiter}${forgeClassesDir}`,
    "-d", testClassesDir,
    ...testStubSources,
    ...testSources,
  ]);
  await run("java", [
    "-ea",
    "-cp", `${fabricClassesDir}${path.delimiter}${forgeClassesDir}${path.delimiter}${testClassesDir}`,
    "fr.kiza.basemod.StateFilePublisherTest",
  ]);
  await run("java", [
    "-ea",
    "-cp", `${fabricClassesDir}${path.delimiter}${forgeClassesDir}${path.delimiter}${testClassesDir}`,
    "fr.kiza.basemod.ClientRuntimeTest",
  ]);
  await run("java", [
    "-ea",
    "-cp", `${forgeClassesDir}${path.delimiter}${testClassesDir}`,
    "fr.kiza.basemod.ForgeMinecraftStateDetectorTest",
  ]);
  await run("java", [
    "-ea",
    "-cp", `${fabricClassesDir}${path.delimiter}${testClassesDir}`,
    "fr.kiza.basemod.MenuLogoRendererTest",
  ]);
  await run("java", [
    "-ea",
    "-cp", `${fabricClassesDir}${path.delimiter}${testClassesDir}`,
    "fr.kiza.basemod.window.BorderlessWindowManagerTest",
  ]);
  await run("java", [
    "-ea",
    "-cp", `${fabricClassesDir}${path.delimiter}${testClassesDir}`,
    "fr.kiza.basemod.mixin.fabric.FabricMixinVersionSelectorTest",
  ]);
  await run("java", [
    "-ea",
    "-cp", `${fabricClassesDir}${path.delimiter}${testClassesDir}`,
    "fr.kiza.basemod.hud.HudTest",
  ]);
  // The stubbed GuiComponent/RenderSystem only exist in the test class dir, so
  // this one must not see the packaged classes first.
  await run("java", [
    "-ea",
    "-cp", `${testClassesDir}${path.delimiter}${fabricClassesDir}`,
    "fr.kiza.basemod.render.GuiDispatchTest",
  ]);
}
