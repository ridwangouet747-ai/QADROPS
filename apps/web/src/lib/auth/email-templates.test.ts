import { describe, expect, it } from "vitest";
import { emailMessages } from "./email-messages";
import { renderInvitationEmail, renderPasswordResetEmail, renderVerificationEmail } from "./email-templates";

const invitation = {
  to: "chantal@qadr.test", invitationId: "inv_123", businessName: "Quincaillerie Koné & Fils", inviterName: "Aminata Koné",
  role: "cashier", expiresAt: new Date("2026-11-07T10:30:00Z"), baseURL: "https://app.example.test/",
};

/** Structure des clés (sans les valeurs) pour vérifier la parité des langues. */
const shape = (value: unknown): unknown => typeof value === "object" && value ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, shape(child)])) : typeof value;

describe("modèles d’e-mails multilingues", () => {
  it("proposent les mêmes textes en français, anglais et arabe", () => {
    expect(shape(emailMessages.en)).toEqual(shape(emailMessages.fr));
    expect(shape(emailMessages.ar)).toEqual(shape(emailMessages.fr));
  });

  it("rédige l’invitation française avec commerce, invitant, rôle, échéance et lien d’acceptation", () => {
    const message = renderInvitationEmail({ ...invitation, locale: "fr" });
    expect(message).toMatchObject({ kind: "invitation", locale: "fr", to: "chantal@qadr.test", actionUrl: "https://app.example.test/invitations/inv_123" });
    expect(message.subject).toBe("Aminata Koné vous invite à rejoindre Quincaillerie Koné & Fils sur QADR OPS");
    expect(message.html).toContain('<html lang="fr" dir="ltr">');
    expect(message.html).toContain("<bdi>Quincaillerie Koné &amp; Fils</bdi>");
    expect(message.html).toContain("Caissier");
    expect(message.html).toContain('href="https://app.example.test/invitations/inv_123"');
    expect(message.text).toContain("Rôle proposé : Caissier");
    expect(message.text).toContain("Valable jusqu’au : 7 novembre 2026");
    expect(message.text).toContain("https://app.example.test/invitations/inv_123");
    expect(message.idempotencyKey).toBe(`invitation/inv_123/${invitation.expiresAt.getTime()}`);
  });

  it("produit une vraie mise en page RTL en arabe sans traduire les noms propres", () => {
    const message = renderInvitationEmail({ ...invitation, locale: "ar" });
    expect(message.html).toContain('<html lang="ar" dir="rtl">');
    expect(message.html).toContain('<body dir="rtl"');
    expect(message.html).toContain("text-align:right");
    expect(message.html).toContain("أمين الصندوق");
    expect(message.html).toContain("<bdi>Aminata Koné</bdi>");
    expect(message.text).toContain("⁨Quincaillerie Koné & Fils⁩");
    // Le lien reste lisible de gauche à droite au milieu du texte arabe.
    expect(message.html).toContain('<p dir="ltr"');
  });

  it("existe en anglais", () => {
    const message = renderInvitationEmail({ ...invitation, locale: "en" });
    expect(message.subject).toBe("Aminata Koné invited you to join Quincaillerie Koné & Fils on QADR OPS");
    expect(message.text).toContain("Proposed role: Cashier");
  });

  it("neutralise le HTML et les retours à la ligne dans les noms saisis", () => {
    const message = renderInvitationEmail({ ...invitation, locale: "fr", businessName: "<script>alert(1)</script>", inviterName: "Pirate\r\nBcc: victime@example.test" });
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.subject).not.toMatch(/[\r\n]/);
  });

  it("n’utilise ni image, ni police, ni feuille de style externe", () => {
    for (const message of [renderInvitationEmail({ ...invitation, locale: "fr" }), renderPasswordResetEmail({ locale: "ar", to: "a@qadr.test", url: "https://app.example.test/r", token: "t" })]) {
      expect(message.html).not.toMatch(/<img|<link|@import|url\(/i);
      expect(message.html.match(/https?:\/\/[^"<\s]+/g)?.every((url) => url.startsWith("https://app.example.test/"))).toBe(true);
    }
  });

  it("place le lien de réinitialisation de Better Auth et une clé qui ne contient pas le jeton", () => {
    const url = "https://app.example.test/api/auth/reset-password/jeton-unique?callbackURL=%2Freset-password";
    const message = renderPasswordResetEmail({ locale: "fr", to: "awa@qadr.test", url, token: "jeton-unique" });
    expect(message.actionUrl).toBe(url);
    expect(message.text).toContain(url);
    expect(message.html).toContain(url.replace(/&/g, "&amp;"));
    expect(message.text).toContain("valable 1 heure");
    expect(message.idempotencyKey).not.toContain("jeton-unique");
    expect(renderPasswordResetEmail({ locale: "fr", to: "awa@qadr.test", url, token: "autre-jeton" }).idempotencyKey).not.toBe(message.idempotencyKey);
  });

  it("rédige l’e-mail de vérification dans la langue demandée", () => {
    const message = renderVerificationEmail({ locale: "en", to: "awa@qadr.test", url: "https://app.example.test/api/auth/verify-email?token=x", token: "x" });
    expect(message).toMatchObject({ kind: "email_verification", subject: "Confirm your QADR OPS email address" });
    expect(message.idempotencyKey.startsWith("email-verification/")).toBe(true);
  });
});
