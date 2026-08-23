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
  "Import instance": "Importer une instance",
  "Updates": "Mises à jour",
  "Server Hub": "Serveurs",
  "Servers": "Serveurs",
  "Saved servers, status and direct join": "Serveurs enregistrés, état et connexion directe",
  "Save the servers you play on, see who is online, and launch the instance each one needs.":
    "Enregistrez vos serveurs, voyez qui est connecté, et lancez l'instance dont chacun a besoin.",
  "Name": "Nom",
  "Address": "Adresse",
  "Add server": "Ajouter un serveur",
  "No server saved": "Aucun serveur enregistré",
  "Add a server above to see its status and join it in one click.":
    "Ajoutez un serveur ci-dessus pour voir son état et le rejoindre en un clic.",
  "Unreachable": "Injoignable",
  "No instance bound": "Aucune instance liée",
  "Instance to launch for this server": "Instance à lancer pour ce serveur",
  "Refresh status": "Actualiser l'état",
  "Launch the bound instance": "Lancer l'instance liée",
  "Bind an instance first": "Liez d'abord une instance",
  "Join": "Rejoindre",
  "Back": "Retour",
  "Safe mode": "Mode sans échec",
  "Launch without mods, then re-enable them by halves to find the one that crashes.":
    "Lancer sans mods, puis les réactiver par moitiés pour trouver celui qui plante.",
  "Find the broken mod": "Trouver le mod fautif",
  "This mod crashes the game": "Ce mod fait planter le jeu",
  "No mod was found to crash the game": "Aucun mod ne fait planter le jeu",
  "The game crashes without any mod": "Le jeu plante sans aucun mod",
  "Disabling mods will not help. Repair the instance or check the Java runtime.":
    "Désactiver des mods n'y changera rien. Réparez l'instance ou vérifiez le runtime Java.",
  "Found in {runs} launches.": "Trouvé en {runs} lancements.",
  "Finish and re-enable every mod": "Terminer et réactiver tous les mods",
  "Every mod is off. Launch the game to prove Minecraft itself works.":
    "Tous les mods sont désactivés. Lancez le jeu pour vérifier que Minecraft fonctionne.",
  "{count} of {total} mods are enabled. Launch the game and report what happened.":
    "{count} mods sur {total} sont activés. Lancez le jeu et indiquez ce qui s'est passé.",
  "launch {runs}": "lancement {runs}",
  "After launching:": "Après le lancement :",
  "It crashed": "Ça a planté",
  "It started fine": "Ça a démarré",
  "Stop": "Arrêter",
  "Check for updates": "Vérifier les mises à jour",
  "Identify content": "Identifier le contenu",
  "Show changelog": "Afficher le journal des modifications",
  "Identify files installed before Kiza tracked their origin":
    "Identifier les fichiers installés avant que Kiza n'enregistre leur origine",
  "Update selected": "Mettre à jour la sélection",
  "New version available": "Nouvelle version disponible",
  "Pinned": "Épinglé",
  "No compatible release": "Aucune version compatible",
  "Up to date": "À jour",
  "Only content installed from Modrinth or CurseForge can be tracked.":
    "Seul le contenu installé depuis Modrinth ou CurseForge peut être suivi.",
  "Nothing here was installed from a platform Kiza can track.":
    "Rien ici n'a été installé depuis une plateforme que Kiza peut suivre.",
  "Select all": "Tout sélectionner",
  "Clear selection": "Vider la sélection",
  "Pin to the current version": "Épingler à la version actuelle",
  "Unpin": "Désépingler",
  "to": "vers",
  "Analysing the crash...": "Analyse du crash...",
  "Kiza could not identify a known cause in the logs.":
    "Kiza n'a pas identifié de cause connue dans les journaux.",
  "Disable {mod} and launch again": "Désactiver {mod} puis relancer",
  "Switch this instance to Java {version}": "Basculer cette instance sur Java {version}",
  "Raise the instance's maximum memory": "Augmenter la mémoire maximale de l'instance",
  "Repair the instance files": "Réparer les fichiers de l'instance",
  "Launch without mods to confirm the game itself is fine":
    "Lancer sans mods pour vérifier que le jeu lui-même fonctionne",
  "Update your graphics driver": "Mettre à jour votre pilote graphique",
  "Offline profiles": "Profils hors ligne",
  "Saved names for playing without a Microsoft account. Pick one when launching an instance.":
    "Pseudos enregistrés pour jouer sans compte Microsoft. Choisissez-en un au lancement d'une instance.",
  "Add profile": "Ajouter un profil",
  "No offline profile yet.": "Aucun profil hors ligne pour l'instant.",
  "Username": "Pseudo",
  "Skin": "Skin",
  "Skin image": "Image de skin",
  "Import a 64x64 skin image": "Importer une image de skin 64x64",
  "Play offline": "Jouer hors ligne",
  "Offline username": "Pseudo hors ligne",
  "Choose which account to play with.": "Choisissez le compte avec lequel jouer.",
  "Use a local name instead. Online servers will refuse it.": "Utiliser un pseudo local. Les serveurs en ligne le refuseront.",
  "or import": "ou importer",
  "Instance archive": "Archive d'instance",
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
  "No build of this shader targets your Minecraft version.":
    "Aucune version de ce shader ne cible votre version de Minecraft.",
  "Shaders need a modloader: create a Fabric instance (Iris) or a Forge instance (OptiFine).":
    "Les shaders nécessitent un modloader : créez une instance Fabric (Iris) ou Forge (OptiFine).",
  "Starting Kiza Launcher": "Démarrage de Kiza Launcher",
  "Starting the launcher": "Démarrage du launcher",
  "Reading your configuration": "Lecture de votre configuration",
  "Loading your instances": "Chargement de vos instances",
  "Dismiss this message": "Masquer ce message",
  "Powered by OptiFine.net": "Propulsé par OptiFine.net",
  "OptiFine is not on Modrinth or CurseForge. Builds are downloaded straight from the official site.":
    "OptiFine n'est ni sur Modrinth ni sur CurseForge. Les versions sont téléchargées directement depuis le site officiel.",
  "Loading builds...": "Chargement des versions...",
  "Could not reach optifine.net. Download it manually and use Add Mod.":
    "Impossible de joindre optifine.net. Téléchargez-le manuellement puis utilisez « Ajouter un mod ».",
  "No OptiFine build for this Minecraft version.":
    "Aucune version d'OptiFine pour cette version de Minecraft.",
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
  "Resource packs": "Packs de ressources",
  "Modpacks": "Modpacks",
  "Data packs": "Packs de données",
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

  // World Vault
  "Worlds & backups": "Mondes et sauvegardes",
  "A backup keeps only what changed since the previous one, so keeping several costs little.":
    "Une sauvegarde ne conserve que ce qui a changé depuis la précédente : en garder plusieurs coûte peu.",
  "No world yet": "Aucun monde pour l'instant",
  "Worlds appear here once you have played this instance at least once.":
    "Les mondes apparaissent ici une fois que vous avez joué à cette instance au moins une fois.",
  "Close Minecraft to back up or restore a world.":
    "Fermez Minecraft pour sauvegarder ou restaurer un monde.",
  "Close Minecraft first": "Fermez d'abord Minecraft",
  "Back up": "Sauvegarder",
  "Manual backup": "Sauvegarde manuelle",
  "Save the world as it is right now": "Enregistrer le monde tel qu'il est maintenant",
  "Show the backups of this world": "Afficher les sauvegardes de ce monde",
  "Hardcore": "Hardcore",
  "Restore this backup": "Restaurer cette sauvegarde",
  "The world goes back to how it was at this backup. Everything built, mined or explored since then is lost.":
    "Le monde revient à l'état de cette sauvegarde. Tout ce qui a été construit, miné ou exploré depuis sera perdu.",
  "Restore the world": "Restaurer le monde",
  "Put the world back to this": "Ramener le monde à cet état",
  "Delete this backup": "Supprimer cette sauvegarde",
  "files": "fichiers",

  // Kiza lockfile
  "Kiza lockfile": "Fichier de verrouillage Kiza",
  "One small file that describes this instance exactly: loader, Java, and every mod with its version and hash.":
    "Un petit fichier qui décrit exactement cette instance : le loader, Java, et chaque mod avec sa version et son empreinte.",
  "Check what would be exported": "Voir ce qui serait exporté",
  "Export a lockfile": "Exporter un fichier de verrouillage",
  "Compare with a lockfile": "Comparer à un fichier de verrouillage",
  "Save the lockfile": "Enregistrer le fichier de verrouillage",
  "Open a lockfile": "Ouvrir un fichier de verrouillage",
  "files would be locked.": "fichiers seraient verrouillés.",
  "{count} of them came from nowhere Kiza knows, so nobody else could fetch them:":
    "{count} d'entre eux viennent d'une source que Kiza ne connaît pas : personne d'autre ne pourrait les récupérer.",
  "more": "de plus",
  "This instance already matches it.": "Cette instance y correspond déjà.",
  "{count} differences": "{count} différences",
  "Re-check": "Revérifier",
  "Rebuild from it": "Reconstruire à partir de lui",
  "Download what is missing or outdated": "Télécharger ce qui manque ou n'est plus à jour",
  "None of the differences can be downloaded": "Aucune des différences ne peut être téléchargée",
  "{count} files cannot be downloaded — the lockfile does not say where they came from. Rebuilding will not fully match it.":
    "{count} fichiers ne peuvent pas être téléchargés : le fichier de verrouillage ne dit pas d'où ils viennent. La reconstruction ne correspondra pas entièrement.",
  "Identical": "Identique",
  "Missing": "Manquant",
  "Different version": "Version différente",
  "Not in the lockfile": "Absent du fichier de verrouillage",

  // Performance Advisor
  "Performance": "Performances",
  "What the JVM was given, and what it did with it.":
    "Ce qui a été donné à la JVM, et ce qu'elle en a fait.",
  "Measure the next launch": "Mesurer le prochain lancement",
  "Cancel measurement": "Annuler la mesure",
  "Heap": "Mémoire allouée",
  "Machine": "Machine",
  "Last measured run": "Dernier lancement mesuré",
  "Reached the menu in": "Menu atteint en",
  "collections": "collectes",
  "longest freeze": "gel le plus long",
  "heap after": "mémoire occupée après",
  "mods": "mods",
  "Startup": "Démarrage",
  "Longest freeze": "Gel le plus long",
  "Time spent collecting": "Temps passé à collecter",
  "better": "mieux",
  "worse": "moins bien",
  "no change": "sans changement",
  "Nothing to change. This instance is set up sensibly.":
    "Rien à changer. Cette instance est bien configurée.",
  "Fix it": "Corriger",
  "Restore": "Restaurer",

  // Staying in the tray
  "Keep running when the window is closed": "Continuer en arrière-plan à la fermeture",
  "Closing the window hides Kiza in the notification area so downloads and your game keep going. Quit it from the tray icon.":
    "Fermer la fenêtre place Kiza dans la zone de notification pour que vos téléchargements et votre partie continuent. Quittez-le depuis l'icône de la barre des tâches.",

  // Server Hub
  "Add": "Ajouter",
  "Add a server to see who is online and join it in one click.":
    "Ajoutez un serveur pour voir qui est en ligne et le rejoindre en un clic.",
  "Checking…": "Vérification…",
  "Choose an instance first": "Choisissez d'abord une instance",
  "Choose the instance to play this server with":
    "Choisissez l'instance avec laquelle jouer sur ce serveur",
  "No server matches that search.": "Aucun serveur ne correspond à cette recherche.",
  "Play on": "Jouer sur",
  "Refresh every server": "Rafraîchir tous les serveurs",
  "Remove this server": "Retirer ce serveur",
  "Search your servers…": "Rechercher dans vos serveurs…",
  "Server settings": "Réglages du serveur",
  "online": "en ligne",
  "Import": "Importer",
  "Import the multiplayer list of an instance":
    "Importer la liste multijoueur d'une instance",
  "Pick an instance to copy its in-game multiplayer list. Servers you already have are left alone.":
    "Choisissez une instance pour copier sa liste multijoueur. Les serveurs que vous avez déjà sont laissés tels quels.",

  // Choosing a version
  "Choose a version": "Choisir une version",
  "No release of this project runs on this instance.":
    "Aucune version de ce projet ne fonctionne sur cette instance.",
  "installed": "installée",
  "{count} installed": "{count} installés",
  "Activity & logs": "Activité et logs",

  // Library
  "My library": "Ma bibliothèque",
  "Minecraft instances": "instances Minecraft",
  "Create": "Créer",
  "Search your instances": "Rechercher dans vos instances",
  "Search your instances…": "Rechercher dans vos instances…",
  "No instance matches that search.": "Aucune instance ne correspond à cette recherche.",
  "Change the order": "Changer l'ordre",
  "Sorted by last played": "Trié par dernière partie",
  "Sorted by name": "Trié par nom",
  "Instance ready": "Prête",
  "All instances": "Toutes les instances",
  "Content": "Contenu",

  "Kiza could not read its settings file.":
    "Kiza n'a pas pu lire son fichier de paramètres.",

  // General settings
  "Startup and window": "Démarrage et fenêtre",
  "Start Kiza when Windows starts": "Lancer Kiza au démarrage de Windows",
  "Close button action": "Action du bouton Fermer",
  "Closing the window can keep downloads and a running game alive.":
    "Fermer la fenêtre peut laisser vivre vos téléchargements et votre partie.",
  "Minimise to the notification area": "Réduire dans la zone de notification",
  "Quit Kiza": "Quitter Kiza",
  "Hide Kiza while playing": "Masquer Kiza pendant le jeu",
  "Game launch": "Lancement du jeu",
  "Quit the launcher after the game starts": "Fermer le lanceur après le démarrage",
  "Check the files before playing": "Vérifier les fichiers avant de jouer",
  "Catches a half-finished install before it turns into a crash.":
    "Repère une installation incomplète avant qu'elle ne devienne un crash.",
  "After a crash": "Après un crash",
  "Open the report and offer a repair": "Ouvrir le rapport et proposer une réparation",
  "Offer to hunt the broken mod": "Proposer de chercher le mod fautif",
  "Say nothing": "Ne rien dire",
  "Show the instance name": "Afficher le nom de l'instance",
  "Show the Minecraft version": "Afficher la version de Minecraft",
  "Server addresses are never shared.": "Les adresses des serveurs ne sont jamais partagées.",
  "Download updates automatically": "Télécharger automatiquement les mises à jour",
  "Installing stays your decision; only the download is automatic.":
    "L'installation reste votre décision ; seul le téléchargement est automatique.",
  "Check for an update now": "Rechercher une mise à jour",
  "Check now": "Rechercher",

  // Appearance settings
  "Colour scheme": "Thème clair ou sombre",
  "Dark": "Sombre",
  "Light": "Clair",
  "Interface": "Interface",
  "Density": "Densité",
  "Compact": "Compacte",
  "Comfortable": "Confortable",
  "Spacious": "Spacieuse",
  "Text size": "Taille du texte",
  "Corner radius": "Rayon des éléments",
  "Show instance artwork": "Afficher les illustrations d'instances",
  "Hidden, not deleted: the card falls back to its gradient.":
    "Masquée, pas supprimée : la carte retombe sur son dégradé.",
  "Visual effects": "Effets visuels",
  "Reduce effects on modest machines": "Réduire les effets sur les PC modestes",
  "Turns the three below off without forgetting how you had them.":
    "Désactive les trois ci-dessous sans oublier vos réglages.",
  "Interface animations": "Animations de l'interface",
  "Panel translucency": "Transparence des panneaux",
  "Background blur": "Flou d'arrière-plan",
  "Every change here applies at once and is kept for next time.":
    "Chaque changement s'applique immédiatement et est conservé.",
  "Find more to install": "Trouver de quoi installer",
  "Instance": "Instance",
  "Discover": "Découvrir",

  // Mods tab
  // Discover
  "Discover {category}": "Découvrir des {category}",
  "Compatible with": "Compatibles avec",
  "See what is installed": "Voir ce qui est installé",
  "Clear the search": "Effacer la recherche",
  "Only show compatible versions": "Afficher uniquement les versions compatibles",
  "Relevance": "Pertinence",
  "All catalogues": "Toutes",
  "Recently updated": "Récemment mis à jour",
  "Active filters": "Filtres actifs",
  "Exact Minecraft version": "Version exacte de Minecraft",
  "Mod loader": "Chargeur de mods",
  "Remove Minecraft version filter": "Retirer le filtre de version Minecraft",
  "Remove mod loader filter": "Retirer le filtre de chargeur de mods",
  "No results": "Aucun résultat",
  "Try another term or relax the active filters.":
    "Essayez un autre terme ou assouplissez les filtres actifs.",
  "Results": "Résultats",
  "Loading more...": "Chargement de la suite...",
  "Connected sources: Modrinth and CurseForge":
    "Sources connectées : Modrinth et CurseForge",
  "Its details and installable versions appear here.":
    "Ses détails et les versions installables apparaissent ici.",

  // Content detail panel
  "Compatible with this instance": "Compatible avec cette instance",
  "Not built for this instance": "Pas prévu pour cette instance",
  "downloads": "téléchargements",
  "Updated": "Mis à jour",
  "Licence": "Licence",
  "Not specified": "Non renseigné",
  "Add to favorites": "Ajouter aux favoris",
  "Remove from favorites": "Retirer des favoris",
  "Description": "Description",
  "Versions": "Versions",
  "Dependencies": "Dépendances",
  "Version to install": "Version à installer",
  "Recommended": "Recommandée",
  "Load the available versions": "Charger les versions disponibles",
  "Install into {instance}": "Installer dans {instance}",
  "Download only": "Télécharger uniquement",
  "Save the file": "Enregistrer le fichier",
  "Already installed in this instance.": "Déjà installé dans cette instance.",
  "This project has no description.": "Ce projet n'a pas de description.",
  "Required dependencies are resolved and shown to you before anything is installed.":
    "Les dépendances requises sont résolues et vous sont présentées avant toute installation.",
  "Kiza cannot install a mod without its required dependencies.":
    "Kiza ne peut pas installer un mod sans ses dépendances requises.",
  "Required dependencies are included automatically":
    "Dépendances requises incluses automatiquement",
  "Checked and installed with this mod": "Vérifiées et installées avec ce mod",
  "Required dependencies will be added with this mod.":
    "Les dépendances requises seront ajoutées avec ce mod.",
  "Kiza reads the dependency list from the platform when you install, shows you what it found, and asks before adding anything.":
    "Kiza lit la liste des dépendances sur la plateforme au moment de l'installation, vous montre ce qu'il a trouvé, et demande avant d'ajouter quoi que ce soit.",

  "Add a mod": "Ajouter un mod",
  "Install from a file": "Installer depuis un fichier",
  "Search a mod…": "Rechercher un mod…",
  "Select a mod archive": "Choisir une archive de mod",
  "All": "Tous",
  "Active mods": "Actifs",
  "Disabled": "Désactivés",
  "All sources": "Toutes les sources",
  "Filter by source": "Filtrer par source",
  "Sort the list": "Trier la liste",
  "Name A–Z": "Nom A–Z",
  "Active first": "Actifs d'abord",
  "Load order": "Ordre de chargement",
  "update": "mise à jour",
  "updates": "mises à jour",
  "active": "actifs",
  "selected": "sélectionnés",
  "Enable": "Activer",
  "Disable": "Désactiver",
  "Delete": "Supprimer",
  "More actions": "Plus d'actions",
  "No description": "Aucune description",
  "Failed to load mods": "Impossible de charger les mods",
  "Stop Minecraft before deleting mods":
    "Fermez Minecraft avant de supprimer des mods",
  "None of the selected mods has an update":
    "Aucun des mods sélectionnés n'a de mise à jour",
  "Review these updates in the Update Center":
    "Examiner ces mises à jour dans le centre de mises à jour",
  "Is a mod crashing the game?": "Un mod provoque un crash ?",
  "Run the hunt to find which one, by halves rather than one at a time.":
    "Lancez le diagnostic pour identifier le responsable, par moitiés plutôt qu'un par un.",
  "Run the diagnosis": "Lancer le diagnostic",
  "All {count} mods are compatible with Minecraft {version}.":
    "Les {count} mods sont compatibles avec Minecraft {version}.",
  "Content synced": "Contenu synchronisé",
  "Sync required": "Synchronisation requise",
  "just now": "à l'instant",
  "{count} min ago": "il y a {count} min",
  "Needs attention": "À vérifier",
  "mod": "mod",
  "Choose a picture for this instance": "Choisir une image pour cette instance",
  "Back to the game version's own artwork":
    "Revenir à l’image de la version du jeu",
  "Image": "Image",
  "Manage this instance": "Gérer cette instance",
  "Double-click to manage this instance": "Double-cliquer pour gérer cette instance",
  "Open the instance folder": "Ouvrir le dossier de l'instance",
  "Check this instance": "Vérifier cette instance",
  "Export this instance": "Exporter cette instance",
  "Isolated folder": "Dossier isolé",
  "Never played": "Jamais jouée",
  "Last played": "Dernière partie",
  "Last played: just now": "Dernière partie : à l'instant",
  "{count} h ago": "il y a {count} h",
  "{count} d ago": "il y a {count} j",
  "automatic": "automatique",

  // Safe mode
  "Judged automatically after each launch — correct it here if needed:":
    "Jugé automatiquement après chaque lancement — corrigez ici si besoin :",

  // Settings: the eleven pages

  // Settings navigation
  "General": "Général",
  "Appearance": "Apparence",
  "Language and region": "Langue et région",
  "Minecraft and Java": "Minecraft et Java",
  "Storage": "Stockage",
  "Accounts": "Comptes",
  "Connections": "Connexions",
  "Notifications": "Notifications",
  "Advanced": "Avancé",
  "About": "À propos",

  // Storage
  "What Kiza is using": "Ce que Kiza occupe",
  "Measured now, by walking the folders. Nothing here is an estimate.": "Mesuré maintenant, en parcourant les dossiers. Rien ici n'est une estimation.",
  "Kiza could not measure its folders.": "Kiza n'a pas pu mesurer ses dossiers.",
  "Kept": "Conservé",
  "Total": "Total",
  "Nothing selected": "Rien de sélectionné",
  "Free": "Libérer",
  "freed": "libérés",
  "Some files were in use and stayed where they are.": "Certains fichiers étaient utilisés et sont restés en place.",
  "Measure again": "Mesurer à nouveau",
  "Instances, worlds and backups are never offered: they cannot be downloaded again.": "Les instances, les mondes et les sauvegardes ne sont jamais proposés : ils ne se retéléchargent pas.",
  "Open a folder": "Ouvrir un dossier",
  "Kiza folder": "Dossier Kiza",
  "Game versions": "Versions du jeu",
  "Libraries": "Bibliothèques",
  "Game assets": "Ressources du jeu",
  "Java runtimes": "Environnements Java",
  "World backups": "Sauvegardes de mondes",
  "Restore points": "Points de restauration",
  "Cache": "Cache",
  "Logs": "Journaux",
  "Your worlds, mods and configuration files.": "Vos mondes, vos mods et vos fichiers de configuration.",
  "The Minecraft builds you have played.": "Les versions de Minecraft auxquelles vous avez joué.",
  "What Minecraft needs to start.": "Ce dont Minecraft a besoin pour démarrer.",
  "Sounds, languages and textures.": "Sons, langues et textures.",
  "The Java versions Kiza installed for you.": "Les versions de Java que Kiza a installées pour vous.",
  "Snapshots taken by the World Vault.": "Instantanés pris par le World Vault.",
  "Taken before a risky change so it can be undone.": "Pris avant une modification risquée, pour pouvoir l'annuler.",
  "Fetched again the next time it is needed.": "Retéléchargé à la prochaine utilisation.",
  "Files already installed into instances.": "Fichiers déjà installés dans les instances.",
  "Kept for the crash report.": "Conservés pour le rapport de plantage.",
  "Clear": "Vider",

  // Notifications
  "When Kiza may interrupt you": "Quand Kiza peut vous interrompre",
  "Kiza is still running in the background": "Kiza continue en arrière-plan",
  "Shown once, the first time closing the window hides Kiza instead of quitting it.": "Affiché une fois, la première fois que fermer la fenêtre masque Kiza au lieu de le quitter.",
  "An update is ready to install": "Une mise à jour est prête à installer",
  "Once the download has finished. Installing stays your decision.": "Une fois le téléchargement terminé. L'installation reste votre décision.",
  "The download queue has emptied": "La file de téléchargement s'est vidée",
  "Off by default: a queue of forty files would mean a notice the moment you look away.": "Désactivé par défaut : une file de quarante fichiers signifierait une notification dès que vous regardez ailleurs.",
  "Is Windows letting them through?": "Windows les laisse-t-il passer ?",
  "Focus Assist, a per-app block or a company policy can swallow every notification while these switches still read on. Nothing but a visible result settles it.": "L'Assistant de concentration, un blocage par application ou une stratégie d'entreprise peuvent avaler toutes les notifications alors que ces interrupteurs affichent encore « activé ». Seul un résultat visible tranche.",
  "Send one now": "En envoyer une maintenant",
  "Test": "Tester",
  "Sent. If nothing appeared, Windows is blocking them.": "Envoyée. Si rien n'est apparu, Windows les bloque.",
  "Not covered by these switches": "Non concerné par ces interrupteurs",
  "Messages inside the launcher window, and the badge on the Update button, are always shown. They interrupt nothing outside Kiza.": "Les messages dans la fenêtre du launcher, et la pastille du bouton Mettre à jour, sont toujours affichés. Ils n'interrompent rien en dehors de Kiza.",
  "A crash always opens its report, whatever is set here — see After a crash, under General.": "Un plantage ouvre toujours son rapport, quels que soient ces réglages — voir « Après un plantage », dans Général.",

  // Downloads
  "Speed": "Vitesse",
  "Files downloaded at the same time": "Fichiers téléchargés en même temps",
  "More is not always faster: past a point the same connection is only cut into more, slower streams.": "Plus n'est pas toujours plus rapide : passé un certain point, la même connexion est seulement découpée en flux plus nombreux et plus lents.",
  "Recommended: 3": "Recommandé : 3",
  "Lowering it applies as the downloads already running finish. Raising it takes effect at once.": "Baisser s'applique au fur et à mesure que les téléchargements en cours se terminent. Augmenter prend effet immédiatement.",
  "What Kiza does not do": "Ce que Kiza ne fait pas",
  "Worth stating, because most launchers offer both and Kiza deliberately does not.": "Cela mérite d'être dit : la plupart des launchers proposent les deux, et Kiza s'en abstient volontairement.",
  "No bandwidth limit": "Pas de limite de débit",
  "A cap would be enforced per file, so three downloads at once would exceed it threefold. A number that lies is worse than no number.": "Une limite s'appliquerait par fichier : trois téléchargements simultanés la dépasseraient donc au triple. Un chiffre qui ment est pire que pas de chiffre.",
  "Every file is checked, always": "Chaque fichier est vérifié, toujours",
  "Hashes are verified on arrival and it cannot be switched off. A mod that arrived corrupted is a crash three days later that nobody connects to this page.": "Les empreintes sont vérifiées à l'arrivée et cela ne se désactive pas. Un mod arrivé corrompu, c'est un plantage trois jours plus tard que personne ne relie à cette page.",
  "Where they land": "Où ils atterrissent",
  "Downloads folder": "Dossier des téléchargements",
  "A staging area. Files are copied into the instance and can be cleared from Storage.": "Une zone de transit. Les fichiers sont copiés dans l'instance et peuvent être vidés depuis Stockage.",

  // Language and region
  "Minecraft keeps its own language setting, inside the game.": "Minecraft garde son propre réglage de langue, dans le jeu.",
  "Dates and times": "Dates et heures",
  "Date": "Date",
  "Clock": "Heure",
  "Follow Windows": "Suivre Windows",
  "Day / month / year": "Jour / mois / année",
  "Month / day / year": "Mois / jour / année",
  "Year-month-day": "Année-mois-jour",
  "24-hour": "24 heures",
  "12-hour": "12 heures",
  "Example": "Exemple",
  "Following Windows is the right answer for most people: the question was already answered once, in the region settings.": "Suivre Windows est la bonne réponse pour la plupart des gens : la question a déjà été tranchée une fois, dans les paramètres régionaux.",

  // Advanced
  "Reporting a problem": "Signaler un problème",
  "What someone helping you will ask for first.": "Ce qu'on vous demandera en premier pour vous aider.",
  "Copy the details of this machine": "Copier les détails de cette machine",
  "Version, screen, language and WebView build. No account and no file paths.": "Version, écran, langue et version de WebView. Aucun compte, aucun chemin de fichier.",
  "Copy": "Copier",
  "Copied. Paste it wherever you are describing the problem.": "Copié. Collez-le là où vous décrivez le problème.",
  "Open the logs": "Ouvrir les journaux",
  "The launcher's own log files, and the last game session's.": "Les journaux du launcher, et ceux de la dernière session de jeu.",
  "Open the Kiza folder": "Ouvrir le dossier Kiza",
  "Everything Kiza has written: settings, instances, backups.": "Tout ce que Kiza a écrit : réglages, instances, sauvegardes.",
  "Start over": "Repartir de zéro",
  "Reset every launcher setting": "Réinitialiser tous les réglages du launcher",
  "Only the settings on these pages. Your instances, worlds and accounts are not touched.": "Uniquement les réglages de ces pages. Vos instances, vos mondes et vos comptes ne sont pas touchés.",
  "Yes, reset them": "Oui, réinitialiser",
  "Settings are back to their defaults.": "Les réglages sont revenus à leurs valeurs par défaut.",

  // About
  "A Minecraft launcher with isolated instances, managed mods, and a Kiza client drawn inside the game.": "Un launcher Minecraft avec des instances isolées, des mods gérés, et un client Kiza dessiné dans le jeu.",
  "An update is available.": "Une mise à jour est disponible.",
  "Downloading the update…": "Téléchargement de la mise à jour…",
  "An update is ready to install.": "Une mise à jour est prête à installer.",
  "Installing…": "Installation…",
  "Kiza is up to date.": "Kiza est à jour.",
  "How updates arrive": "Comment arrivent les mises à jour",
  "Kiza checks at launch and every five minutes. Each update is signed, and one that fails its signature is refused.": "Kiza vérifie au lancement et toutes les cinq minutes. Chaque mise à jour est signée, et une signature invalide est refusée.",
  "Project": "Projet",
  "Source code and releases": "Code source et versions",
  "Report a problem": "Signaler un problème",
  "Built with": "Construit avec",
  "The launcher itself.": "Le launcher lui-même.",
  "Where mods come from. Kiza is not affiliated with either.": "D'où viennent les mods. Kiza n'est affilié ni à l'un ni à l'autre.",
  "Minecraft and the accounts that sign in to it. Kiza is not affiliated with either.": "Minecraft et les comptes qui s'y connectent. Kiza n'est affilié ni à l'un ni à l'autre.",

  // Connections
  "Each check is a real request. Nothing here is reported as working until it has answered.": "Chaque vérification est une vraie requête. Rien n'est annoncé comme fonctionnel avant d'avoir répondu.",
  "Microsoft sign-in lives under Accounts, because it is about who you play as rather than about a service being reachable.": "La connexion Microsoft se trouve dans Comptes : c'est une question d'identité de joueur, pas de service joignable.",

  "Open": "Ouvrir",
  "Java 21 runtime ready": "Environnement Java 21 prêt",
  "Java 21 runtime not installed": "Environnement Java 21 non installé",
  "Checking Java runtime...": "Vérification de l'environnement Java…",

  "Which releases to follow": "Quelles versions suivre",
  "Beta arrives earlier and breaks more often. Switching takes effect at the next check, not at the next launch.":
    "La bêta arrive plus tôt et casse plus souvent. Le changement prend effet à la prochaine vérification, pas au prochain lancement.",
  "Stable — tested releases": "Stable — versions testées",
  "Beta — early, rougher": "Bêta — en avance, plus rugueuse",
};

const dictionaries: Record<Language, Record<string, string>> = {
  en: {},
  fr,
};

export function getStoredLanguage(): Language {
  // localStorage can be unavailable on the very first launch, while WebView2
  // is still creating its data folder. Fall back rather than throw.
  try {
    return localStorage.getItem(STORAGE_KEY) === "fr" ? "fr" : "en";
  } catch {
    return "en";
  }
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
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still applies for this session.
    }
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
