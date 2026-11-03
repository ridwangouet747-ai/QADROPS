import { describe, expect, it } from "vitest";
import { canonicalRequest, EMPTY_PAYLOAD_SHA256, presignUrl, sha256Hex, signHeaders, stringToSign, credentialScope, type SigV4Request } from "./sigv4";

/*
 * Vecteurs officiels AWS Signature Version 4 : suite de tests publiée par AWS dans le dépôt
 * awslabs/aws-c-auth (`tests/aws-signing-test-suite/v4/<cas>/`), relevés le 2026-11-03.
 * Pour chaque cas : requête canonique, signature par en-tête (`header-signature.txt`) et
 * signature par paramètres (`query-signature.txt`). Identifiants d'exemple publiés par AWS.
 */
const credentials = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };
const date = new Date("2015-08-30T12:36:00Z");
const base = { credentials, date, region: "us-east-1", service: "service" };
const host = "example.amazonaws.com";

type Vector = { name: string; request: SigV4Request; body?: string; canonical: string; header: string; query: string };

const vectors: Vector[] = [
  {
    name: "get-vanilla", request: { method: "GET", host, path: "/" },
    canonical: `GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY_PAYLOAD_SHA256}`,
    header: "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    query: "e93c787ed7f371d5c6b165c1b38ede9550f4dce4144713e844b25b7192d3865d",
  },
  {
    name: "get-vanilla-query-order-key-case", request: { method: "GET", host, path: "/", query: [["Param2", "value2"], ["Param1", "value1"]] },
    canonical: `GET\n/\nParam1=value1&Param2=value2\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY_PAYLOAD_SHA256}`,
    header: "b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500",
    query: "86012e2c9ad4d77369f5d81c11f75158aae4f895a085212cc6d3f923d300bed5",
  },
  {
    name: "get-vanilla-query-unreserved",
    request: { method: "GET", host, path: "/", query: [["-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", "-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"]] },
    canonical: `GET\n/\n-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz=-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY_PAYLOAD_SHA256}`,
    header: "9c3e54bfcdf0b19771a7f523ee5669cdf59bc7cc0884027167c21bb143a40197",
    query: "8e76a88a7433637b12778d5592799b29ad21ecd6cf6325051c21d86f0acda2bf",
  },
  {
    name: "get-utf8", request: { method: "GET", host, path: "/ሴ" },
    canonical: `GET\n/%E1%88%B4\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY_PAYLOAD_SHA256}`,
    header: "8318018e0b0f223aa2bbf98705b62bb787dc9c0e678f255a891fd03141be5d85",
    query: "10eae3f14a260bd3911cc6d008d3c576d143b05b62f09782a7a4b37f52178e44",
  },
  {
    name: "get-header-value-trim", request: { method: "GET", host, path: "/", headers: { "My-Header1": " value1", "My-Header2": " \"a   b   c\"" } },
    canonical: `GET\n/\n\nhost:example.amazonaws.com\nmy-header1:value1\nmy-header2:"a b c"\nx-amz-date:20150830T123600Z\n\nhost;my-header1;my-header2;x-amz-date\n${EMPTY_PAYLOAD_SHA256}`,
    header: "acc3ed3afb60bb290fc8d2dd0098b9911fcaa05412b367055dee359757a9c736",
    query: "e7bb0fd515e125e1aec2ecc4c0c17484fb06f6846b927c35e46005dd3df3acd4",
  },
];

const signatureOf = (authorization: string) => /Signature=([0-9a-f]{64})$/.exec(authorization)?.[1];

describe("SigV4 : vecteurs officiels AWS (aws-signing-test-suite)", () => {
  for (const vector of vectors) {
    it(`${vector.name} : requête canonique, signature par en-tête et par URL`, () => {
      const withDate = { ...vector.request, headers: { ...vector.request.headers, "x-amz-date": "20150830T123600Z" } };
      expect(canonicalRequest(withDate, EMPTY_PAYLOAD_SHA256).text).toBe(vector.canonical);
      const headers = signHeaders(vector.request, EMPTY_PAYLOAD_SHA256, { ...base, contentSha256Header: false });
      expect(signatureOf(headers.authorization)).toBe(vector.header);
      expect(headers.authorization).toContain("Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request");
      const url = new URL(presignUrl({ ...vector.request, headers: vector.request.headers }, { ...base, expiresSeconds: 3600, payloadHash: EMPTY_PAYLOAD_SHA256 }));
      expect(url.searchParams.get("X-Amz-Signature")).toBe(vector.query);
    });
  }

  it("get-header-value-trim : chaîne à signer identique au vecteur", () => {
    const request = { ...vectors[4]!.request, headers: { ...vectors[4]!.request.headers, "x-amz-date": "20150830T123600Z" } };
    expect(stringToSign(date, credentialScope(date, "us-east-1", "service"), canonicalRequest(request, EMPTY_PAYLOAD_SHA256).text))
      .toBe("AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\na726db9b0df21c14f559d0a978e563112acb1b9e05476f0a6a1c7d68f28605c7");
  });

  it("post-x-www-form-urlencoded : corps signé (x-amz-content-sha256) et URL présignée", () => {
    const body = "Param1=value1";
    const payloadHash = sha256Hex(body);
    expect(payloadHash).toBe("9095672bbd1f56dfc5b65f3e153adc8731a4a654192329106275f4c7b24d0b6e");
    const request: SigV4Request = { method: "POST", host, path: "/", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": "13" } };
    expect(signatureOf(signHeaders(request, payloadHash, base).authorization)).toBe("d3875051da38690788ef43de4db0d8f280229d82040bfac253562e56c3f20e0b");
    const url = new URL(presignUrl(request, { ...base, expiresSeconds: 3600, payloadHash }));
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(url.searchParams.get("X-Amz-Signature")).toBe("89a40deed0f26f9461242825a082d2222717248abc7ab41f552ad84a94ad46e9");
  });
});

describe("SigV4 : règles propres à S3/R2", () => {
  const r2 = { credentials, date, region: "auto", service: "s3" };

  it("encode le chemin une seule fois, segment par segment, sans normaliser", () => {
    const request: SigV4Request = { method: "GET", host: "compte.r2.cloudflarestorage.com", path: "/seau/dossier/a b$c+d~é/./x" };
    expect(canonicalRequest(request, EMPTY_PAYLOAD_SHA256).text.split("\n")[1]).toBe("/seau/dossier/a%20b%24c%2Bd~%C3%A9/./x");
  });

  it("URL présignée : durée bornée, paramètres attendus, corps non signé, signature déterministe", () => {
    const request: SigV4Request = { method: "GET", host: "compte.r2.cloudflarestorage.com", path: "/seau/import_source/abc" };
    const first = new URL(presignUrl(request, { ...r2, expiresSeconds: 300 }));
    expect(first.pathname).toBe("/seau/import_source/abc");
    expect(first.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(first.searchParams.get("X-Amz-Date")).toBe("20150830T123600Z");
    expect(first.searchParams.get("X-Amz-Credential")).toBe("AKIDEXAMPLE/20150830/auto/s3/aws4_request");
    expect(first.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(first.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(presignUrl(request, { ...r2, expiresSeconds: 300 })).toBe(first.toString());
    // Une autre durée ou une autre clé d'objet change la signature : l'URL ne peut pas être prolongée ni détournée.
    expect(new URL(presignUrl(request, { ...r2, expiresSeconds: 301 })).searchParams.get("X-Amz-Signature")).not.toBe(first.searchParams.get("X-Amz-Signature"));
    expect(new URL(presignUrl({ ...request, path: "/seau/import_source/abd" }, { ...r2, expiresSeconds: 300 })).searchParams.get("X-Amz-Signature"))
      .not.toBe(first.searchParams.get("X-Amz-Signature"));
    // Le secret n'apparaît jamais dans l'URL.
    expect(first.toString()).not.toContain(credentials.secretAccessKey);
  });

  it("refuse une durée nulle, fractionnaire ou supérieure à 7 jours", () => {
    const request: SigV4Request = { method: "GET", host: "compte.r2.cloudflarestorage.com", path: "/seau/x" };
    for (const expiresSeconds of [0, -1, 1.5, 604_801]) expect(() => presignUrl(request, { ...r2, expiresSeconds })).toThrow(RangeError);
    expect(() => presignUrl(request, { ...r2, expiresSeconds: 604_800 })).not.toThrow();
  });

  it("l'en-tête Authorization ne contient jamais la clé secrète", () => {
    const headers: Record<string, string> = signHeaders({ method: "PUT", host: "compte.r2.cloudflarestorage.com", path: "/seau/x" }, sha256Hex("contenu"), r2);
    expect(headers["x-amz-content-sha256"]).toBe(sha256Hex("contenu"));
    expect(JSON.stringify(headers)).not.toContain(credentials.secretAccessKey);
  });
});
