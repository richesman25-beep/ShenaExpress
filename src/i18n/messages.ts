export type Locale = "fr" | "ht" | "en";

export const LOCALE_NAMES: Record<Locale, string> = {
  fr: "Français",
  ht: "Kreyòl ayisyen",
  en: "English",
};

/** Dictionnaire français complet (langue par défaut) et structure prête pour créole haïtien et anglais. */
export const MESSAGES = {
  fr: {
    brand: {
      name: "SHENA Express",
      tagline: "Logistique internationale & suivi de colis vers Haïti",
      eyebrowClient: "VOTRE ESPACE CLIENT",
      eyebrowAdmin: "VOTRE ESPACE D'ADMINISTRATION",
    },
    nav: {
      skipToContent: "Aller au contenu principal",
      clientLogin: "Espace client",
      adminLogin: "Administration",
      signOut: "Déconnexion",
      overview: "Vue d'ensemble",
      clients: "Clients",
      orders: "Commandes",
      shipments: "Colis",
      finance: "Frais & paiements",
      settings: "Paramètres",
      audit: "Journal d'audit",
      myDashboard: "Tableau de bord",
      myOrders: "Mes commandes",
      myShipments: "Suivi des colis",
      notifications: "Notifications",
    },
    auth: {
      clientTitle: "Connexion client",
      clientSubtitle: "Consultez vos commandes, vos colis et leurs dates estimées à l'aide de votre identifiant personnel.",
      adminTitle: "Connexion administrateur",
      adminSubtitle: "L'accès est vérifié côté serveur. Une session seule ne donne aucun droit d'administration.",
      identifierLabel: "Identifiant client",
      identifierPlaceholder: "Ex. SHE-CLIENT-001",
      emailLabel: "Adresse e-mail professionnelle",
      emailPlaceholder: "admin@domaine.com",
      passwordLabel: "Mot de passe",
      showPassword: "Afficher le mot de passe",
      hidePassword: "Masquer le mot de passe",
      signIn: "Se connecter",
      signingIn: "Connexion en cours…",
      forgotPassword: "Mot de passe oublié ?",
      resetTitle: "Récupération de mot de passe",
      resetSubtitle: "Saisissez votre identifiant client ou votre adresse e-mail vérifiée.",
      sendReset: "Envoyer le lien de réinitialisation",
      resetSent: "Si un compte actif avec une adresse e-mail vérifiée correspond à cette saisie, un lien de réinitialisation vient d'être envoyé.",
      noEmailHelpTitle: "Vous n'avez pas accès à votre e-mail ?",
      noEmailHelpBody: "Contactez directement SHENA Express pour qu'un administrateur vérifie votre identité et vous transmette un lien d'accès sécurisé à usage unique.",
    },
    common: {
      loading: "Chargement des données…",
      save: "Enregistrer",
      saving: "Enregistrement…",
      cancel: "Annuler",
      confirm: "Confirmer",
      close: "Fermer",
      search: "Rechercher",
      allStatuses: "Tous les statuts",
      allTransports: "Tous les modes",
      estimateDisclaimer: "Date estimée à titre indicatif — ne constitue pas une garantie de livraison.",
      demoBanner: "Mode démonstration (émulateurs Firebase locaux) — les données affichées sont des exemples locaux et non des expéditions réelles.",
    },
  },
  ht: {
    brand: {
      name: "SHENA Express",
      tagline: "Lojistik entènasyonal ak swivi koli pou Ayiti",
      eyebrowClient: "ESPAS KLIYAN OU",
      eyebrowAdmin: "ESPAS ADMINISTRASYON",
    },
    nav: {
      skipToContent: "Ale nan kontni prensipal la",
      clientLogin: "Espas kliyan",
      adminLogin: "Administrasyon",
      signOut: "Dekonekte",
      overview: "Rezime",
      clients: "Kliyan",
      orders: "Kòmand",
      shipments: "Koli",
      finance: "Frè ak peman",
      settings: "Paramèt",
      audit: "Jounal aksyon",
      myDashboard: "Tablo bò",
      myOrders: "Kòmand mwen yo",
      myShipments: "Swivi koli",
      notifications: "Notifikasyon",
    },
  },
  en: {
    brand: {
      name: "SHENA Express",
      tagline: "International logistics & parcel tracking to Haiti",
      eyebrowClient: "CUSTOMER PORTAL",
      eyebrowAdmin: "ADMINISTRATION PORTAL",
    },
    nav: {
      skipToContent: "Skip to main content",
      clientLogin: "Customer portal",
      adminLogin: "Administration",
      signOut: "Sign out",
      overview: "Overview",
      clients: "Customers",
      orders: "Orders",
      shipments: "Shipments",
      finance: "Fees & payments",
      settings: "Settings",
      audit: "Audit log",
      myDashboard: "Dashboard",
      myOrders: "My orders",
      myShipments: "Parcel tracking",
      notifications: "Notifications",
    },
  },
};

export type Messages = typeof MESSAGES.fr;

export function getMessages(locale: Locale = "fr"): Messages {
  if (locale === "fr") return MESSAGES.fr;
  return {
    ...MESSAGES.fr,
    brand: { ...MESSAGES.fr.brand, ...MESSAGES[locale].brand },
    nav: { ...MESSAGES.fr.nav, ...MESSAGES[locale].nav },
  };
}
