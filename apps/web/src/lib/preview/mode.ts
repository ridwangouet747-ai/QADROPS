/**
 * Aperçu local actif : lancement explicite `npm run preview` (`QADR_PREVIEW_MODE=true`) en développement.
 * Module sans dépendance, lu par le client de base lui-même : il ne doit rien importer de la base.
 */
export function isLocalPreview(source: NodeJS.ProcessEnv = process.env): boolean {
  return source.QADR_PREVIEW_MODE === "true" && source.NODE_ENV === "development";
}
