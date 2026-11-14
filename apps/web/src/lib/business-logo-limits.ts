/**
 * Taille maximale du logo en data URL (caractères). Le corps JSON de toute requête est plafonné à 64 Kio
 * (`parseJsonRequest`) : un logo plus lourd faisait échouer la création du commerce (413) alors que le
 * navigateur l'acceptait (200 000 caractères). `downscaleLogo` réduit l'image jusqu'à passer sous ce seuil.
 */
export const LOGO_MAX_CHARS = 60_000;
