import type { Locale } from "@/lib/i18n/config";

/**
 * Textes des e-mails d'authentification. Les variables entre accolades ({business}, {inviter}…)
 * reçoivent des noms de commerces et de personnes, jamais traduits.
 */
const fr = {
  footer: "Vous recevez cet e-mail car une action a été demandée sur QADR OPS. Si vous n’êtes pas à l’origine de cette demande, ignorez simplement ce message.",
  linkFallback: "Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :",
  timeZone: "heure d’Abidjan",
  invitation: {
    subject: "{inviter} vous invite à rejoindre {business} sur QADR OPS",
    preheader: "Rejoignez l’équipe de {business} sur QADR OPS.",
    heading: "Rejoignez l’équipe de {business}",
    intro: "{inviter} vous invite à rejoindre l’équipe de {business} sur QADR OPS, l’outil de gestion du commerce.",
    role: "Rôle proposé",
    expires: "Valable jusqu’au",
    action: "Accepter l’invitation",
    note: "Pour accepter, connectez-vous ou créez un compte avec cette adresse : {email}. Le lien ne fonctionne pas avec une autre adresse.",
  },
  passwordReset: {
    subject: "Réinitialisez votre mot de passe QADR OPS",
    preheader: "Choisissez un nouveau mot de passe pour votre compte.",
    heading: "Nouveau mot de passe",
    intro: "Nous avons reçu une demande de réinitialisation du mot de passe de votre compte QADR OPS.",
    action: "Choisir un nouveau mot de passe",
    expiry: "Ce lien est valable 1 heure et ne sert qu’une seule fois. Vos autres sessions seront fermées.",
    ignore: "Si vous n’avez rien demandé, ignorez cet e-mail : votre mot de passe actuel reste inchangé.",
  },
  verification: {
    subject: "Confirmez votre adresse e-mail QADR OPS",
    preheader: "Un clic pour confirmer votre adresse.",
    heading: "Confirmez votre adresse e-mail",
    intro: "Confirmez que cette adresse vous appartient pour sécuriser votre compte QADR OPS.",
    action: "Confirmer mon adresse",
    expiry: "Ce lien est valable 24 heures.",
  },
};

export type EmailMessages = typeof fr;

const en: EmailMessages = {
  footer: "You are receiving this email because an action was requested on QADR OPS. If you did not make this request, simply ignore this message.",
  linkFallback: "If the button does not work, copy this link into your browser:",
  timeZone: "Abidjan time",
  invitation: {
    subject: "{inviter} invited you to join {business} on QADR OPS",
    preheader: "Join the {business} team on QADR OPS.",
    heading: "Join the {business} team",
    intro: "{inviter} invited you to join the {business} team on QADR OPS, the shop management tool.",
    role: "Proposed role",
    expires: "Valid until",
    action: "Accept invitation",
    note: "To accept, sign in or create an account with this address: {email}. The link does not work with another address.",
  },
  passwordReset: {
    subject: "Reset your QADR OPS password",
    preheader: "Choose a new password for your account.",
    heading: "New password",
    intro: "We received a request to reset the password of your QADR OPS account.",
    action: "Choose a new password",
    expiry: "This link is valid for 1 hour and can be used only once. Your other sessions will be signed out.",
    ignore: "If you did not ask for this, ignore this email: your current password stays the same.",
  },
  verification: {
    subject: "Confirm your QADR OPS email address",
    preheader: "One click to confirm your address.",
    heading: "Confirm your email address",
    intro: "Confirm that this address belongs to you to secure your QADR OPS account.",
    action: "Confirm my address",
    expiry: "This link is valid for 24 hours.",
  },
};

const ar: EmailMessages = {
  footer: "تتلقى هذه الرسالة لأن إجراءً طُلب على QADR OPS. إذا لم تكن أنت من قام بهذا الطلب، فتجاهل هذه الرسالة ببساطة.",
  linkFallback: "إذا لم يعمل الزر، انسخ هذا الرابط في متصفحك:",
  timeZone: "بتوقيت أبيدجان",
  invitation: {
    subject: "{inviter} يدعوك للانضمام إلى {business} على QADR OPS",
    preheader: "انضم إلى فريق {business} على QADR OPS.",
    heading: "انضم إلى فريق {business}",
    intro: "{inviter} يدعوك للانضمام إلى فريق {business} على QADR OPS، أداة إدارة المتجر.",
    role: "الدور المقترح",
    expires: "صالحة حتى",
    action: "قبول الدعوة",
    note: "للقبول، سجّل الدخول أو أنشئ حساباً بهذا العنوان: {email}. لا يعمل الرابط مع عنوان آخر.",
  },
  passwordReset: {
    subject: "أعد تعيين كلمة مرور QADR OPS",
    preheader: "اختر كلمة مرور جديدة لحسابك.",
    heading: "كلمة مرور جديدة",
    intro: "تلقينا طلباً لإعادة تعيين كلمة مرور حسابك على QADR OPS.",
    action: "اختيار كلمة مرور جديدة",
    expiry: "هذا الرابط صالح لمدة ساعة واحدة ولا يُستخدم إلا مرة واحدة. سيتم إغلاق جلساتك الأخرى.",
    ignore: "إذا لم تطلب ذلك، فتجاهل هذه الرسالة: تبقى كلمة مرورك الحالية كما هي.",
  },
  verification: {
    subject: "أكّد عنوان بريدك الإلكتروني على QADR OPS",
    preheader: "نقرة واحدة لتأكيد عنوانك.",
    heading: "أكّد عنوان بريدك الإلكتروني",
    intro: "أكّد أن هذا العنوان يخصك لتأمين حسابك على QADR OPS.",
    action: "تأكيد عنواني",
    expiry: "هذا الرابط صالح لمدة 24 ساعة.",
  },
};

export const emailMessages: Record<Locale, EmailMessages> = { fr, en, ar };
