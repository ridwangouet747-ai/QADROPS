import { intlLocale, localeDirection, type Locale } from "@/lib/i18n/config";
import { dictionaries } from "@/lib/i18n/translate";
import { idempotencyKeyFrom, type EmailMessage } from "./email";
import { emailMessages } from "./email-messages";

/*
 * Modèles HTML + texte brut des e-mails d'authentification. Mise en page en tableaux et styles en
 * ligne (seule forme fiable dans les messageries), polices système, aucune image ni ressource
 * externe : tout le contenu essentiel reste lisible si les images sont bloquées. L'arabe reçoit
 * lang="ar" et dir="rtl" au niveau du document ; les noms propres sont isolés (<bdi>).
 */

const font = "-apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Noto Sans Arabic', Tahoma, Arial, sans-serif";
const colors = { canvas: "#f3f2fb", night: "#1b1a2e", brand: "#5b4df2", link: "#4338ca", ink: "#1b1a2e", muted: "#4a4867", subtle: "#6b6987", paper: "#f3f2fb" };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** Nom saisi par un utilisateur : sans caractère de contrôle (injection d'en-tête), raccourci. */
function cleanName(value: string, max = 60) {
  const flat = [...value].filter((char) => char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) !== 0x7f).join("").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

type Values = Record<string, string>;
const fill = (template: string, values: Values, wrap: (value: string) => string) =>
  template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? wrap(values[name]!) : match));

/** Variables dans le HTML : échappées et isolées pour le texte bidirectionnel. */
const html = (template: string, values: Values = {}) => fill(escapeHtml(template), values, (value) => `<bdi>${escapeHtml(value)}</bdi>`);
/** Variables dans le texte brut : isolées (FSI … PDI) seulement en arabe. */
const plain = (locale: Locale, template: string, values: Values = {}) =>
  fill(template, values, (value) => (locale === "ar" ? `⁨${value}⁩` : value));

export function formatEmailDate(value: Date, locale: Locale) {
  const formatted = new Intl.DateTimeFormat(intlLocale[locale], { dateStyle: "long", timeStyle: "short", timeZone: "Africa/Abidjan" }).format(value);
  return `${formatted} (${emailMessages[locale].timeZone})`;
}

type Layout = {
  locale: Locale; subject: string; preheader: string; heading: string; intro: string;
  details?: { label: string; value: string }[]; action: { label: string; url: string }; notes: string[];
};

function renderHtml(layout: Layout) {
  const { locale } = layout;
  const dir = localeDirection[locale];
  const start = dir === "rtl" ? "right" : "left";
  const m = emailMessages[locale];
  const url = escapeHtml(layout.action.url);
  const details = layout.details?.length ? `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:${colors.paper};border-radius:14px;">
              ${layout.details.map((row) => `<tr><td style="padding:12px 16px;font-size:13px;color:${colors.subtle};text-align:${start};">${row.label}</td><td style="padding:12px 16px;font-size:15px;font-weight:700;color:${colors.ink};text-align:${start === "left" ? "right" : "left"};">${row.value}</td></tr>`).join("")}
            </table>` : "";
  return `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(layout.subject)}</title>
<style>@media (max-width: 600px) { .qadr-card { padding: 24px 20px !important; } .qadr-btn a { display: block !important; text-align: center !important; } }</style>
</head>
<body dir="${dir}" style="margin:0;padding:0;background:${colors.canvas};font-family:${font};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${layout.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="background:${colors.canvas};">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
        <tr>
          <td style="background:${colors.night};border-radius:20px 20px 0 0;padding:20px 28px;text-align:${start};">
            <table role="presentation" cellpadding="0" cellspacing="0" dir="ltr" style="display:inline-table;"><tr>
              <td style="width:36px;height:36px;background:${colors.brand};border-radius:11px;text-align:center;font:800 18px/36px ${font};color:#ffffff;">Q</td>
              <td style="padding-left:10px;font:800 18px ${font};letter-spacing:-0.02em;color:#ffffff;">QADR OPS</td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td class="qadr-card" style="background:#ffffff;border-radius:0 0 20px 20px;padding:32px 28px;text-align:${start};color:${colors.ink};">
            <h1 style="margin:0 0 12px;font-size:24px;line-height:1.3;font-weight:800;color:${colors.ink};">${layout.heading}</h1>
            <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:${colors.muted};">${layout.intro}</p>${details}
            <table role="presentation" cellpadding="0" cellspacing="0" class="qadr-btn" style="margin:0 0 24px;">
              <tr><td style="background:${colors.brand};border-radius:999px;"><a href="${url}" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">${layout.action.label}</a></td></tr>
            </table>
            ${layout.notes.map((note) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:${colors.muted};">${note}</p>`).join("\n            ")}
            <p style="margin:20px 0 6px;font-size:13px;color:${colors.subtle};">${escapeHtml(m.linkFallback)}</p>
            <p dir="ltr" style="margin:0;font-size:13px;line-height:1.5;word-break:break-all;text-align:left;"><a href="${url}" style="color:${colors.link};">${url}</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 28px;font-size:12px;line-height:1.6;color:${colors.subtle};text-align:center;">${escapeHtml(m.footer)}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function renderText(locale: Locale, layout: { heading: string; intro: string; details?: { label: string; value: string }[]; action: { label: string; url: string }; notes: string[] }, footer: string) {
  // Typographie française : espace avant les deux-points.
  const colon = locale === "fr" ? " :" : ":";
  return [
    "QADR OPS", "",
    layout.heading, "",
    layout.intro, "",
    ...(layout.details?.length ? [...layout.details.map((row) => `${row.label}${colon} ${row.value}`), ""] : []),
    `${layout.action.label}${colon}`, layout.action.url, "",
    ...layout.notes.flatMap((note) => [note, ""]),
    "—", footer,
  ].join("\n");
}

const roleName = (locale: Locale, role: string) =>
  (dictionaries[locale].roles as Record<string, unknown>)[role] as string | undefined ?? role;

export function renderInvitationEmail(input: {
  locale: Locale; to: string; invitationId: string; businessName: string; inviterName: string; role: string; expiresAt: Date; baseURL: string;
}): EmailMessage {
  const { locale } = input;
  const m = emailMessages[locale].invitation;
  const values = { business: cleanName(input.businessName, 80), inviter: cleanName(input.inviterName), email: input.to };
  const actionUrl = `${input.baseURL.replace(/\/$/, "")}/invitations/${encodeURIComponent(input.invitationId)}`;
  const role = roleName(locale, input.role);
  const expires = formatEmailDate(input.expiresAt, locale);
  const subject = cleanName(plain(locale, m.subject, values), 160);
  return {
    kind: "invitation", locale, to: input.to, subject, actionUrl,
    // Better Auth renouvelle une invitation existante en gardant son identifiant : l'échéance distingue chaque envoi voulu.
    idempotencyKey: `invitation/${input.invitationId}/${input.expiresAt.getTime()}`,
    html: renderHtml({
      locale, subject, preheader: html(m.preheader, values), heading: html(m.heading, values), intro: html(m.intro, values),
      details: [{ label: escapeHtml(m.role), value: escapeHtml(role) }, { label: escapeHtml(m.expires), value: `<bdi>${escapeHtml(expires)}</bdi>` }],
      action: { label: escapeHtml(m.action), url: actionUrl }, notes: [html(m.note, values)],
    }),
    text: renderText(locale, {
      heading: plain(locale, m.heading, values), intro: plain(locale, m.intro, values),
      details: [{ label: m.role, value: role }, { label: m.expires, value: expires }],
      action: { label: m.action, url: actionUrl }, notes: [plain(locale, m.note, values)],
    }, emailMessages[locale].footer),
  };
}

function renderTokenEmail(kind: "password_reset" | "email_verification", input: { locale: Locale; to: string; url: string; token: string }): EmailMessage {
  const { locale } = input;
  const reset = emailMessages[locale].passwordReset;
  const m = kind === "password_reset" ? reset : emailMessages[locale].verification;
  const notes: string[] = kind === "password_reset" ? [reset.expiry, reset.ignore] : [m.expiry];
  return {
    kind, locale, to: input.to, subject: m.subject, actionUrl: input.url,
    // Chaque demande produit un nouveau jeton, donc une nouvelle clé ; les réessais d'une même demande gardent la leur.
    idempotencyKey: idempotencyKeyFrom(kind === "password_reset" ? "password-reset" : "email-verification", input.token),
    html: renderHtml({
      locale, subject: m.subject, preheader: escapeHtml(m.preheader), heading: escapeHtml(m.heading), intro: escapeHtml(m.intro),
      action: { label: escapeHtml(m.action), url: input.url }, notes: notes.map(escapeHtml),
    }),
    text: renderText(locale, { heading: m.heading, intro: m.intro, action: { label: m.action, url: input.url }, notes }, emailMessages[locale].footer),
  };
}

export const renderPasswordResetEmail = (input: { locale: Locale; to: string; url: string; token: string }) => renderTokenEmail("password_reset", input);
export const renderVerificationEmail = (input: { locale: Locale; to: string; url: string; token: string }) => renderTokenEmail("email_verification", input);
