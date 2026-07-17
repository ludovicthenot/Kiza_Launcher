import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(root, "build");
const testClassesDir = path.join(buildDir, "test-classes");
const assetsDir = path.join(root, "..", "src-tauri", "assets");

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

async function buildVariant(name) {
  const classesDir = path.join(buildDir, `${name}-classes`);
  const outputJar = path.join(buildDir, "libs", `kiza-base-mod-${name}-1.0.0.jar`);
  const bundledJar = path.join(assetsDir, `kiza-base-mod-${name}.jar`);
  const commonSources = await filesUnder(path.join(root, "src", "common", "java"), ".java");
  const loaderSources = await filesUnder(path.join(root, "src", name, "java"), ".java");
  const stubSources = await filesUnder(path.join(root, "src", "stubs", name, "java"), ".java");

  await mkdir(classesDir, { recursive: true });
  await run("javac", [
    "--release", "17",
    "-encoding", "UTF-8",
    "-d", classesDir,
    ...commonSources,
    ...loaderSources,
    ...stubSources,
  ]);

  // The loader supplies compile-time stubs at runtime. Never package them.
  await rm(path.join(classesDir, "net"), { recursive: true, force: true });
  await cp(path.join(root, "src", name, "resources"), classesDir, { recursive: true });
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

if (process.argv.includes("--test")) {
  await mkdir(testClassesDir, { recursive: true });
  const testSources = await filesUnder(path.join(root, "src", "test", "java"), ".java");
  await run("javac", [
    "--release", "17",
    "-encoding", "UTF-8",
    "-cp", `${fabricClassesDir}${path.delimiter}${forgeClassesDir}`,
    "-d", testClassesDir,
    ...testSources,
  ]);
  await run("java", [
    "-ea",
    "-cp", `${fabricClassesDir}${path.delimiter}${forgeClassesDir}${path.delimiter}${testClassesDir}`,
    "fr.kiza.basemod.StateFilePublisherTest",
  ]);
  await run("java", [
    "-ea",
    "-cp", `${forgeClassesDir}${path.delimiter}${testClassesDir}`,
    "fr.kiza.basemod.ForgeMinecraftStateDetectorTest",
  ]);
}
