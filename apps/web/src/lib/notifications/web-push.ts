import { createECDH, createHmac, createCipheriv, createPrivateKey, randomBytes, sign } from "node:crypto";

/*
 * Web Push sans fournisseur payant ni dépendance : chiffrement du message (RFC 8291, aes128gcm de la
 * RFC 8188) et identification du serveur par VAPID (RFC 8292). Le paquet `web-push` n'a plus de version
 * depuis janvier 2024 ; ces quelques primitives de `node:crypto` sont vérifiées contre le vecteur de test
 * officiel de la RFC 8291 (web-push.test.ts).
 */

export const b64url = {
  encode: (buffer: Buffer | Uint8Array) => Buffer.from(buffer).toString("base64url"),
  decode: (value: string) => Buffer.from(value, "base64url"),
};

function hmac(key: Buffer, data: Buffer) {
  return createHmac("sha256", key).update(data).digest();
}

/** HKDF-SHA256 limité à une sortie de 32 octets ou moins (un seul bloc), suffisant pour la RFC 8291. */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number) {
  const prk = hmac(salt, ikm);
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

export type EncryptOptions = {
  uaPublicKey: string; authSecret: string; plaintext: Buffer;
  /** Pour les tests uniquement (vecteur RFC) ; sinon générés aléatoirement à chaque message. */
  asPrivateKey?: Buffer; salt?: Buffer; recordSize?: number;
};

/** Corps chiffré `aes128gcm` d'un message push (un seul enregistrement, sans remplissage). */
export function encryptPushPayload(options: EncryptOptions) {
  const uaPublic = b64url.decode(options.uaPublicKey);
  const authSecret = b64url.decode(options.authSecret);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("Clé publique d’abonnement invalide.");
  if (authSecret.length !== 16) throw new Error("Secret d’authentification d’abonnement invalide.");
  const ecdh = createECDH("prime256v1");
  if (options.asPrivateKey) ecdh.setPrivateKey(options.asPrivateKey); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(uaPublic);
  const salt = options.salt ?? randomBytes(16);
  const recordSize = options.recordSize ?? 4096;

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, sharedSecret, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  if (options.plaintext.length + 1 + 16 > recordSize) throw new Error("Message push trop long.");

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(Buffer.concat([options.plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(recordSize, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, ciphertext]);
}

export type VapidKeys = { publicKey: string; privateKey: string; subject: string };

/** En-tête `Authorization: vapid t=…, k=…` (JWT ES256 valable 12 h pour l'origine du service push). */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()) {
  const publicKey = b64url.decode(keys.publicKey);
  if (publicKey.length !== 65) throw new Error("Clé publique VAPID invalide.");
  const key = createPrivateKey({ format: "jwk", key: { kty: "EC", crv: "P-256", d: keys.privateKey,
    x: b64url.encode(publicKey.subarray(1, 33)), y: b64url.encode(publicKey.subarray(33, 65)) } });
  const header = b64url.encode(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url.encode(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64url.encode(signature)}, k=${keys.publicKey}`;
}

/** Paire VAPID neuve (script `scripts/generate-vapid-keys.mjs`). */
export function generateVapidKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64url.encode(ecdh.getPublicKey()), privateKey: b64url.encode(ecdh.getPrivateKey()) };
}

/**
 * Services push connus : un abonnement vers une autre adresse est refusé (sinon le serveur pourrait être
 * poussé à appeler une URL interne choisie par un attaquant).
 */
const pushHosts = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/, /^web\.push\.apple\.com$/, /^[a-z0-9.-]+\.push\.apple\.com$/];

export function isAllowedPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && !url.port && pushHosts.some((pattern) => pattern.test(url.hostname));
  } catch { return false; }
}

export type PushTarget = { endpoint: string; p256dh: string; auth: string };
export type PushResult = { ok: true; status: number } | { ok: false; status: number | null; expired: boolean; retryable: boolean; error: string };
export type PushSender = (target: PushTarget, payload: object, options: { ttlSeconds: number; urgency: "normal" | "high"; topic?: string }) => Promise<PushResult>;

/** Envoi réel par `fetch` (délai de 10 s). 404/410 = appareil désabonné ; 429 et 5xx = réessayable. */
export function createWebPushSender(keys: VapidKeys): PushSender {
  return async (target, payload, options) => {
    if (!isAllowedPushEndpoint(target.endpoint)) return { ok: false, status: null, expired: true, retryable: false, error: "endpoint_not_allowed" };
    const body = encryptPushPayload({ uaPublicKey: target.p256dh, authSecret: target.auth, plaintext: Buffer.from(JSON.stringify(payload)) });
    try {
      const response = await fetch(target.endpoint, {
        method: "POST", body, signal: AbortSignal.timeout(10_000),
        headers: { authorization: vapidAuthorization(target.endpoint, keys), "content-encoding": "aes128gcm", "content-type": "application/octet-stream",
          ttl: String(options.ttlSeconds), urgency: options.urgency, ...(options.topic ? { topic: options.topic } : {}) },
      });
      if (response.ok) return { ok: true, status: response.status };
      return { ok: false, status: response.status, expired: response.status === 404 || response.status === 410,
        retryable: response.status === 429 || response.status >= 500, error: `http_${response.status}` };
    } catch (error) {
      return { ok: false, status: null, expired: false, retryable: true, error: error instanceof Error ? error.name : "network" };
    }
  };
}
