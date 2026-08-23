
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageJsonPath = path.resolve(__dirname, '../package.json');
const packageLockPath = path.resolve(__dirname, '../package-lock.json');
const tauriConfPath = path.resolve(__dirname, '../src-tauri/tauri.conf.json');
const cargoTomlPath = path.resolve(__dirname, '../src-tauri/Cargo.toml');

// Read package.json
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const currentVersion = packageJson.version;

// Increment version (patch)
const parts = currentVersion.split('.');
parts[2] = (parseInt(parts[2], 10) + 1).toString();
const newVersion = parts.join('.');

console.log(`Bumping version: ${currentVersion} -> ${newVersion}`);

// Update package.json
packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

if (fs.existsSync(packageLockPath)) {
  const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf-8'));
  packageLock.version = newVersion;
  if (packageLock.packages?.[""]) {
    packageLock.packages[""].version = newVersion;
  }
  fs.writeFileSync(packageLockPath, JSON.stringify(packageLock, null, 2) + '\n');
  console.log('Updated package-lock.json');
}

// Update tauri.conf.json
if (fs.existsSync(tauriConfPath)) {
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf-8'));
  tauriConf.version = newVersion;
  fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
  console.log('Updated tauri.conf.json');
} else {
  console.warn('tauri.conf.json not found, skipping...');
}

if (fs.existsSync(cargoTomlPath)) {
  const cargoToml = fs.readFileSync(cargoTomlPath, 'utf-8');
  const updatedCargoToml = cargoToml.replace(
    /^version\s*=\s*"[^"]+"/m,
    `version = "${newVersion}"`
  );
  fs.writeFileSync(cargoTomlPath, updatedCargoToml);
  console.log('Updated Cargo.toml');
} else {
  console.warn('Cargo.toml not found, skipping...');
}

// Kiza Setup carries the version it is about to install: it writes it into the
// registry as DisplayVersion, and the launcher's own updater compares against
// it. Left behind, "Apps & features" would report the wrong version for ever.
const setupConfPath = path.resolve(__dirname, '../kiza-setup/src-tauri/tauri.conf.json');
const setupCargoPath = path.resolve(__dirname, '../kiza-setup/src-tauri/Cargo.toml');

if (fs.existsSync(setupConfPath)) {
  const setupConf = JSON.parse(fs.readFileSync(setupConfPath, 'utf-8'));
  setupConf.version = newVersion;
  fs.writeFileSync(setupConfPath, JSON.stringify(setupConf, null, 2) + '\n');
  console.log('Updated kiza-setup tauri.conf.json');
} else {
  console.warn('kiza-setup tauri.conf.json not found, skipping...');
}

if (fs.existsSync(setupCargoPath)) {
  const setupCargo = fs.readFileSync(setupCargoPath, 'utf-8');
  fs.writeFileSync(
    setupCargoPath,
    setupCargo.replace(/^version\s*=\s*"[^"]+"/m, `version = "${newVersion}"`)
  );
  console.log('Updated kiza-setup Cargo.toml');
} else {
  console.warn('kiza-setup Cargo.toml not found, skipping...');
}

console.log('Version bump complete.');
