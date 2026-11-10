import { describe, expect, it } from "vitest";
import { readVapidKeys, vapidSubjectProblem } from "./vapid-config";

/* Mission 16 : le contact VAPID doit joindre réellement l'exploitant ; une adresse d'exemple est refusée en production. */
const keys = { VAPID_PUBLIC_KEY: "B".repeat(87), VAPID_PRIVATE_KEY: "a".repeat(43) };

describe("sujet VAPID", () => {
  it("accepte une adresse mailto: ou une URL https: sur un vrai domaine", () => {
    for (const subject of ["mailto:support@qadr-ops.ci", "mailto:ops@qadragency.com", "https://qadr-ops.ci", "https://www.qadr-ops.ci/contact"]) {
      expect(vapidSubjectProblem(subject)).toBeNull();
    }
  });

  it("repère les domaines d'exemple et locaux (RFC 2606 / 6761) et l'exemple du script de génération", () => {
    for (const subject of ["mailto:support@example.com", "mailto:votre-adresse@exemple.com", "mailto:ops@qadr.example", "https://example.org",
      "mailto:a@sub.example.net", "https://localhost", "mailto:ops@qadr.test", "https://127.0.0.1"]) {
      expect(vapidSubjectProblem(subject)).toBe("placeholder");
    }
  });

  it("refuse un format inutilisable", () => {
    expect(vapidSubjectProblem(undefined)).toBe("missing");
    expect(vapidSubjectProblem("  ")).toBe("missing");
    for (const subject of ["support@qadr-ops.ci", "mailto:", "mailto:sans-arobase", "http://qadr-ops.ci", "https://user:pass@qadr-ops.ci", "mailto:a@b"]) {
      expect(vapidSubjectProblem(subject)).toBe("format");
    }
  });

  it("production : un sujet d'exemple désactive le push (non configuré) ; hors production il reste toléré pour les essais", () => {
    expect(readVapidKeys({ ...keys, VAPID_SUBJECT: "mailto:support@example.com", NODE_ENV: "production" })).toBeNull();
    expect(readVapidKeys({ ...keys, VAPID_SUBJECT: "mailto:support@example.com", NODE_ENV: "development" })).toMatchObject({ subject: "mailto:support@example.com" });
    expect(readVapidKeys({ ...keys, VAPID_SUBJECT: "mailto:support@qadr-ops.ci", NODE_ENV: "production" })).toEqual({
      publicKey: keys.VAPID_PUBLIC_KEY, privateKey: keys.VAPID_PRIVATE_KEY, subject: "mailto:support@qadr-ops.ci" });
  });

  it("sans l'une des trois variables, ou avec un sujet mal formé, le push n'est pas configuré", () => {
    expect(readVapidKeys({ ...keys, NODE_ENV: "production" })).toBeNull();
    expect(readVapidKeys({ VAPID_PUBLIC_KEY: keys.VAPID_PUBLIC_KEY, VAPID_SUBJECT: "mailto:support@qadr-ops.ci", NODE_ENV: "production" })).toBeNull();
    expect(readVapidKeys({ ...keys, VAPID_SUBJECT: "support@qadr-ops.ci", NODE_ENV: "development" })).toBeNull();
  });
});
