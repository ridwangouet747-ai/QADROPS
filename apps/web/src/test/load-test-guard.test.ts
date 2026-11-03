import { describe, expect, it } from "vitest";
import { assertPreproductionTarget } from "../../load-tests/lib/target.js";

describe("mission 11, phase 7 : garde-fou des tests de charge k6", () => {
  it("accepte une préproduction explicite ou un poste local", () => {
    for (const [raw, expected] of [
      ["http://localhost:3000", "http://localhost:3000"],
      ["http://127.0.0.1:3001/", "http://127.0.0.1:3001"],
      ["https://staging.qadr-ops.example", "https://staging.qadr-ops.example"],
      ["https://qadr-ops-git-main-preview.vercel.app/", "https://qadr-ops-git-main-preview.vercel.app"],
      ["https://preprod.exemple.ci", "https://preprod.exemple.ci"],
      ["http://qadr.test", "http://qadr.test"],
      ["http://[::1]:3000", "http://[::1]:3000"],
      ["HTTPS://STAGING.Exemple.com:443/base/", "https://staging.exemple.com/base"],
    ]) expect(assertPreproductionTarget(raw)).toBe(expected);
  });

  it("refuse la production, une URL vide ou ambiguë, sans aucune option pour passer outre", () => {
    for (const raw of [undefined, "", "pas une url", "https://qadr-ops.com", "https://app.qadr-ops.ci", "https://www.exemple.com",
      // Un marqueur noyé dans un mot n'est pas un marqueur.
      "https://stagingless.exemple.com", "https://qadrstaging.exemple.com",
      // Le chemin et les paramètres ne comptent pas : seul le nom d'hôte décide.
      "https://app.qadr-ops.ci/staging", "https://app.qadr-ops.ci/?env=preview",
      "ftp://staging.exemple.com", "https://user:pass@staging.exemple.com", "https://staging.exemple.com@qadr-ops.com", "http://staging.exemple.com",
      "https://staging..exemple.com", "https://qadr-ops.com:8443?cible=staging"]) {
      expect(() => assertPreproductionTarget(raw), String(raw)).toThrow();
    }
  });
});
