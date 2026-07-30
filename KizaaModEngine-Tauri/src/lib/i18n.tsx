import { createContext, useCallback, useContext, useMemo, useState } from "react";

// Lightweight i18n: English source strings are the keys, so untranslated
// strings automatically fall back to English.

export type Language = "en" | "fr";

export const LANGUAGES: Array<{ id: Language; label: string }> = [
  { id: "en", label: "English" },
  { id: "fr", label: "Français" },
];

const STORAGE_KEY = "kiza.language";

const fr: Record<string, string> = {
  // Title bar
  "Settings": "Paramètres",

  // Library view
  "Minecraft only": "Minecraft uniquement",
  "Create isolated Vanilla, Fabric or Forge instances and add the mods you choose.":
    "Créez des instances Vanilla, Fabric ou Forge isolées et ajoutez les mods de votre choix.",
  "New instance": "Nouvelle instance",
  "Optimized launch": "Lancement optimisé",
  "VSync off, FPS options, managed Java.": "VSync désactivé, options FPS, Java géré.",
  "Create and install": "Créer et installer",
  "Cancel": "Annuler",

  // Settings dialog
  "System & APIs": "Système & APIs",
  "Manage Kiza Launcher, your accounts, and Minecraft.":
    "Gérez Kiza Launcher, vos comptes et Minecraft.",
  "System": "Système",
  "APIs": "APIs",
  "Minecraft": "Minecraft",
  "Customisation": "Personnalisation",
  "Language": "Langue",
  "Connection health": "État des connexions",
  "Loading...": "Chargement...",
  "services ready": "services prêts",
  "available": "disponible",
  "configured": "configuré",
  "connected": "connecté",
  "disabled": "indisponible",
  "offline ready": "mode hors ligne",

  // System tab
  "System integrations": "Intégrations système",
  "Manage Discord, launcher behavior, and updates.":
    "Gérez Discord, le comportement du launcher et les mises à jour.",
  "Discord Rich Presence": "Discord Rich Presence",
  "Show current Minecraft launcher activity to Discord.":
    "Affiche votre activité Minecraft sur Discord.",
  "Show the Minecraft version while in game": "Afficher la version de Minecraft en jeu",
  "Show the instance name while in game": "Afficher le nom de l'instance en jeu",
  "Privacy: server addresses are never shared; disable these to hide the version and instance name too.":
    "Confidentialité : les adresses de serveur ne sont jamais partagées ; désactivez ces options pour masquer aussi la version et le nom de l'instance.",
  "Close to tray while playing": "Réduire dans la barre système en jeu",
  "Hide the launcher when the game starts; it comes back when the game ends.":
    "Masque le launcher au démarrage du jeu ; il revient quand le jeu se termine.",
  "Open the Kiza Manager log window on launch": "Ouvrir la fenêtre de logs Kiza Manager au lancement",
  "Show the separate console window with live game activity and logs when a game starts.":
    "Affiche la fenêtre console séparée avec l'activité et les logs du jeu à son démarrage.",
  "Save system settings": "Enregistrer les paramètres système",

  // Customisation tab
  "Theme": "Thème",
  "Choose the launcher's look. The change applies immediately.":
    "Choisissez l'apparence du launcher. Le changement s'applique immédiatement.",
  "Active": "Actif",
  "Deep violet void with an electric violet primary. The signature Kiza look.":
    "Vide violet profond avec un violet électrique. Le look signature de Kiza.",
  "Saturated neons on a near-black night: electric cyan and magenta.":
    "Néons saturés sur fond quasi noir : cyan électrique et magenta.",
  "Carbon black, industrial grey, and a sharp radioactive green.":
    "Noir carbone, gris industriel et vert radioactif tranchant.",
  "Deep black lacquer with imperial red and warm antique gold.":
    "Laque noire profonde, rouge impérial et or ancien chaleureux.",

  // Language tab
  "Launcher language": "Langue du launcher",
  "Choose the language used across the launcher interface.":
    "Choisissez la langue utilisée dans l'interface du launcher.",
  "Choose a language": "Choisir une langue",

  // APIs tab
  "API connections": "Connexions API",
  "Content search is ready.": "La recherche de contenu est prête.",
  "CurseForge is unavailable in this build.": "CurseForge n'est pas disponible dans cette version.",
  "Check": "Vérifier",
  "Ready to use": "Prêt à l'emploi",
  "Validate": "Valider",
  "Remove": "Supprimer",
  "Reset": "Réinitialiser",
  "Save": "Enregistrer",
  "API key": "Clé API",
  "Minecraft accounts": "Comptes Minecraft",
  "Active account": "Compte actif",
  "Connect a Microsoft account to play online.":
    "Connectez un compte Microsoft pour jouer en ligne.",
  "Disconnect all": "Tout déconnecter",
  "Add account": "Ajouter un compte",
  "Use": "Utiliser",
  "Microsoft code": "Code Microsoft",
  "Browser login": "Connexion navigateur",
  "Finish Microsoft login in your browser. Kiza Launcher will detect the local callback automatically.":
    "Terminez la connexion Microsoft dans votre navigateur. Kiza Launcher détectera automatiquement le retour local.",
  "Open again": "Rouvrir",

  // Minecraft tab
  "Version catalog": "Catalogue de versions",
  "Choose whether preview builds appear when creating or editing an instance.":
    "Choisissez si les versions preview apparaissent lors de la création ou modification d'une instance.",
  "Release versions only": "Versions stables uniquement",
  "Hide snapshots, pre-releases and release candidates.":
    "Masque les snapshots, pré-versions et release candidates.",
  "Minecraft runtime": "Runtime Minecraft",
  "Kiza installs the exact Java version each instance needs automatically at launch. You can pre-install the common runtimes here so the first launch is faster.":
    "Kiza installe automatiquement la version de Java requise par chaque instance au lancement. Vous pouvez pré-installer ici les runtimes courants pour accélérer le premier lancement.",
  "Refresh": "Actualiser",
  "Pre-install runtimes": "Pré-installer des runtimes",
  "Java 8 (MC 1.7-1.16), Java 17 (1.17-1.20.4), Java 21 (1.20.5-1.21.x), Java 25 (recent snapshots and 26.x).":
    "Java 8 (MC 1.7-1.16), Java 17 (1.17-1.20.4), Java 21 (1.20.5-1.21.x), Java 25 (snapshots récents et 26.x).",
  "Optional Java override": "Java personnalisé (optionnel)",
  "Managed runtime is preferred; override only for testing":
    "Le runtime géré est recommandé ; à ne remplacer que pour des tests",
  "Leave empty to use the managed runtime or Java found on PATH.":
    "Laissez vide pour utiliser le runtime géré ou le Java du PATH.",
  "Minimum RAM (MB)": "RAM minimum (Mo)",
  "Maximum RAM (MB)": "RAM maximum (Mo)",
  "Auto": "Auto",
  "Auto (sized from system RAM)": "Auto (selon la RAM du système)",
  "Extra JVM arguments": "Arguments JVM supplémentaires",
  "Appended after the performance profile arguments. Leave empty for auto mode.":
    "Ajoutés après les arguments du profil de performance. Laissez vide pour le mode auto.",
  "Save Minecraft settings": "Enregistrer les paramètres Minecraft",
  "Java override, RAM and extra JVM arguments are now set per instance — open an instance and use Manage instance → Advanced launch.":
    "Le Java personnalisé, la RAM et les arguments JVM se règlent désormais par instance — ouvre une instance et va dans Gérer l'instance → Lancement avancé.",

  // Updater (title bar button, overlay, settings panel)
  "Update": "Mettre à jour",
  "Update and restart the launcher": "Mettre à jour et redémarrer le launcher",
  "Update available": "Mise à jour disponible",
  "Click Update next to the launcher name to install it.":
    "Cliquez sur Mettre à jour à côté du nom du launcher pour l'installer.",
  "Open updater": "Ouvrir les mises à jour",
  "Updating Kiza Launcher": "Mise à jour de Kiza Launcher",
  "Restarting to finish the installation...": "Redémarrage pour terminer l'installation...",
  "The launcher will restart automatically.": "Le launcher va redémarrer automatiquement.",
  "Downloading the update...": "Téléchargement de la mise à jour...",
  "Updater": "Mises à jour",
  "Not checked": "Non vérifié",
  "Checking": "Vérification",
  "Current": "À jour",
  "Available": "Disponible",
  "Downloading": "Téléchargement",
  "Ready": "Prêt",
  "Later": "Plus tard",
  "Installing": "Installation",
  "Error": "Erreur",
  "Checking the signed GitHub release metadata...":
    "Vérification des métadonnées signées de la release GitHub...",
  "No update is available. This version is current.":
    "Aucune mise à jour disponible. Cette version est à jour.",
  "Download it now; installation remains your choice.":
    "Téléchargez-la maintenant ; l'installation reste votre choix.",
  "Downloading version": "Téléchargement de la version",
  "Downloaded and ready. Nothing will be installed until you confirm.":
    "Téléchargée et prête. Rien ne sera installé sans votre confirmation.",
  "Installation postponed. The download stays ready while this launcher remains open.":
    "Installation reportée. Le téléchargement reste prêt tant que le launcher est ouvert.",
  "Starting the signed installer. The launcher will close and restart.":
    "Lancement de l'installeur signé. Le launcher va se fermer et redémarrer.",
  "The updater could not complete the requested action.":
    "Les mises à jour n'ont pas pu terminer l'action demandée.",
  "Check GitHub Releases for a signed launcher update.":
    "Vérifie les releases GitHub pour une mise à jour signée du launcher.",
  "Check updates": "Vérifier les mises à jour",
  "Download update": "Télécharger la mise à jour",
  "Install and restart": "Installer et redémarrer",
  "Retry": "Réessayer",
  "Size unavailable": "Taille inconnue",

  // Instance sidebar
  "Installed mods": "Mods installés",
  "Discover mods": "Découvrir des mods",
  "Installed content": "Contenu installé",
  "Search content": "Rechercher du contenu",
  "Most popular": "Les plus populaires",
  "Loading popular content...": "Chargement des contenus populaires...",
  "By": "Par",
  "Unknown author": "Auteur inconnu",
  "Shaders": "Shaders",
  "Profiles": "Profils",
  "Downloads": "Téléchargements",
  "Conflicts": "Conflits",
  "Instance health": "État de l'instance",
  "Maintenance": "Maintenance",

  // Instance cards and library
  "Version": "Version",
  "Custom profile": "Profil personnalisé",
  "Balanced profile": "Profil équilibré",
  "Managed Java, isolated folder, user-selected mods.":
    "Java géré, dossier isolé, mods choisis par l'utilisateur.",
  "Checked {time} ago": "Vérifié il y a {time}",
  "Verify instance": "Vérifier l'instance",
  "Failed to load instances": "Impossible de charger les instances",
  "Create a Minecraft instance": "Créer une instance Minecraft",
  "Create an isolated Minecraft instance with the modloader you choose.":
    "Créez une instance Minecraft isolée avec le modloader de votre choix.",
  "Instance name": "Nom de l'instance",
  "Java runtime": "Runtime Java",
  "The Minecraft catalog below only shows versions compatible with this Java choice.":
    "Le catalogue Minecraft ci-dessous n'affiche que les versions compatibles avec ce choix de Java.",
  "Minecraft version": "Version de Minecraft",
  "Stable releases only.": "Versions stables uniquement.",
  "Stable releases, snapshots and previews.": "Versions stables, snapshots et previews.",
  "Java is selected automatically.": "Java est sélectionné automatiquement.",
  "Modloader": "Modloader",
  "Original game": "Jeu original",
  "Lightweight mods": "Mods légers",
  "Forge ecosystem": "Écosystème Forge",
  "No compatible loader version is available for this Minecraft version.":
    "Aucune version de loader compatible n'est disponible pour cette version de Minecraft.",
  "Modloader choice": "Choix du modloader",
  "Vanilla, Fabric or Forge per instance.": "Vanilla, Fabric ou Forge par instance.",
  "Isolated instances": "Instances isolées",
  "The official launcher is never touched.": "Le launcher officiel n'est jamais touché.",
  "No Minecraft instance": "Aucune instance Minecraft",
  "Create your first isolated Minecraft instance and choose Vanilla, Fabric or Forge.":
    "Créez votre première instance Minecraft isolée et choisissez Vanilla, Fabric ou Forge.",

  // Instance health
  "Undeploy all mod files": "Retirer tous les fichiers de mods",
  "This removes every Kiza Launcher-managed file from the Minecraft directory. Mods and profiles stay in the library and can be deployed again.":
    "Supprime tous les fichiers gérés par Kiza Launcher du dossier Minecraft. Les mods et profils restent dans la bibliothèque et peuvent être redéployés.",
  "Undeploy": "Retirer",
  "Diagnostics and repair tools": "Diagnostics et outils de réparation",
  "Run diagnostics": "Lancer un diagnostic",
  "System operational": "Système opérationnel",
  "Issues detected": "Problèmes détectés",
  "All systems are functioning normally. Your modding environment is stable.":
    "Tout fonctionne normalement. Votre environnement de mods est stable.",
  "The instance reports an issue. Some features may be limited.":
    "L'instance signale un problème. Certaines fonctionnalités peuvent être limitées.",
  "Last checked": "Dernière vérification",
  "{time} ago": "il y a {time}",
  "Never": "Jamais",
  "Detected issues": "Problèmes détectés",
  "Repair actions": "Actions de réparation",
  "Re-scan game integrity": "Re-scanner l'intégrité du jeu",
  "Verify game files against signature": "Vérifier les fichiers du jeu contre leur signature",
  "Purge deployment": "Purger le déploiement",
  "Remove all mod links (Undeploy)": "Supprimer tous les liens de mods (retrait)",

  // Kiza Manager console window
  "Preparing": "Préparation",
  "Downloading Java": "Téléchargement de Java",
  "Verifying files": "Vérification des fichiers",
  "Repairing mods": "Réparation des mods",
  "Starting": "Démarrage",
  "In game": "En jeu",
  "Crashed": "Crash",
  "Stopped": "Arrêté",
  "Idle": "Inactif",
  "Back to launcher": "Retour au launcher",
  "Activity": "Activité",
  "Raw log": "Log brut",
  "Waiting for the game to report activity…": "En attente d'activité du jeu…",
  "No log output yet.": "Aucune sortie de log pour l'instant.",
  "events": "événements",
  "lines": "lignes",
  "Open folder": "Ouvrir le dossier",
  "Stop game": "Arrêter le jeu",

  // Account menu
  "Microsoft account": "Compte Microsoft",
  "Sign in with Microsoft": "Se connecter avec Microsoft",
  "Sign in": "Se connecter",
  "No Microsoft account connected yet.": "Aucun compte Microsoft connecté pour l'instant.",
  "Waiting for Microsoft sign-in...": "En attente de la connexion Microsoft...",
  "Add Microsoft account": "Ajouter un compte Microsoft",
  "Manage accounts": "Gérer les comptes",
  "Sign out": "Se déconnecter",

  // Discover tab
  "Discover is only available for Minecraft.": "La découverte n'est disponible que pour Minecraft.",
  "Search for a mod...": "Rechercher un mod...",
  "Search": "Rechercher",
  "Search for a mod": "Rechercher un mod",
  "Browse popular content or search by name.":
    "Parcourez les contenus populaires ou recherchez-les par nom.",
  "No Modrinth results": "Aucun résultat Modrinth",
  "Try a shorter name or check the Minecraft version.":
    "Essayez un nom plus court ou vérifiez la version de Minecraft.",
  "No CurseForge results": "Aucun résultat CurseForge",
  "Try another term or check the CurseForge API connection.":
    "Essayez un autre terme ou vérifiez la connexion à l'API CurseForge.",
  "This modloader only": "Ce modloader uniquement",
  "Only show mods built for this instance's modloader":
    "N'afficher que les mods conçus pour le modloader de cette instance",
  "Results are limited to Minecraft {version}.":
    "Les résultats sont limités à Minecraft {version}.",
  "Load more": "Charger plus",
  "Compatible": "Compatible",
  "Other loader": "Autre loader",
  "Other version": "Autre version",
  "This mod does not support your modloader.": "Ce mod ne supporte pas votre modloader.",
  "No build for your Minecraft version yet.": "Pas encore de build pour votre version de Minecraft.",
  "Discover content": "Découvrir du contenu",
  "Content categories": "Catégories de contenu",
  "Manage everything added to this Minecraft instance by category.":
    "Gérez par catégorie tout ce qui a été ajouté à cette instance Minecraft.",
  "Mods": "Mods",
  "Resource packs": "Resource packs",
  "Modpacks": "Modpacks",
  "Data packs": "Data packs",
  "Search {category}...": "Rechercher des {category}...",
  "Select an item": "Sélectionnez un élément",
  "The detail panel will show the cover, compatible versions and the install action.":
    "Le panneau de détail affichera l'image, les versions compatibles et l'action d'installation.",
  "The CurseForge card and its compatible files will be shown here.":
    "La fiche CurseForge et ses fichiers compatibles s'afficheront ici.",
  "Load files": "Charger les fichiers",
  "Open on CurseForge": "Ouvrir sur CurseForge",
  "Load the file list to see the builds compatible with this instance.":
    "Chargez la liste des fichiers pour voir les builds compatibles avec cette instance.",
  "No compatible file for this instance. Try another version or loader.":
    "Aucun fichier compatible pour cette instance. Essayez une autre version ou un autre loader.",
  "Review install": "Vérifier l'installation",
  "Review": "Vérifier",
  "Uninstall": "Désinstaller",
  "Install": "Installer",
  "Shader installation requires a compatible Fabric instance with Iris support.":
    "L'installation de shaders nécessite une instance Fabric compatible avec Iris.",
  "Install Modrinth shaders directly here. CurseForge shader installation is not available yet.":
    "Installez les shaders Modrinth directement ici. L'installation de shaders CurseForge n'est pas encore disponible.",
  "No resource packs managed yet": "Aucun pack de ressources géré",
  "Resource pack installation will appear here once it can be tracked and removed safely.":
    "L'installation des packs de ressources apparaîtra ici dès qu'ils pourront être suivis et supprimés de façon sûre.",
  "Modpacks create new instances": "Les modpacks créent de nouvelles instances",
  "A modpack cannot be installed inside an existing instance. Its installation flow will create a separate instance.":
    "Un modpack ne peut pas être installé dans une instance existante. Son installation créera une instance séparée.",
  "Data packs belong to a world": "Les packs de données appartiennent à un monde",
  "Select a Minecraft world before installing a data pack so existing saves are never modified by mistake.":
    "Sélectionnez un monde Minecraft avant d'installer un pack de données afin de ne jamais modifier une sauvegarde par erreur.",
  "Browse shaders here, then install them from the Shaders tab.":
    "Parcourez les shaders ici, puis installez-les depuis l'onglet Shaders.",
  "Installing this content type from here is coming soon. Browse and compatibility check work now.":
    "L'installation de ce type de contenu depuis ici arrive bientôt. La navigation et la vérification de compatibilité fonctionnent déjà.",
  "Installing this content type from here is coming soon.":
    "L'installation de ce type de contenu depuis ici arrive bientôt.",

  // Mods tab and instance header
  "No mods installed": "Aucun mod installé",
  "This instance is empty. Add your first mod to get started.":
    "Cette instance est vide. Ajoutez votre premier mod pour commencer.",
  "Install a mod": "Installer un mod",
  "No mods found": "Aucun mod trouvé",
  "No mods match your current filter or search query.":
    "Aucun mod ne correspond à votre filtre ou recherche.",
  "Verified": "Vérifié",
  "Play": "Jouer",
  "Sync mods": "Synchroniser les mods",
  "Open Kiza Manager console": "Ouvrir la console Kiza Manager",
  "Refresh mods": "Actualiser les mods",
  "Instance settings": "Paramètres de l'instance",

  // Minecraft install experience
  "Minecraft setup required": "Installation de Minecraft requise",
  "Preparing Minecraft": "Préparation de Minecraft",
  "Downloading Minecraft client": "Téléchargement du client Minecraft",
  "Downloading game libraries": "Téléchargement des librairies du jeu",
  "Loading the asset index": "Chargement de l'index des assets",
  "Downloading game assets": "Téléchargement des assets du jeu",
  "Installing Fabric": "Installation de Fabric",
  "Installing Forge": "Installation de Forge",
  "Installing Kiza base mod": "Installation du mod de base Kiza",
  "Verifying installation": "Vérification de l'installation",
  "Ready to play": "Prêt à jouer",
  "Installation cancelled": "Installation annulée",
  "Installation failed": "Échec de l'installation",
  "Step {a} of {b}": "Étape {a} sur {b}",
  "Retry / Repair": "Réessayer / Réparer",
  "Install Minecraft": "Installer Minecraft",
  "Overall progress": "Progression globale",
  "stages complete": "étapes terminées",
  "Planning stages": "Planification des étapes",
  "Current step": "Étape en cours",
  "Minecraft must be installed and verified before launch.":
    "Minecraft doit être installé et vérifié avant le lancement.",
  "Back to instances": "Retour aux instances",
  "Minecraft instance": "Instance Minecraft",
};

const dictionaries: Record<Language, Record<string, string>> = {
  en: {},
  fr,
};

export function getStoredLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "fr" ? "fr" : "en";
}

interface I18nContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (text: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: "en",
  setLang: () => {},
  t: (text) => text,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>(getStoredLanguage);

  const setLang = useCallback((next: Language) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLangState(next);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      t: (text: string) => dictionaries[lang][text] ?? text,
    }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
