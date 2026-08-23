/**
 * Kiza Setup's interface.
 *
 * Deliberately one file with no framework and no bundler: the installer is the
 * one binary that has to work on a machine where nothing else does, and every
 * dependency it carries is another thing that can be the reason it does not.
 *
 * Rust decides what is about to happen — see `build_plan`. This file only draws
 * that decision and reports what the user chooses.
 */

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { getCurrentWindow } = window.__TAURI__.window;

/* ------------------------------------------------------------------ wording */

/* Two languages, picked from the system rather than asked for: an installer
   that opens with a language question is a wizard, which is the thing this is
   not. The launcher's own picker takes over afterwards. */
const FRENCH = (navigator.language || "en").toLowerCase().startsWith("fr");

const TEXT = {
  install: { en: "Install", fr: "Installer" },
  installing: { en: "Installing…", fr: "Installation…" },
  update: { en: "Update", fr: "Mettre à jour" },
  updating: { en: "Updating…", fr: "Mise à jour…" },
  play: { en: "Start Kiza Launcher", fr: "Lancer Kiza Launcher" },
  close: { en: "Close", fr: "Fermer" },
  cancel: { en: "Cancel", fr: "Annuler" },
  uninstall: { en: "Uninstall", fr: "Désinstaller" },
  uninstalling: { en: "Removing…", fr: "Suppression…" },
  desktopShortcut: { en: "Desktop shortcut", fr: "Raccourci sur le bureau" },
  startMenuShortcut: { en: "Start menu entry", fr: "Entrée dans le menu Démarrer" },
  removeData: {
    en: "Also delete my instances, worlds and accounts",
    fr: "Supprimer aussi mes instances, mes mondes et mes comptes",
  },
  readyToInstall: {
    en: "Everything needed is inside this installer. Nothing will be downloaded.",
    fr: "Tout est dans cet installateur. Rien ne sera téléchargé.",
  },
  readyToUpdate: (from, to) => ({
    en: `Version ${from} will be replaced by ${to}. Your instances and worlds are untouched.`,
    fr: `La version ${from} sera remplacée par la ${to}. Vos instances et vos mondes ne bougent pas.`,
  }),
  installedTitle: { en: "Ready to play", fr: "C'est prêt" },
  installedBody: {
    en: "Kiza Launcher is installed.",
    fr: "Kiza Launcher est installé.",
  },
  updatedBody: {
    en: "Kiza Launcher is up to date.",
    fr: "Kiza Launcher est à jour.",
  },
  uninstallTitle: { en: "Remove Kiza Launcher", fr: "Désinstaller Kiza Launcher" },
  uninstallBody: {
    en: "The program will be removed. Your instances, worlds and accounts stay on this computer unless you say otherwise.",
    fr: "Le programme sera supprimé. Vos instances, vos mondes et vos comptes restent sur cet ordinateur, sauf si vous en décidez autrement.",
  },
  uninstalledTitle: { en: "Removed", fr: "Supprimé" },
  uninstalledBody: {
    en: "Kiza Launcher is no longer installed.",
    fr: "Kiza Launcher n'est plus installé.",
  },
  leftBehind: (count) => ({
    en: `${count} file(s) were in use and could not be removed.`,
    fr: `${count} fichier(s) étaient utilisés et n'ont pas pu être supprimés.`,
  }),
  noPayload: {
    en: "This installer was built without Kiza Launcher inside it. Download the installer again.",
    fr: "Cet installateur a été construit sans Kiza Launcher dedans. Téléchargez-le à nouveau.",
  },
};

function say(entry, ...args) {
  const value = typeof entry === "function" ? entry(...args) : entry;
  return FRENCH ? value.fr : value.en;
}

/* ------------------------------------------------------------------ elements */

const element = (id) => document.getElementById(id);
const root = document.documentElement;
const ui = {
  title: element("title"),
  subtitle: element("subtitle"),
  options: element("options"),
  uninstallOptions: element("uninstall-options"),
  desktop: element("desktop-shortcut"),
  desktopLabel: element("desktop-label"),
  startMenu: element("start-menu-shortcut"),
  startMenuLabel: element("start-menu-label"),
  removeData: element("remove-data"),
  removeDataLabel: element("remove-data-label"),
  progress: element("progress"),
  bar: element("bar"),
  detail: element("progress-detail"),
  error: element("error"),
  primary: element("primary"),
  secondary: element("secondary"),
  path: element("path"),
  close: element("close"),
  minimize: element("minimize"),
  version: element("titlebar-version"),
};

let plan = null;
let busy = false;

/**
 * Marks the installer as working, and locks the close button while it is.
 *
 * The window has no frame, so this button is the only way out — which is
 * exactly why it has to refuse mid-copy. A launcher half written to disk is
 * worse than one not written at all.
 */
function setBusy(value) {
  busy = value;
  ui.close.disabled = value;
}

function show(node, visible) {
  node.hidden = !visible;
}

function fail(message) {
  setBusy(false);
  root.dataset.state = "error";
  ui.error.textContent = message;
  show(ui.error, true);
  show(ui.progress, false);
  ui.primary.disabled = false;
  ui.primary.textContent = say(TEXT.close);
  ui.primary.onclick = () => invoke("quit");
  show(ui.secondary, false);
}

/* ------------------------------------------------------------------- install */

async function startInstall() {
  if (busy) return;
  setBusy(true);
  root.dataset.state = "working";

  show(ui.options, false);
  show(ui.progress, true);
  show(ui.secondary, false);
  ui.primary.disabled = true;
  ui.primary.textContent = say(plan.is_update ? TEXT.updating : TEXT.installing);

  try {
    await invoke("run_install", {
      request: {
        install_dir: plan.install_dir,
        // An update leaves the shortcuts exactly as the user arranged them:
        // recreating one they deliberately deleted would be a small betrayal
        // repeated at every release.
        desktop_shortcut: plan.is_update ? false : ui.desktop.checked,
        start_menu_shortcut: plan.is_update ? false : ui.startMenu.checked,
      },
    });
    installed();
  } catch (error) {
    fail(String(error));
  }
}

function installed() {
  setBusy(false);
  root.dataset.state = "done";
  ui.bar.style.width = "100%";
  ui.detail.textContent = "";
  show(ui.progress, false);

  ui.title.textContent = say(TEXT.installedTitle);
  ui.subtitle.textContent = say(plan.is_update ? TEXT.updatedBody : TEXT.installedBody);

  // An unattended run closes itself: nobody is watching, and a window waiting
  // for a click would sit there for ever.
  if (plan.unattended) {
    invoke("finish", { start: plan.restart });
    return;
  }

  ui.primary.disabled = false;
  ui.primary.textContent = say(TEXT.play);
  ui.primary.onclick = () => invoke("finish", { start: true });
  ui.secondary.textContent = say(TEXT.close);
  ui.secondary.onclick = () => invoke("finish", { start: false });
  show(ui.secondary, true);
}

/* ----------------------------------------------------------------- uninstall */

async function startUninstall() {
  if (busy) return;
  setBusy(true);
  root.dataset.state = "working";

  show(ui.uninstallOptions, false);
  show(ui.progress, true);
  show(ui.secondary, false);
  ui.bar.style.width = "40%";
  ui.primary.disabled = true;
  ui.primary.textContent = say(TEXT.uninstalling);

  try {
    const summary = await invoke("run_uninstall", {
      request: { remove_user_data: ui.removeData.checked },
    });

    setBusy(false);
    root.dataset.state = "done";
    ui.bar.style.width = "100%";
    show(ui.progress, false);
    ui.title.textContent = say(TEXT.uninstalledTitle);
    ui.subtitle.textContent =
      summary.files_left_behind > 0
        ? `${say(TEXT.uninstalledBody)} ${say(TEXT.leftBehind, summary.files_left_behind)}`
        : say(TEXT.uninstalledBody);

    ui.primary.disabled = false;
    ui.primary.classList.remove("destructive");
    ui.primary.textContent = say(TEXT.close);
    ui.primary.onclick = () => invoke("quit");
  } catch (error) {
    fail(String(error));
  }
}

/* ---------------------------------------------------------------------- boot */

function draw() {
  ui.path.textContent = plan.install_dir;
  ui.version.textContent = `v${plan.version}`;

  if (plan.mode === "uninstall") {
    ui.title.textContent = say(TEXT.uninstallTitle);
    ui.subtitle.textContent = say(TEXT.uninstallBody);
    ui.removeDataLabel.textContent = say(TEXT.removeData);
    show(ui.uninstallOptions, true);

    ui.primary.textContent = say(TEXT.uninstall);
    ui.primary.classList.add("destructive");
    ui.primary.disabled = false;
    ui.primary.onclick = startUninstall;
    ui.secondary.textContent = say(TEXT.cancel);
    ui.secondary.onclick = () => invoke("quit");
    show(ui.secondary, true);
    return;
  }

  if (plan.payload_missing) {
    fail(say(TEXT.noPayload));
    return;
  }

  ui.title.textContent = plan.product;
  ui.subtitle.textContent = plan.is_update
    ? say(TEXT.readyToUpdate, plan.previous_version || "—", plan.version)
    : say(TEXT.readyToInstall);

  ui.desktopLabel.textContent = say(TEXT.desktopShortcut);
  ui.startMenuLabel.textContent = say(TEXT.startMenuShortcut);
  // An update touches no shortcuts, so offering the choice would be a lie.
  show(ui.options, !plan.is_update && !plan.unattended);

  ui.primary.textContent = say(plan.is_update ? TEXT.update : TEXT.install);
  ui.primary.disabled = false;
  ui.primary.onclick = startInstall;

  if (!plan.unattended) {
    ui.secondary.textContent = say(TEXT.cancel);
    ui.secondary.onclick = () => invoke("quit");
    show(ui.secondary, true);
  }

  if (plan.unattended) {
    startInstall();
  }
}

async function boot() {
  ui.minimize.onclick = () => getCurrentWindow().minimize();
  ui.close.onclick = () => {
    // Closing mid-install would leave half a launcher on the disk. The button
    // is disabled at the same time, so this is the second lock rather than the
    // only one.
    if (!busy) invoke("quit");
  };

  try {
    await listen("setup://progress", (event) => {
      const { fraction, detail } = event.payload;
      ui.bar.style.width = `${Math.round(fraction * 100)}%`;
      ui.detail.textContent = detail || "";
    });

    plan = await invoke("plan");
    root.dataset.state = "ready";
    draw();
  } catch (error) {
    fail(String(error));
  } finally {
    // In a `finally` on purpose. The window is created hidden so the first
    // frame is a drawn one; if anything above threw and this were skipped, the
    // installer would be a process with no window at all — indistinguishable,
    // to the user, from one that failed to start.
    await getCurrentWindow().show();
  }
}

boot();
