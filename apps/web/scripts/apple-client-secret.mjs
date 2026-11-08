/**
 * Secret client « Se connecter avec Apple » (mission 13) : JWT ES256 signé avec la clé privée .p8 de
 * l'équipe Apple Developer. Apple refuse une validité supérieure à 6 mois : à renouveler avant expiration.
 *
 *   $env:APPLE_TEAM_ID = "..."          # identifiant d'équipe (10 caractères)
 *   $env:APPLE_KEY_ID = "..."           # identifiant de la clé « Sign in with Apple »
 *   $env:APPLE_CLIENT_ID = "..."        # Services ID, par exemple com.exemple.qadrops.web
 *   $env:APPLE_PRIVATE_KEY_PATH = "C:\chemin\hors\depot\AuthKey_XXXX.p8"
 *   node scripts/apple-client-secret.mjs [jours, 180 au plus]
 *
 * Le jeton est écrit sur la sortie standard pour être collé directement dans la variable APPLE_CLIENT_SECRET
 * de l'hébergeur (jamais dans un fichier suivi par Git). La clé .p8 ne doit jamais entrer dans le dépôt.
 * Aucune dépendance : signature par `node:crypto` (ECDSA P-256, format IEEE P1363 exigé par JWS).
 */
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_DAYS = 180;

export function appleClientSecret({ teamId, keyId, clientId, privateKeyPem, days = MAX_DAYS, now = new Date() }) {
  if (!/^[A-Z0-9]{10}$/.test(teamId ?? "")) throw new Error("APPLE_TEAM_ID : 10 caractères (lettres majuscules et chiffres).");
  if (!/^[A-Z0-9]{10}$/.test(keyId ?? "")) throw new Error("APPLE_KEY_ID : 10 caractères (lettres majuscules et chiffres).");
  if (!clientId) throw new Error("APPLE_CLIENT_ID (Services ID) est requis.");
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new Error(`Validité : 1 à ${MAX_DAYS} jours.`);
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("La clé doit être la clé .p8 (ECDSA P-256) fournie par Apple.");
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = encode({ alg: "ES256", kid: keyId, typ: "JWT" });
  const payload = encode({ iss: teamId, iat: issuedAt, exp: issuedAt + days * 86_400, aud: "https://appleid.apple.com", sub: clientId });
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return { token: `${header}.${payload}.${signature}`, expiresAt: new Date((issuedAt + days * 86_400) * 1000) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const path = process.env.APPLE_PRIVATE_KEY_PATH;
    if (!path) throw new Error("APPLE_PRIVATE_KEY_PATH est requis (chemin de la clé .p8, hors du dépôt).");
    const { token, expiresAt } = appleClientSecret({
      teamId: process.env.APPLE_TEAM_ID, keyId: process.env.APPLE_KEY_ID, clientId: process.env.APPLE_CLIENT_ID,
      privateKeyPem: readFileSync(path, "utf8"), days: process.argv[2] ? Number(process.argv[2]) : MAX_DAYS,
    });
    process.stderr.write(`Secret client Apple valable jusqu'au ${expiresAt.toISOString().slice(0, 10)} : à renouveler avant cette date.\n`);
    process.stdout.write(`${token}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Erreur inconnue"}\n`);
    process.exitCode = 1;
  }
}
