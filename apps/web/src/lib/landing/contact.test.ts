import { describe, expect, it } from "vitest";
import { readContactChannel } from "./contact";

describe("canal de contact de l'offre Business", () => {
  it.each([
    ["mailto:contact@exemple.test", "email"],
    ["tel:+2250700000000", "phone"],
    ["https://wa.me/2250700000000", "whatsapp"],
    ["https://exemple.test/contact", "web"],
  ] as const)("accepte %s", (value, kind) => {
    expect(readContactChannel({ QADR_CONTACT_URL: value })).toEqual({ href: kind === "web" || kind === "whatsapp" ? new URL(value).toString() : value, kind });
  });

  it.each<{ value: string | undefined; reason: string }>([
    { value: undefined, reason: "absent" },
    { value: "", reason: "vide" },
    { value: "contact@exemple.test", reason: "adresse sans mailto:" },
    { value: "mailto:pas-une-adresse", reason: "adresse mal formée" },
    { value: "mailto:a@b.test?subject=x y", reason: "espace dans l'adresse" },
    { value: "tel:abc", reason: "numéro mal formé" },
    { value: "http://exemple.test/contact", reason: "HTTP sans chiffrement" },
    { value: "javascript:alert(1)", reason: "schéma javascript" },
    { value: "https://user:secret@exemple.test/", reason: "identifiants dans l'adresse" },
  ])("refuse une valeur : $reason", ({ value }) => {
    expect(readContactChannel({ QADR_CONTACT_URL: value })).toBeNull();
  });
});
