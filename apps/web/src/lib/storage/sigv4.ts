import { createHash, createHmac } from "node:crypto";

/*
 * Signature AWS Signature Version 4 écrite avec `node:crypto`, sans SDK (mission 12, lot L2).
 * Utilisée par l'adaptateur R2 (API compatible S3). Vérifiée contre les vecteurs officiels AWS
 * (`sigv4.test.ts`). Aucun secret n'est journalisé ni renvoyé dans un message d'erreur.
 *
 * Particularité S3 (et R2) : le chemin canonique est encodé UNE seule fois et n'est pas normalisé
 * (`.`/`..` conservés). Le chemin passé ici est donc le chemin décodé, encodé segment par segment.
 */

export type SigV4Credentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };

/** Empreinte SHA-256 d'un corps vide. */
export const EMPTY_PAYLOAD_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
/** Valeur prévue par S3 pour une URL présignée : le corps n'est pas couvert par la signature. */
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
const ALGORITHM = "AWS4-HMAC-SHA256";

export const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

/** Date au format `AAAAMMJJTHHMMSSZ` (UTC). */
export function amzDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Encodage RFC 3986 : seuls `A-Z a-z 0-9 - . _ ~` restent tels quels ; `/` est conservé si demandé. */
export function uriEncode(value: string, keepSlash = false) {
  const encoded = encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? encoded.replace(/%2F/g, "/") : encoded;
}

export type SigV4Request = {
  method: string;
  host: string;
  /** Chemin décodé, commençant par `/` (par exemple `/bucket/import_source/ab12…`). */
  path: string;
  query?: [string, string][];
  headers?: Record<string, string>;
};

export const canonicalUri = (path: string) => uriEncode(path.startsWith("/") ? path : `/${path}`, true);

export function canonicalQuery(query: [string, string][] = []) {
  return query.map(([key, value]) => [uriEncode(key), uriEncode(value)] as const)
    .sort(([keyA, valueA], [keyB, valueB]) => (keyA < keyB ? -1 : keyA > keyB ? 1 : valueA < valueB ? -1 : valueA > valueB ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`).join("&");
}

/** En-têtes canoniques : noms en minuscules, valeurs sans espaces aux bords ni espaces répétés. */
function canonicalHeaders(headers: Record<string, string>) {
  const entries = Object.entries(headers).map(([name, value]) => [name.trim().toLowerCase(), value.trim().replace(/\s+/g, " ")] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { text: entries.map(([name, value]) => `${name}:${value}\n`).join(""), signed: entries.map(([name]) => name).join(";") };
}

export function canonicalRequest(request: SigV4Request, payloadHash: string) {
  const headers = canonicalHeaders({ ...request.headers, host: request.host });
  const text = [request.method.toUpperCase(), canonicalUri(request.path), canonicalQuery(request.query), headers.text, headers.signed, payloadHash].join("\n");
  return { text, signedHeaders: headers.signed };
}

export function credentialScope(date: Date, region: string, service: string) {
  return `${amzDate(date).slice(0, 8)}/${region}/${service}/aws4_request`;
}

export function stringToSign(date: Date, scope: string, canonical: string) {
  return [ALGORITHM, amzDate(date), scope, sha256Hex(canonical)].join("\n");
}

export function signingKey(secretAccessKey: string, dateStamp: string, region: string, service: string) {
  return hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service), "aws4_request");
}

type SignOptions = { credentials: SigV4Credentials; region: string; service: string; date: Date };

/**
 * Signe une requête par en-tête `Authorization`. Renvoie les en-têtes à envoyer (sans `host`, que `fetch`
 * calcule lui-même à partir de l'URL). `contentSha256Header` ajoute `x-amz-content-sha256`, exigé par S3/R2.
 */
export function signHeaders(request: SigV4Request, payloadHash: string, options: SignOptions & { contentSha256Header?: boolean }) {
  const headers: Record<string, string> = { ...request.headers, "x-amz-date": amzDate(options.date) };
  if (options.contentSha256Header ?? true) headers["x-amz-content-sha256"] = payloadHash;
  if (options.credentials.sessionToken) headers["x-amz-security-token"] = options.credentials.sessionToken;
  const canonical = canonicalRequest({ ...request, headers }, payloadHash);
  const scope = credentialScope(options.date, options.region, options.service);
  const signature = createHmac("sha256", signingKey(options.credentials.secretAccessKey, amzDate(options.date).slice(0, 8), options.region, options.service))
    .update(stringToSign(options.date, scope, canonical.text), "utf8").digest("hex");
  return {
    ...headers,
    authorization: `${ALGORITHM} Credential=${options.credentials.accessKeyId}/${scope}, SignedHeaders=${canonical.signedHeaders}, Signature=${signature}`,
  };
}

/**
 * URL présignée (authentification par paramètres de requête). La durée est bornée par l'appelant ;
 * S3/R2 refusent au-delà de 604 800 s (7 jours).
 */
export function presignUrl(request: SigV4Request, options: SignOptions & { expiresSeconds: number; payloadHash?: string }) {
  if (!Number.isInteger(options.expiresSeconds) || options.expiresSeconds < 1 || options.expiresSeconds > 604_800) {
    throw new RangeError("Durée de validité d'URL présignée invalide (1 à 604 800 secondes).");
  }
  const scope = credentialScope(options.date, options.region, options.service);
  const signedHeaderNames = Object.keys({ ...request.headers, host: request.host }).map((name) => name.toLowerCase()).sort().join(";");
  const query: [string, string][] = [
    ...(request.query ?? []),
    ["X-Amz-Algorithm", ALGORITHM],
    ["X-Amz-Credential", `${options.credentials.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate(options.date)],
    ["X-Amz-Expires", String(options.expiresSeconds)],
    ...(options.credentials.sessionToken ? [["X-Amz-Security-Token", options.credentials.sessionToken] as [string, string]] : []),
    ["X-Amz-SignedHeaders", signedHeaderNames],
  ];
  const canonical = canonicalRequest({ ...request, query }, options.payloadHash ?? UNSIGNED_PAYLOAD);
  const signature = createHmac("sha256", signingKey(options.credentials.secretAccessKey, amzDate(options.date).slice(0, 8), options.region, options.service))
    .update(stringToSign(options.date, scope, canonical.text), "utf8").digest("hex");
  return `https://${request.host}${canonicalUri(request.path)}?${canonicalQuery(query)}&X-Amz-Signature=${signature}`;
}
