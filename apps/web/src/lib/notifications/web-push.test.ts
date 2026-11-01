import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { b64url, encryptPushPayload, generateVapidKeys, isAllowedPushEndpoint, vapidAuthorization } from "./web-push";

// Vecteur de l'annexe A de la RFC 8291 (« When I grow up, I want to be a watermelon »).
const rfc = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

/** Déchiffrement côté navigateur (RFC 8291), pour vérifier un message produit avec des clés aléatoires. */
function decrypt(body: Buffer, uaPrivate: Buffer, authSecret: Buffer) {
  const salt = body.subarray(0, 16);
  const keyLength = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + keyLength);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(asPublic);
  const h = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();
  const expand = (s: Buffer, ikm: Buffer, info: Buffer, n: number) => h(h(s, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, n);
  const ikm = expand(authSecret, shared, Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublic]), 32);
  const cek = expand(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = expand(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const data = body.subarray(21 + keyLength);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(data.subarray(data.length - 16));
  const padded = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
  return padded.subarray(0, padded.lastIndexOf(2)).toString();
}

describe("Web Push standard (RFC 8291 / 8292)", () => {
  it("reproduit octet pour octet le vecteur de test de la RFC 8291", () => {
    const body = encryptPushPayload({ uaPublicKey: rfc.uaPublic, authSecret: rfc.auth, plaintext: Buffer.from(rfc.plaintext),
      asPrivateKey: b64url.decode(rfc.asPrivate), salt: b64url.decode(rfc.salt) });
    expect(b64url.encode(body)).toBe(rfc.body);
  });

  it("chiffre avec des clés aléatoires un message que le navigateur sait relire", () => {
    const body = encryptPushPayload({ uaPublicKey: rfc.uaPublic, authSecret: rfc.auth, plaintext: Buffer.from('{"title":"Qadr Ops"}') });
    expect(decrypt(body, b64url.decode(rfc.uaPrivate), b64url.decode(rfc.auth))).toBe('{"title":"Qadr Ops"}');
    expect(b64url.encode(body.subarray(0, 16))).not.toBe(rfc.salt);
  });

  it("signe un JWT VAPID ES256 vérifiable, limité à l'origine du service push", () => {
    const keys = { ...generateVapidKeys(), subject: "mailto:ops@qadr.example" };
    const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, Date.UTC(2026, 9, 31));
    const [, token, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = token!.split(".");
    expect(JSON.parse(b64url.decode(c!).toString())).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "mailto:ops@qadr.example", exp: Date.UTC(2026, 9, 31) / 1000 + 43200 });
    const raw = b64url.decode(keys.publicKey);
    const publicKey = createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: b64url.encode(raw.subarray(1, 33)), y: b64url.encode(raw.subarray(33)) } });
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, b64url.decode(s!))).toBe(true);
  });

  it("n'accepte que les services push connus, en HTTPS", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/x")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isAllowedPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://169.254.169.254/latest")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.test/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
  });
});
