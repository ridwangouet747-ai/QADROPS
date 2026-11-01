/** Application installable, état du réseau et invitation à installer (mission 11, phase 2). */
export const pwaFr = {
  network: {
    saleUnknown: "Pas de réponse du serveur : nous ne savons pas si la vente est enregistrée. Vérifiez la connexion, puis appuyez de nouveau sur « Encaisser » : la même vente ne sera jamais enregistrée deux fois.",
    requestFailed: "Pas de réponse du serveur. Vérifiez la connexion, puis réessayez.",
  },
  invite: {
    title: "Installez QADR OPS sur cet appareil",
    body: "Une icône sur l’écran d’accueil, l’ouverture en plein écran et les notifications. Aucun magasin d’applications.",
    install: "Installer",
    howTo: "Voir comment",
    later: "Plus tard",
  },
  page: {
    kicker: "APPLICATION",
    title: "Installer l’application",
    intro: "QADR OPS s’installe directement depuis le navigateur, sur téléphone comme sur ordinateur. C’est la même application, avec les mêmes données.",
    installed: "QADR OPS est installée sur cet appareil.",
    installedHint: "Ouvrez-la depuis l’icône de l’écran d’accueil ou du bureau.",
    installButton: "Installer maintenant",
    accepted: "Installation lancée. L’icône apparaît dans quelques secondes.",
    dismissed: "Installation annulée. Vous pouvez recommencer à tout moment.",
    noPrompt: "Votre navigateur ne propose pas de bouton direct : suivez les étapes ci-dessous.",
    platformLabel: "Votre appareil",
    platforms: { android: "Android", ios: "iPhone / iPad", desktop: "Ordinateur" },
    steps: {
      android: { one: "Ouvrez QADR OPS dans Chrome.", two: "Appuyez sur le menu ⋮ en haut à droite.", three: "Choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil », puis confirmez." },
      ios: { one: "Ouvrez QADR OPS dans Safari.", two: "Appuyez sur le bouton Partager (carré avec une flèche vers le haut).", three: "Choisissez « Sur l’écran d’accueil », puis « Ajouter »." },
      desktop: { one: "Ouvrez QADR OPS dans Chrome ou Edge.", two: "Cliquez sur l’icône d’installation à droite de la barre d’adresse (ou menu ⋮ › « Installer QADR OPS »).", three: "Confirmez : QADR OPS s’ouvre dans sa propre fenêtre." },
    },
    otherBrowser: "Ouvert depuis WhatsApp, Facebook ou un autre réseau social ? Ouvrez d’abord le lien dans Chrome (Android) ou Safari (iPhone).",
    benefitsTitle: "Ce que l’installation change",
    benefits: {
      fast: "Ouverture en un geste, en plein écran, sans barre d’adresse.",
      updates: "Les mises à jour arrivent seules : rien à télécharger.",
      notifications: "Les notifications de l’appareil deviennent possibles (sur iPhone, seulement une fois installée).",
      offline: "Sans Internet, rien ne peut être enregistré : une page vous le dit clairement, et aucune vente n’est annoncée comme enregistrée sans la réponse du serveur.",
    },
    notificationsLink: "Régler les notifications",
  },
};

export const pwaEn: typeof pwaFr = {
  network: {
    saleUnknown: "No answer from the server: we do not know whether the sale was saved. Check the connection, then press “Take” again: the same sale will never be saved twice.",
    requestFailed: "No answer from the server. Check the connection, then try again.",
  },
  invite: {
    title: "Install QADR OPS on this device",
    body: "An icon on your home screen, full-screen opening and notifications. No app store.",
    install: "Install",
    howTo: "Show me how",
    later: "Later",
  },
  page: {
    kicker: "APP",
    title: "Install the app",
    intro: "QADR OPS installs straight from the browser, on phones and computers. Same app, same data.",
    installed: "QADR OPS is installed on this device.",
    installedHint: "Open it from the icon on your home screen or desktop.",
    installButton: "Install now",
    accepted: "Installing. The icon will appear in a few seconds.",
    dismissed: "Installation cancelled. You can start again at any time.",
    noPrompt: "Your browser has no direct install button: follow the steps below.",
    platformLabel: "Your device",
    platforms: { android: "Android", ios: "iPhone / iPad", desktop: "Computer" },
    steps: {
      android: { one: "Open QADR OPS in Chrome.", two: "Tap the ⋮ menu at the top right.", three: "Choose “Install app” or “Add to Home screen”, then confirm." },
      ios: { one: "Open QADR OPS in Safari.", two: "Tap the Share button (square with an upward arrow).", three: "Choose “Add to Home Screen”, then “Add”." },
      desktop: { one: "Open QADR OPS in Chrome or Edge.", two: "Click the install icon at the right of the address bar (or ⋮ menu › “Install QADR OPS”).", three: "Confirm: QADR OPS opens in its own window." },
    },
    otherBrowser: "Opened from WhatsApp, Facebook or another social app? First open the link in Chrome (Android) or Safari (iPhone).",
    benefitsTitle: "What installing changes",
    benefits: {
      fast: "Opens in one tap, full screen, without an address bar.",
      updates: "Updates arrive by themselves: nothing to download.",
      notifications: "Device notifications become possible (on iPhone, only once installed).",
      offline: "Without the internet nothing can be saved: a page says so clearly, and no sale is shown as saved without the server’s answer.",
    },
    notificationsLink: "Notification settings",
  },
};

export const pwaAr: typeof pwaFr = {
  network: {
    saleUnknown: "لا يوجد رد من الخادم: لا نعرف إن كان البيع قد سُجّل. تحقّق من الاتصال ثم اضغط «تحصيل» مرة أخرى: لن يُسجَّل البيع نفسه مرتين أبدًا.",
    requestFailed: "لا يوجد رد من الخادم. تحقّق من الاتصال ثم أعد المحاولة.",
  },
  invite: {
    title: "ثبّت QADR OPS على هذا الجهاز",
    body: "أيقونة على الشاشة الرئيسية، وفتح بملء الشاشة، وإشعارات. دون متجر تطبيقات.",
    install: "تثبيت",
    howTo: "اعرض الطريقة",
    later: "لاحقًا",
  },
  page: {
    kicker: "التطبيق",
    title: "تثبيت التطبيق",
    intro: "يُثبَّت QADR OPS مباشرة من المتصفح، على الهاتف وعلى الحاسوب. إنه التطبيق نفسه بالبيانات نفسها.",
    installed: "QADR OPS مثبّت على هذا الجهاز.",
    installedHint: "افتحه من الأيقونة على الشاشة الرئيسية أو سطح المكتب.",
    installButton: "ثبّت الآن",
    accepted: "جارٍ التثبيت. ستظهر الأيقونة خلال ثوانٍ.",
    dismissed: "أُلغي التثبيت. يمكنك البدء من جديد في أي وقت.",
    noPrompt: "لا يوفّر متصفحك زر تثبيت مباشرًا: اتبع الخطوات أدناه.",
    platformLabel: "جهازك",
    platforms: { android: "أندرويد", ios: "آيفون / آيباد", desktop: "حاسوب" },
    steps: {
      android: { one: "افتح QADR OPS في Chrome.", two: "اضغط على القائمة ⋮ في الأعلى.", three: "اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية» ثم أكّد." },
      ios: { one: "افتح QADR OPS في Safari.", two: "اضغط على زر المشاركة (مربّع بسهم نحو الأعلى).", three: "اختر «إضافة إلى الشاشة الرئيسية» ثم «إضافة»." },
      desktop: { one: "افتح QADR OPS في Chrome أو Edge.", two: "انقر على أيقونة التثبيت بجانب شريط العنوان (أو القائمة ⋮ › «تثبيت QADR OPS»).", three: "أكّد: يفتح QADR OPS في نافذته الخاصة." },
    },
    otherBrowser: "فتحته من واتساب أو فيسبوك أو شبكة اجتماعية أخرى؟ افتح الرابط أولًا في Chrome (أندرويد) أو Safari (آيفون).",
    benefitsTitle: "ما الذي يغيّره التثبيت",
    benefits: {
      fast: "يُفتح بلمسة واحدة، بملء الشاشة، دون شريط عنوان.",
      updates: "تصل التحديثات تلقائيًا: لا شيء لتنزيله.",
      notifications: "تصبح إشعارات الجهاز ممكنة (على آيفون، بعد التثبيت فقط).",
      offline: "بدون إنترنت لا يمكن حفظ أي شيء: تخبرك صفحة بذلك بوضوح، ولا يُعرض أي بيع على أنه مسجّل دون رد الخادم.",
    },
    notificationsLink: "إعدادات الإشعارات",
  },
};
