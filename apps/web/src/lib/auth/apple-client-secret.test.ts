import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
// @ts-expect-error script Node sans déclaration de types
import { appleClientSecret } from "../../../scripts/apple-client-secret.mjs";

/* Clé jetable générée pour le test : aucune vraie clé Apple n'est utilisée. */
describe("secret client Apple (scripts/apple-client-secret.mjs)", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const base = { teamId: "TEAM123456", keyId: "KEY1234567", clientId: "com.exemple.qadrops.web", privateKeyPem: pem };

  it("produit un JWT ES256 conforme, signé par la clé et valable 180 jours au plus", () => {
    const now = new Date("2026-11-08T00:00:00Z");
    const { token, expiresAt } = appleClientSecret({ ...base, now });
    const [header, payload, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY1234567", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims).toEqual({ iss: "TEAM123456", iat: 1_794_096_000, exp: 1_794_096_000 + 180 * 86_400, aud: "https://appleid.apple.com", sub: "com.exemple.qadrops.web" });
    expect(expiresAt.toISOString()).toBe("2027-05-07T00:00:00.000Z");
    const valid = verify("sha256", Buffer.from(`${header}.${payload}`), { key: createPublicKey(privateKey), dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
    expect(valid).toBe(true);
  });

  it("refuse une validité trop longue, des identifiants mal formés ou une clé d'un autre type", () => {
    expect(() => appleClientSecret({ ...base, days: 181 })).toThrow("Validité : 1 à 180 jours.");
    expect(() => appleClientSecret({ ...base, teamId: "court" })).toThrow(/APPLE_TEAM_ID/);
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(() => appleClientSecret({ ...base, privateKeyPem: rsa })).toThrow(/ECDSA P-256/);
  });
});
