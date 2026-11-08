/**
 * Politique de confidentialité de Qadr Ops (mission 13) : PROJET à valider par un juriste.
 *
 * - Seule la version française existe ; l'anglais et l'arabe suivront la validation juridique (la page
 *   l'indique dans la langue de l'interface). Structure par sections stables pour faciliter la traduction.
 * - Chaque affirmation décrit le fonctionnement réel du code ou la configuration vérifiée
 *   (docs/privacy/data-map.md). Les éléments non tranchés sont signalés « à compléter » plutôt qu'inventés.
 * - Toute évolution des prestataires ou des durées doit être reportée ici ET dans docs/privacy/.
 */
export type PolicySection = { id: string; title: string; paragraphs: readonly string[]; items?: readonly string[] };

export const PRIVACY_POLICY_UPDATED_AT = "2026-11-08";

export const privacyPolicyFr: readonly PolicySection[] = [
  {
    id: "editeur",
    title: "1. Qui sommes-nous ?",
    paragraphs: [
      "Qadr Ops est un logiciel de gestion commerciale édité par Qadr Agency. Coordonnées de l’éditeur et du référent pour la protection des données : [à compléter avant publication].",
      "Ce texte est rédigé en tenant compte de la loi ivoirienne n° 2013-450 du 19 juin 2013 relative à la protection des données à caractère personnel. Il est en cours de validation juridique.",
    ],
  },
  {
    id: "roles",
    title: "2. Vos données et celles de vos clients",
    paragraphs: [
      "Pour votre compte et votre abonnement, Qadr Agency décide de l’usage des données (responsable du traitement).",
      "Pour les informations que vous enregistrez sur vos clients, fournisseurs et ventes, Qadr Agency agit pour votre compte, selon vos instructions : ces données restent celles de votre commerce. Vous devez informer vos propres clients de l’usage que vous en faites.",
    ],
  },
  {
    id: "donnees",
    title: "3. Données que nous traitons",
    paragraphs: ["Nous ne collectons que ce qui est nécessaire au fonctionnement du service :"],
    items: [
      "Compte : nom, adresse e-mail, mot de passe (enregistré sous une forme chiffrée irréversible, jamais en clair), langue préférée.",
      "Connexion : date, adresse IP et navigateur de chaque session, pour la sécurité.",
      "Commerce : nom, activité, membres de l’équipe et leurs rôles.",
      "Activité commerciale saisie par vous : produits, stock, ventes, paiements, clients, dettes, fournisseurs, dépenses.",
      "Abonnement : factures, montants, référence du paiement auprès du prestataire de paiement.",
      "Notifications : préférences et adresse technique de l’appareil qui les reçoit.",
      "Fichiers que vous importez (catalogues, listes) et journaux techniques d’erreur.",
    ],
  },
  {
    id: "finalites",
    title: "4. Pourquoi ?",
    paragraphs: [],
    items: [
      "Fournir le service : caisse, stock, rapports, reçus, équipe.",
      "Sécuriser les comptes et séparer strictement les données de chaque commerce.",
      "Gérer votre abonnement et son paiement.",
      "Vous prévenir (vente, échéance, sécurité) selon vos préférences.",
      "Corriger les erreurs techniques.",
      "Mesurer l’usage du produit, uniquement si vous l’avez accepté.",
    ],
  },
  {
    id: "prestataires",
    title: "5. Prestataires techniques",
    paragraphs: [
      "Nous faisons appel à des prestataires qui n’utilisent vos données que pour nous rendre leur service :",
    ],
    items: [
      "Neon : base de données. Elle est actuellement hébergée aux États-Unis.",
      "Vercel : exécution de l’application.",
      "Cloudflare : protection du site contre les attaques et les robots, stockage privé de fichiers.",
      "Resend : envoi des e-mails de compte (vérification, mot de passe, invitations).",
      "GeniusPay : paiement des abonnements Qadr Ops.",
      "Sentry : suivi des erreurs techniques, hébergé dans l’Union européenne.",
      "PostHog : mesure d’audience, seulement après votre accord.",
      "Google ou Apple : seulement si vous choisissez de vous connecter avec eux.",
    ],
  },
  {
    id: "transferts",
    title: "6. Données hors de Côte d’Ivoire",
    paragraphs: [
      "Plusieurs prestataires sont situés hors de Côte d’Ivoire, notamment aux États-Unis et dans l’Union européenne. Nous ne promettons pas que vos données restent en Afrique.",
      "Les formalités applicables à ces transferts auprès de l’Autorité de protection des données sont en cours d’instruction.",
    ],
  },
  {
    id: "conservation",
    title: "7. Durée de conservation",
    paragraphs: [
      "Les sessions de connexion expirent au bout de 7 jours. Les données de votre commerce sont conservées tant que votre compte existe ; l’historique des ventes, paiements et stocks n’est jamais modifié après coup, pour garder une comptabilité fiable.",
      "Les durées de conservation après la fin d’un abonnement et des journaux techniques sont en cours de définition : [à compléter].",
    ],
  },
  {
    id: "securite",
    title: "8. Sécurité",
    paragraphs: [
      "Chaque commerce ne voit que ses propres données : ce contrôle est fait par le serveur à chaque requête. Les mots de passe sont chiffrés, les connexions passent en HTTPS, les opérations sensibles sont tracées, et les fichiers privés ne sont accessibles que par des liens temporaires.",
    ],
  },
  {
    id: "droits",
    title: "9. Vos droits",
    paragraphs: [
      "Vous pouvez demander l’accès à vos données, leur correction, leur suppression, ou vous opposer à certains usages. Le propriétaire d’un commerce peut télécharger à tout moment une copie complète des données de son commerce.",
      "Pour exercer vos droits : [adresse de contact à compléter]. Vous pouvez aussi saisir l’Autorité de protection des données de Côte d’Ivoire.",
      "La suppression de l’historique commercial obéit à des obligations de conservation : elle est étudiée au cas par cas.",
    ],
  },
  {
    id: "mesure",
    title: "10. Mesure d’audience et notifications",
    paragraphs: [
      "La mesure d’audience n’est activée qu’après votre accord, et vous pouvez le retirer. Elle ne transmet ni montant, ni nom de client.",
      "Les notifications sur votre téléphone ne montrent qu’un titre court et un texte général, jamais un montant ou un nom de client. Elles cessent dès que vous vous déconnectez ou que votre session expire, même sur un appareil partagé.",
    ],
  },
  {
    id: "modifications",
    title: "11. Modifications",
    paragraphs: ["Nous vous informerons de tout changement important de cette politique."],
  },
];
