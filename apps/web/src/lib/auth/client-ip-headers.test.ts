import { describe, expect, it } from "vitest";
import { clientIpFrom, clientIpHeaders } from "./client-ip-headers";

describe("clientIpHeaders", () => {
  it("utilise cf-connecting-ip dans le runtime Cloudflare Workers", () => {
    expect(clientIpHeaders("Cloudflare-Workers")).toEqual(["cf-connecting-ip"]);
  });

  it("garde x-forwarded-for ailleurs, où cf-connecting-ip serait falsifiable", () => {
    expect(clientIpHeaders(`Node.js/${process.versions.node.split(".")[0]}`)).toEqual(["x-forwarded-for"]);
    expect(clientIpHeaders(undefined)).toEqual(["x-forwarded-for"]);
  });
});

describe("clientIpFrom", () => {
  it("prend le premier élément de l'en-tête de confiance", () => {
    expect(clientIpFrom(new Headers({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" }), ["x-forwarded-for"])).toBe("203.0.113.7");
  });

  it("ignore un en-tête non retenu (falsifiable) et retombe sur une clé commune", () => {
    expect(clientIpFrom(new Headers({ "cf-connecting-ip": "198.51.100.1" }), ["x-forwarded-for"])).toBe("unknown");
  });
});
