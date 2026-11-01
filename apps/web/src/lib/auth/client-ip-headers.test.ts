import { describe, expect, it } from "vitest";
import { clientIpHeaders } from "./client-ip-headers";

describe("clientIpHeaders", () => {
  it("utilise cf-connecting-ip dans le runtime Cloudflare Workers", () => {
    expect(clientIpHeaders("Cloudflare-Workers")).toEqual(["cf-connecting-ip"]);
  });

  it("garde x-forwarded-for ailleurs, où cf-connecting-ip serait falsifiable", () => {
    expect(clientIpHeaders(`Node.js/${process.versions.node.split(".")[0]}`)).toEqual(["x-forwarded-for"]);
    expect(clientIpHeaders(undefined)).toEqual(["x-forwarded-for"]);
  });
});
