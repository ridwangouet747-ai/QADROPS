import { describe, expect, it } from "vitest";
import { ACCESS_PASS_TTL_MS, accessPassCookie, accessPassCookieName, readAccessPass } from "@/lib/commercial/access-pass";
import { addAccessDuration, commercialCodeState } from "@/lib/domain/commercial-codes";
import {
  CODE_ALPHABET, accessCodeFamilyOf, accessCodeHint, generateAccessCode, hashAccessCode, normalizeAccessCode, sameDigest, signPass, verifyPass,
} from "./access-codes";

const secretA = { BETTER_AUTH_SECRET: "secret-de-test-numero-un-0123456789-abcdef" };
const secretB = { BETTER_AUTH_SECRET: "secret-de-test-numero-deux-0123456789-abcdef" };

describe("codes d'accès : format, familles, empreintes", () => {
  it("génère des codes au format de leur famille, dans l'alphabet sans caractères ambigus", () => {
    const commercial = generateAccessCode("commercial");
    const invite = generateAccessCode("invite");
    expect(commercial).toMatch(new RegExp(`^QADR(-[${CODE_ALPHABET}]{4}){4}$`));
    expect(invite).toMatch(new RegExp(`^EQP(-[${CODE_ALPHABET}]{4}){3}$`));
    for (const ambiguous of ["0", "O", "1", "I", "L"]) expect(CODE_ALPHABET).not.toContain(ambiguous);
  });

  it("unicité : 5 000 codes commerciaux tirés au hasard sont tous différents", () => {
    const codes = new Set(Array.from({ length: 5_000 }, () => generateAccessCode("commercial")));
    expect(codes.size).toBe(5_000);
  });

  it("normalise la saisie (casse, espaces, tirets) et refuse tout ce qui ne peut pas être un code", () => {
    const code = generateAccessCode("commercial");
    const normalized = normalizeAccessCode("commercial", code)!;
    expect(normalizeAccessCode("commercial", ` ${code.toLowerCase().replace(/-/g, " ")} `)).toBe(normalized);
    expect(normalizeAccessCode("commercial", code.slice(0, -1))).toBeNull();
    expect(normalizeAccessCode("commercial", `${code.slice(0, -1)}0`)).toBeNull();
    expect(normalizeAccessCode("commercial", generateAccessCode("invite"))).toBeNull();
    expect(normalizeAccessCode("invite", code)).toBeNull();
    expect(normalizeAccessCode("commercial", 42)).toBeNull();
    expect(normalizeAccessCode("commercial", "Q".repeat(65))).toBeNull();
    expect(accessCodeHint(normalized)).toBe(normalized.slice(-4));
  });

  it("reconnaît la famille par le préfixe pour orienter la personne vers la bonne page", () => {
    expect(accessCodeFamilyOf("qadr-abcd")).toBe("commercial");
    expect(accessCodeFamilyOf(" eqp 2345")).toBe("invite");
    expect(accessCodeFamilyOf("PROMO-2026")).toBeNull();
    expect(accessCodeFamilyOf(undefined)).toBeNull();
  });

  it("empreinte HMAC : stable, propre à la famille et au secret, jamais égale au code", () => {
    const normalized = normalizeAccessCode("commercial", generateAccessCode("commercial"))!;
    const hash = hashAccessCode("commercial", normalized, secretA);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(normalized);
    expect(hashAccessCode("commercial", normalized, secretA)).toBe(hash);
    expect(hashAccessCode("invite", normalized, secretA)).not.toBe(hash);
    expect(hashAccessCode("commercial", normalized, secretB)).not.toBe(hash);
    expect(sameDigest(hash, hashAccessCode("commercial", normalized, secretA))).toBe(true);
    expect(sameDigest(hash, hashAccessCode("commercial", normalized, secretB))).toBe(false);
    expect(sameDigest(hash, "abcd")).toBe(false);
  });

  it("refuse de fonctionner sans secret sur un déploiement", () => {
    expect(() => hashAccessCode("commercial", "QADR2345", { VERCEL_ENV: "production" })).toThrow(/QADR_CODE_SECRET/);
    expect(() => hashAccessCode("commercial", "QADR2345", { VERCEL_ENV: "preview", BETTER_AUTH_SECRET: "court" })).toThrow(/QADR_CODE_SECRET/);
    expect(() => hashAccessCode("commercial", "QADR2345", { NODE_ENV: "test" })).not.toThrow();
  });
});

describe("laissez-passer d'activation", () => {
  const cookieHeader = (setCookie: string) => new Headers({ cookie: setCookie.split(";")[0]! });

  it("désigne l'identifiant du code (jamais le code) pendant deux heures, puis plus rien", () => {
    const now = new Date("2026-11-16T10:00:00Z");
    const setCookie = accessPassCookie("code-123", now, secretA);
    expect(setCookie).toMatch(/HttpOnly; SameSite=Lax; Max-Age=7200$/);
    expect(setCookie).not.toMatch(/Secure/);
    expect(readAccessPass(cookieHeader(setCookie), now, secretA)).toBe("code-123");
    expect(readAccessPass(cookieHeader(setCookie), new Date(now.getTime() + ACCESS_PASS_TTL_MS - 1), secretA)).toBe("code-123");
    expect(readAccessPass(cookieHeader(setCookie), new Date(now.getTime() + ACCESS_PASS_TTL_MS), secretA)).toBeNull();
  });

  it("cookie __Host- et Secure dès que l'application est servie en HTTPS", () => {
    const https = { ...secretA, BETTER_AUTH_URL: "https://qadrops.example" };
    expect(accessPassCookieName(https)).toBe("__Host-qadr-access-pass");
    expect(accessPassCookie("c", new Date(), https)).toMatch(/; Secure$/);
  });

  it("un laissez-passer modifié, signé avec un autre secret ou mal formé ne désigne rien", () => {
    const now = new Date();
    const setCookie = accessPassCookie("code-123", now, secretA);
    const [name, token] = setCookie.split(";")[0]!.split("=") as [string, string];
    const [body, mac] = token.split(".") as [string, string];
    const forgedBody = Buffer.from(JSON.stringify({ v: 1, c: "autre-code", e: now.getTime() + 60_000 })).toString("base64url");
    expect(readAccessPass(new Headers({ cookie: `${name}=${forgedBody}.${mac}` }), now, secretA)).toBeNull();
    expect(readAccessPass(new Headers({ cookie: `${name}=${body}.${mac}` }), now, secretB)).toBeNull();
    expect(readAccessPass(new Headers({ cookie: `${name}=${body}` }), now, secretA)).toBeNull();
    expect(readAccessPass(new Headers({ cookie: `${name}=${body}.${mac}.x` }), now, secretA)).toBeNull();
    expect(readAccessPass(new Headers(), now, secretA)).toBeNull();
    // Un laissez-passer valide mais d'une autre version n'est pas accepté.
    expect(readAccessPass(new Headers({ cookie: `${name}=${signPass({ v: 2, c: "x", e: now.getTime() + 60_000 }, secretA)}` }), now, secretA)).toBeNull();
    expect(verifyPass("x".repeat(601), secretA)).toBeNull();
  });
});

describe("durées d'accès (UTC, mois du calendrier)", () => {
  const utc = (iso: string) => new Date(iso);

  it("ajoute des jours exacts", () => {
    expect(addAccessDuration(utc("2026-11-16T09:30:00.000Z"), "day", 7).toISOString()).toBe("2026-11-23T09:30:00.000Z");
    expect(addAccessDuration(utc("2026-12-20T23:59:59.000Z"), "day", 21).toISOString()).toBe("2027-01-10T23:59:59.000Z");
  });

  it("ajoute des mois du calendrier et retombe sur le dernier jour quand il manque", () => {
    expect(addAccessDuration(utc("2026-11-16T09:30:00.000Z"), "month", 1).toISOString()).toBe("2026-12-16T09:30:00.000Z");
    expect(addAccessDuration(utc("2026-12-15T00:00:00.000Z"), "month", 1).toISOString()).toBe("2027-01-15T00:00:00.000Z");
    expect(addAccessDuration(utc("2027-01-31T12:00:00.000Z"), "month", 1).toISOString()).toBe("2027-02-28T12:00:00.000Z");
    expect(addAccessDuration(utc("2028-01-31T12:00:00.000Z"), "month", 1).toISOString()).toBe("2028-02-29T12:00:00.000Z");
    expect(addAccessDuration(utc("2026-03-31T08:00:00.000Z"), "month", 3).toISOString()).toBe("2026-06-30T08:00:00.000Z");
    expect(addAccessDuration(utc("2026-11-30T08:00:00.000Z"), "month", 3).toISOString()).toBe("2027-02-28T08:00:00.000Z");
  });

  it("état d'un code : révoqué ou utilisé l'emporte sur l'échéance", () => {
    const now = utc("2026-11-16T10:00:00Z");
    const later = utc("2026-12-16T10:00:00Z");
    const earlier = utc("2026-11-01T10:00:00Z");
    expect(commercialCodeState({ consumedAt: null, revokedAt: null, activationDeadline: later }, now)).toBe("unused");
    expect(commercialCodeState({ consumedAt: null, revokedAt: null, activationDeadline: now }, now)).toBe("expired");
    expect(commercialCodeState({ consumedAt: null, revokedAt: earlier, activationDeadline: earlier }, now)).toBe("revoked");
    expect(commercialCodeState({ consumedAt: earlier, revokedAt: null, activationDeadline: earlier }, now)).toBe("used");
  });
});
