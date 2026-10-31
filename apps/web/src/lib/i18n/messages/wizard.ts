/** Textes du parcours d'inscription en cinq étapes (mission 08), exposés sous la clé `wizard`. */
export const wizardFr = {
  tagline: "Créez votre espace en cinq étapes",
  progress: "Étape {current} sur {total}",
  short: { account: "Compte", identity: "Commerce", details: "Coordonnées", branding: "Identité", review: "Vérification" },
  steps: {
    account: { title: "Créez votre compte", description: "Votre accès personnel à Qadr Ops. Vous inviterez votre équipe ensuite." },
    identity: { title: "Votre commerce", description: "Son nom et ce que vous vendez : votre boutique prend forme." },
    details: { title: "Où vous trouver", description: "Facultatif, utile sur vos reçus. Vous pourrez compléter plus tard." },
    branding: { title: "Votre image", description: "Votre logo et le nom affiché sur vos reçus et documents." },
    review: { title: "Tout est prêt ?", description: "Vérifiez avant de créer votre commerce. Tout reste modifiable." },
  },
  fields: {
    name: "Votre nom", email: "Adresse e-mail", password: "Mot de passe", confirm: "Confirmez le mot de passe", passwordHint: "Au moins 8 caractères.",
    businessName: "Nom du commerce", businessNamePlaceholder: "Ex. : Quincaillerie du Plateau", activity: "Votre activité", storeFormat: "Type de commerce",
    phone: "Téléphone", phonePlaceholder: "+225 07 00 00 00 00", address: "Adresse ou quartier", addressPlaceholder: "Ex. : Adjamé, près du marché",
    logo: "Logo", logoHint: "PNG, JPEG ou WebP. Il apparaîtra sur vos reçus.", chooseLogo: "Choisir une image", removeLogo: "Retirer le logo",
    displayName: "Nom sur les documents", displayNameHint: "Laissez vide pour reprendre le nom du commerce.", optional: "facultatif",
  },
  activities: { hardware: "Quincaillerie", phones: "Téléphonie", general: "Boutique générale", clothing: "Vêtements" },
  activityHints: { hardware: "Matériaux, outils, ciment", phones: "Téléphones et accessoires", general: "Produits du quotidien", clothing: "Habits, chaussures, tissus" },
  formats: { shop: "Boutique", kiosk: "Kiosque ou étal", wholesale: "Dépôt ou grossiste", other: "Autre" },
  actions: {
    back: "Retour", next: "Continuer", createAccount: "Créer mon compte", creatingAccount: "Création du compte…", create: "Créer mon commerce", creating: "Création…",
    edit: "Modifier", goDashboard: "Ouvrir mon tableau de bord", login: "Déjà un compte ?", loginLink: "Se connecter", signedInAs: "Connecté : {email}",
  },
  review: { account: "Compte", business: "Commerce", contact: "Coordonnées", branding: "Identité visuelle", none: "Non renseigné", currency: "Montants en francs CFA (XOF)", logoAlt: "Aperçu du logo" },
  errors: {
    nameShort: "Indiquez au moins 2 caractères.", email: "Adresse e-mail invalide.", passwordShort: "Au moins 8 caractères.",
    passwordMismatch: "Les deux mots de passe sont différents.", businessName: "Indiquez le nom du commerce (2 caractères minimum).",
    activity: "Choisissez une activité.", storeFormat: "Choisissez le type de commerce.", phone: "Numéro de téléphone invalide.", address: "Adresse trop longue.",
    logoType: "Format non pris en charge : PNG, JPEG ou WebP.", logoSize: "Image trop lourde, choisissez-en une plus petite.", displayName: "Nom trop long (80 caractères maximum).",
    accountFailed: "Le compte n’a pas pu être créé. Cette adresse est peut-être déjà utilisée.",
    createFailed: "Le commerce n’a pas pu être créé. Vos informations sont conservées : réessayez.",
    network: "Pas de connexion. Vos informations sont conservées : réessayez dès que le réseau revient.",
    summary: "Corrigez les champs signalés pour continuer.",
  },
  welcome: { title: "Bienvenue dans Qadr Ops", body: "{business} est ouvert. Votre tableau de bord vous attend.", redirecting: "Ouverture du tableau de bord…" },
  scene: {
    label: "Illustration décorative : votre boutique se construit au fil des étapes.", loading: "Préparation de l’illustration…",
    captions: { account: "Les fondations sont posées", identity: "La façade prend forme", details: "L’intérieur s’installe", branding: "Votre enseigne s’affiche", review: "Votre boutique est prête", welcome: "C’est ouvert !" },
  },
  restored: "Nous avons repris votre saisie là où vous l’aviez laissée.",
};

type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };
export type WizardMessages = Shape<typeof wizardFr>;

export const wizardEn: WizardMessages = {
  tagline: "Set up your space in five steps",
  progress: "Step {current} of {total}",
  short: { account: "Account", identity: "Business", details: "Contact", branding: "Branding", review: "Review" },
  steps: {
    account: { title: "Create your account", description: "Your personal access to Qadr Ops. You will invite your team afterwards." },
    identity: { title: "Your business", description: "Its name and what you sell: your shop takes shape." },
    details: { title: "Where to find you", description: "Optional, useful on your receipts. You can complete it later." },
    branding: { title: "Your brand", description: "Your logo and the name shown on receipts and documents." },
    review: { title: "All set?", description: "Check before creating your business. Everything stays editable." },
  },
  fields: {
    name: "Your name", email: "Email address", password: "Password", confirm: "Confirm password", passwordHint: "At least 8 characters.",
    businessName: "Business name", businessNamePlaceholder: "E.g. Plateau Hardware", activity: "Your activity", storeFormat: "Type of business",
    phone: "Phone", phonePlaceholder: "+225 07 00 00 00 00", address: "Address or area", addressPlaceholder: "E.g. Adjamé, near the market",
    logo: "Logo", logoHint: "PNG, JPEG or WebP. It will appear on your receipts.", chooseLogo: "Choose an image", removeLogo: "Remove logo",
    displayName: "Name on documents", displayNameHint: "Leave empty to use the business name.", optional: "optional",
  },
  activities: { hardware: "Hardware store", phones: "Phones", general: "General store", clothing: "Clothing" },
  activityHints: { hardware: "Materials, tools, cement", phones: "Phones and accessories", general: "Everyday products", clothing: "Clothes, shoes, fabrics" },
  formats: { shop: "Shop", kiosk: "Kiosk or stall", wholesale: "Depot or wholesaler", other: "Other" },
  actions: {
    back: "Back", next: "Continue", createAccount: "Create my account", creatingAccount: "Creating account…", create: "Create my business", creating: "Creating…",
    edit: "Edit", goDashboard: "Open my dashboard", login: "Already have an account?", loginLink: "Sign in", signedInAs: "Signed in: {email}",
  },
  review: { account: "Account", business: "Business", contact: "Contact", branding: "Branding", none: "Not provided", currency: "Amounts in CFA francs (XOF)", logoAlt: "Logo preview" },
  errors: {
    nameShort: "Enter at least 2 characters.", email: "Invalid email address.", passwordShort: "At least 8 characters.",
    passwordMismatch: "The two passwords do not match.", businessName: "Enter the business name (at least 2 characters).",
    activity: "Choose an activity.", storeFormat: "Choose the type of business.", phone: "Invalid phone number.", address: "Address too long.",
    logoType: "Unsupported format: PNG, JPEG or WebP.", logoSize: "Image too heavy, choose a smaller one.", displayName: "Name too long (80 characters max).",
    accountFailed: "The account could not be created. This address may already be in use.",
    createFailed: "The business could not be created. Your details are kept: try again.",
    network: "No connection. Your details are kept: try again when the network is back.",
    summary: "Fix the highlighted fields to continue.",
  },
  welcome: { title: "Welcome to Qadr Ops", body: "{business} is open. Your dashboard is waiting.", redirecting: "Opening your dashboard…" },
  scene: {
    label: "Decorative illustration: your shop is built step by step.", loading: "Preparing the illustration…",
    captions: { account: "The foundations are laid", identity: "The storefront takes shape", details: "The interior settles in", branding: "Your sign lights up", review: "Your shop is ready", welcome: "We're open!" },
  },
  restored: "We picked up where you left off.",
};

export const wizardAr: WizardMessages = {
  tagline: "أنشئ مساحتك في خمس خطوات",
  progress: "الخطوة {current} من {total}",
  short: { account: "الحساب", identity: "المتجر", details: "العنوان", branding: "الهوية", review: "المراجعة" },
  steps: {
    account: { title: "أنشئ حسابك", description: "وصولك الشخصي إلى Qadr Ops. ستدعو فريقك لاحقاً." },
    identity: { title: "متجرك", description: "اسمه وما تبيعه: متجرك يتشكّل الآن." },
    details: { title: "أين نجدك", description: "اختياري ومفيد على إيصالاتك. يمكنك الإكمال لاحقاً." },
    branding: { title: "هويتك", description: "شعارك والاسم الظاهر على الإيصالات والمستندات." },
    review: { title: "هل كل شيء جاهز؟", description: "راجع قبل إنشاء متجرك. يبقى كل شيء قابلاً للتعديل." },
  },
  fields: {
    name: "اسمك", email: "البريد الإلكتروني", password: "كلمة المرور", confirm: "تأكيد كلمة المرور", passwordHint: "8 أحرف على الأقل.",
    businessName: "اسم المتجر", businessNamePlaceholder: "مثال: خردوات بلاتو", activity: "نشاطك", storeFormat: "نوع المتجر",
    phone: "الهاتف", phonePlaceholder: "+225 07 00 00 00 00", address: "العنوان أو الحي", addressPlaceholder: "مثال: أدجامي، قرب السوق",
    logo: "الشعار", logoHint: "PNG أو JPEG أو WebP. سيظهر على إيصالاتك.", chooseLogo: "اختيار صورة", removeLogo: "إزالة الشعار",
    displayName: "الاسم على المستندات", displayNameHint: "اتركه فارغاً لاستخدام اسم المتجر.", optional: "اختياري",
  },
  activities: { hardware: "خردوات ومواد بناء", phones: "هواتف", general: "متجر عام", clothing: "ملابس" },
  activityHints: { hardware: "مواد وأدوات وإسمنت", phones: "هواتف وإكسسوارات", general: "منتجات يومية", clothing: "ملابس وأحذية وأقمشة" },
  formats: { shop: "متجر", kiosk: "كشك أو بسطة", wholesale: "مستودع أو بيع بالجملة", other: "أخرى" },
  actions: {
    back: "رجوع", next: "متابعة", createAccount: "إنشاء حسابي", creatingAccount: "جارٍ إنشاء الحساب…", create: "إنشاء متجري", creating: "جارٍ الإنشاء…",
    edit: "تعديل", goDashboard: "فتح لوحة التحكم", login: "لديك حساب بالفعل؟", loginLink: "تسجيل الدخول", signedInAs: "متصل: {email}",
  },
  review: { account: "الحساب", business: "المتجر", contact: "العنوان", branding: "الهوية البصرية", none: "غير محدد", currency: "المبالغ بالفرنك الإفريقي (XOF)", logoAlt: "معاينة الشعار" },
  errors: {
    nameShort: "أدخل حرفين على الأقل.", email: "بريد إلكتروني غير صالح.", passwordShort: "8 أحرف على الأقل.",
    passwordMismatch: "كلمتا المرور غير متطابقتين.", businessName: "أدخل اسم المتجر (حرفان على الأقل).",
    activity: "اختر نشاطاً.", storeFormat: "اختر نوع المتجر.", phone: "رقم هاتف غير صالح.", address: "العنوان طويل جداً.",
    logoType: "صيغة غير مدعومة: PNG أو JPEG أو WebP.", logoSize: "الصورة كبيرة جداً، اختر صورة أصغر.", displayName: "الاسم طويل جداً (80 حرفاً كحد أقصى).",
    accountFailed: "تعذّر إنشاء الحساب. ربما هذا العنوان مستخدم بالفعل.",
    createFailed: "تعذّر إنشاء المتجر. بياناتك محفوظة: أعد المحاولة.",
    network: "لا يوجد اتصال. بياناتك محفوظة: أعد المحاولة عند عودة الشبكة.",
    summary: "صحّح الحقول المشار إليها للمتابعة.",
  },
  welcome: { title: "مرحباً بك في Qadr Ops", body: "{business} مفتوح الآن. لوحة التحكم بانتظارك.", redirecting: "جارٍ فتح لوحة التحكم…" },
  scene: {
    label: "رسم توضيحي زخرفي: متجرك يُبنى خطوة بخطوة.", loading: "جارٍ تحضير الرسم…",
    captions: { account: "وُضعت الأساسات", identity: "الواجهة تتشكّل", details: "الداخل يتجهّز", branding: "لافتتك تظهر", review: "متجرك جاهز", welcome: "نحن مفتوحون!" },
  },
  restored: "استأنفنا إدخالك من حيث توقفت.",
};
