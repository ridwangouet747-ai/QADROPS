// Génère une paire de clés VAPID (P-256) pour les notifications push. À exécuter une fois, puis copier les
// valeurs dans les variables d'environnement du serveur. La clé privée ne doit jamais être commitée.
import { createECDH } from "node:crypto";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
console.log(`VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString("base64url")}`);
console.log(`VAPID_PRIVATE_KEY=${ecdh.getPrivateKey().toString("base64url")}`);
console.log("VAPID_SUBJECT=mailto:votre-adresse@exemple.com");
