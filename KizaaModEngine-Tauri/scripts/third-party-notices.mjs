/**
 * Writes THIRD_PARTY_NOTICES.txt: the licence of everything Kiza ships that
 * someone else wrote.
 *
 * MIT, BSD, ISC, Apache and the rest permit shipping their code on one
 * condition: their notice goes with it. Kiza ships, in one installer:
 *
 * - the launcher (src-tauri) and Kiza Setup (kiza-setup/src-tauri), whose
 *   Rust crates come from Cargo: every crate their Windows build links,
 *   development and build-script dependencies left out;
 * - the interface, whose npm packages are bundled into the launcher: the
 *   production dependencies and everything they pull in;
 * - the Kiza Client jars, which carry ASM (the Vanilla agent) and part of
 *   JCodec (the video menu background).
 *
 * Each package's own licence files are copied as the package ships them. A
 * package that ships none is listed with its licence and authors; the full
 * text of that licence is in the file under another package that ships it.
 * Packages whose licence files are identical, byte for byte, share one copy.
 *
 * Run before every build (build-installer.mjs does). `--check` fails when the
 * file on disk is not what would be written now, without writing it.
 *
 *   node scripts/third-party-notices.mjs [--check]
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "THIRD_PARTY_NOTICES.txt");
const check = process.argv.includes("--check");

const RUST_CRATES = [
  { label: "Kiza Launcher", manifest: path.join(root, "src-tauri", "Cargo.toml") },
  { label: "Kiza Setup", manifest: path.join(root, "kiza-setup", "src-tauri", "Cargo.toml") },
];
const TARGET = "x86_64-pc-windows-msvc";

/** The file names a package keeps its licence and notices in. */
const LICENCE_FILE = /^(licen[cs]e|copying|notice|copyright|unlicense)([-._].*)?$/i;

function run(command, args, cwd) {
  // Through the shell on Windows (npm is a .cmd), so paths with spaces are quoted.
  const quoted = args.map((argument) => (/[\s&|<>^]/.test(argument) ? `"${argument}"` : argument));
  const result = spawnSync(command, quoted, {
    cwd,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr}`);
  }
  return result.stdout;
}

function licenceFiles(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => LICENCE_FILE.test(name))
    .map((name) => path.join(dir, name))
    .filter((file) => fs.statSync(file).isFile())
    .sort();
}

/**
 * Licence files below a crate's root: a `-sys` crate builds a C library from
 * sources it carries (UnRAR, bzip2, SQLite...), each with its own licence in
 * its own folder, and that code is in the program too.
 */
function nestedLicenceFiles(dir, depth = 3) {
  if (depth === 0) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !/^(tests?|examples?|benches|target|docs?|\..*)$/i.test(e.name))
    .flatMap((e) => {
      const sub = path.join(dir, e.name);
      return [...licenceFiles(sub), ...nestedLicenceFiles(sub, depth - 1)];
    });
}

/** A git dependency lives inside its repository's checkout; the licence is often at its root. */
function gitCheckoutLicences(dir) {
  let current = dir;
  for (let i = 0; i < 6; i += 1) {
    const found = licenceFiles(current);
    if (found.length) return found;
    if (fs.existsSync(path.join(current, ".git"))) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return [];
}

/* ------------------------------------------------------------------ Rust */

function rustPackages() {
  const packages = new Map();
  for (const crate of RUST_CRATES) {
    const metadata = JSON.parse(
      run("cargo", ["metadata", "--format-version", "1", "--locked", "--filter-platform", TARGET, "--manifest-path", crate.manifest], root),
    );
    const byId = new Map(metadata.packages.map((p) => [p.id, p]));
    const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
    const seen = new Set();
    const stack = [metadata.resolve.root];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      for (const dep of nodes.get(id)?.deps ?? []) {
        // Normal dependencies only: what is compiled into the program.
        if (dep.dep_kinds.some((kind) => kind.kind === null)) stack.push(dep.pkg);
      }
    }
    for (const id of seen) {
      const p = byId.get(id);
      // Kiza's own crates (paths inside this repository) are not third party.
      if (!p.source && path.resolve(p.manifest_path).startsWith(root)) continue;
      const key = `${p.name} ${p.version}`;
      const entry = packages.get(key) ?? { kind: "Rust crate", name: p.name, version: p.version, licence: p.license ?? null, authors: p.authors ?? [], usedBy: new Set(), files: [] };
      entry.usedBy.add(crate.label);
      if (!entry.files.length) {
        const dir = path.dirname(p.manifest_path);
        const files = licenceFiles(dir);
        if (p.license_file) files.push(path.resolve(dir, p.license_file));
        const own = files.length || !p.source?.startsWith("git+") ? files : gitCheckoutLicences(dir);
        // A git checkout holds the whole repository: only the crate's own files.
        const nested = p.source?.startsWith("git+") ? [] : nestedLicenceFiles(dir);
        entry.files = [...new Set([...own, ...nested])];
      }
      packages.set(key, entry);
    }
  }
  return [...packages.values()];
}

/* ------------------------------------------------------------------- npm */

function npmPackages() {
  const tree = JSON.parse(run("npm", ["ls", "--omit=dev", "--all", "--json", "--long"], root));
  const packages = new Map();
  const visit = (deps) => {
    for (const [name, dep] of Object.entries(deps ?? {})) {
      if (!dep.version || !dep.path) continue;
      const key = `${name} ${dep.version}`;
      if (!packages.has(key)) {
        let manifest = {};
        try {
          manifest = JSON.parse(fs.readFileSync(path.join(dep.path, "package.json"), "utf8"));
        } catch {
          // A package without a readable manifest still has its files.
        }
        const author = typeof manifest.author === "string" ? manifest.author : manifest.author?.name;
        packages.set(key, {
          kind: "npm package",
          name,
          version: dep.version,
          licence: typeof manifest.license === "string" ? manifest.license : manifest.license?.type ?? null,
          authors: author ? [author] : [],
          usedBy: new Set(["Kiza Launcher"]),
          files: licenceFiles(dep.path),
        });
      }
      visit(dep.dependencies);
    }
  };
  visit(tree.dependencies);
  return [...packages.values()];
}

/* ------------------------------------------------------------------ Java */

function javaLibraries() {
  const meta = (file) => [path.join(root, "kiza-base-mod", "src", file)];
  return [
    {
      kind: "Java library",
      name: "ASM",
      version: "9.7",
      licence: "BSD-3-Clause",
      authors: ["INRIA, France Telecom"],
      usedBy: new Set(["Kiza Client (Vanilla agent)"]),
      files: meta(path.join("vanilla", "resources", "META-INF", "LICENSE-asm.txt")),
    },
    {
      kind: "Java library",
      name: "JCodec",
      version: "0.2.5",
      licence: "BSD-2-Clause",
      authors: ["The JCodec project"],
      usedBy: new Set(["Kiza Client (video background)"]),
      files: meta(path.join("common", "resources", "META-INF", "LICENSE-jcodec.txt")),
    },
  ];
}

/* ----------------------------------------------------------------- write */

function normalise(text) {
  return text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

function render(all) {
  const groups = new Map();
  const bare = [];
  for (const entry of all) {
    if (!entry.files.length) {
      bare.push(entry);
      continue;
    }
    const text = entry.files
      .map((file) => `--- ${path.basename(file)} ---\n${normalise(fs.readFileSync(file, "utf8"))}`)
      .join("\n\n");
    const hash = crypto.createHash("sha256").update(text).digest("hex");
    const group = groups.get(hash) ?? { text, entries: [] };
    group.entries.push(entry);
    groups.set(hash, group);
  }

  // MPL-2.0 asks that whoever gets the program can get the source of the
  // MPL files; they are used unmodified, from their public registry.
  const source = (e) => {
    if (!/MPL/.test(e.licence ?? "")) return "";
    return e.kind === "Rust crate"
      ? ` -- source: https://crates.io/crates/${e.name}/${e.version}`
      : ` -- source: https://www.npmjs.com/package/${e.name}/v/${e.version}`;
  };
  const label = (e) => `${e.name} ${e.version}${e.licence ? ` (${e.licence})` : ""} [${e.kind}; ${[...e.usedBy].sort().join(", ")}]${source(e)}`;
  const byName = (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version);
  const counts = (kind) => all.filter((e) => e.kind === kind).length;

  const lines = [
    "Kiza Launcher: third-party notices",
    "",
    "Kiza Launcher, Kiza Setup and the Kiza Client include software written by",
    "others, each under its own licence. Their notices follow, as each package",
    "ships them. Packages with identical licence files share one copy.",
    "",
    `${counts("Rust crate")} Rust crates, ${counts("npm package")} npm packages, ${counts("Java library")} Java libraries.`,
    "Written by scripts/third-party-notices.mjs; do not edit by hand.",
    "",
    "Kizaflux runs Horizon (https://github.com/horizon-rust/horizon, MIT,",
    "Copyright (c) 2026 Ludovic Marie and the Horizon contributors), which Kiza",
    "downloads from its releases; its carry-over library, horizon-port-pack, is",
    "built into the launcher and listed below.",
    "",
  ];
  const sortedGroups = [...groups.values()].map((g) => ({ ...g, entries: g.entries.sort(byName) }));
  sortedGroups.sort((a, b) => byName(a.entries[0], b.entries[0]));
  for (const group of sortedGroups) {
    lines.push("=".repeat(78), ...group.entries.map(label), "-".repeat(78), group.text, "");
  }
  if (bare.length) {
    lines.push(
      "=".repeat(78),
      "Packages that ship no licence file. Their licence is named; its full text",
      "is in this file under a package that ships it.",
      "-".repeat(78),
      ...bare.sort(byName).map((e) => `${label(e)}${e.authors.length ? ` -- Copyright (c) ${e.authors.join(", ")}` : ""}`),
      "",
    );
  }
  return lines.join("\n");
}

const all = [...rustPackages(), ...npmPackages(), ...javaLibraries()];
const missing = all.filter((e) => e.kind === "Java library" && !e.files.every((f) => fs.existsSync(f)));
if (missing.length) throw new Error(`Missing licence files: ${missing.map((e) => e.name).join(", ")}`);
const text = render(all);

if (check) {
  const current = fs.existsSync(output) ? fs.readFileSync(output, "utf8") : "";
  if (current !== text) {
    console.error("THIRD_PARTY_NOTICES.txt is out of date: run node scripts/third-party-notices.mjs");
    process.exit(1);
  }
  console.log("THIRD_PARTY_NOTICES.txt is up to date.");
} else {
  fs.writeFileSync(output, text);
  const bare = all.filter((e) => !e.files.length).length;
  console.log(`Wrote ${path.relative(root, output)}: ${all.length} packages, ${bare} without a licence file, ${(text.length / 1024).toFixed(0)} KB.`);
}
