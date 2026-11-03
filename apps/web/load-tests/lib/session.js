/* global __ENV */
import http from "k6/http";
import { assertPreproductionTarget } from "./target.js";

/*
 * Connexion commune aux scripts k6 : variables lues dans l'environnement (`-e NOM=valeur`), jamais
 * écrites dans le dépôt. Le compte doit être un compte de TEST de la préproduction (voir README).
 */

export const BASE_URL = assertPreproductionTarget(__ENV.QADR_LOAD_BASE_URL);

export function requiredEnv(name) {
  const value = __ENV[name];
  if (!value) throw new Error(`Variable ${name} manquante (voir load-tests/README.md).`);
  return value;
}

function cookieHeader(response) {
  return Object.entries(response.cookies)
    .map(([name, values]) => (values.length && values[0].value ? `${name}=${values[0].value}` : null))
    .filter(Boolean).join("; ");
}

/**
 * Connexion Better Auth puis sélection du commerce de test ; renvoie l'en-tête Cookie à partager entre
 * les utilisateurs virtuels (une seule connexion : la route de connexion est limitée en débit).
 */
export function openSession() {
  const headers = { "content-type": "application/json", origin: BASE_URL };
  // Turnstile : en préproduction avec les clés de test Cloudflare, le jeton factice est accepté.
  if (__ENV.QADR_LOAD_TURNSTILE_TOKEN) headers["x-turnstile-token"] = __ENV.QADR_LOAD_TURNSTILE_TOKEN;
  const login = http.post(`${BASE_URL}/api/auth/sign-in/email`, JSON.stringify({
    email: requiredEnv("QADR_LOAD_EMAIL"), password: requiredEnv("QADR_LOAD_PASSWORD"),
  }), { headers, tags: { name: "auth.sign-in" } });
  if (login.status !== 200) throw new Error(`Connexion refusée (${login.status}) : vérifiez le compte de test et Turnstile.`);
  const cookie = cookieHeader(login);
  const select = http.post(`${BASE_URL}/api/account/active-business`, JSON.stringify({ businessId: requiredEnv("QADR_LOAD_BUSINESS_ID") }),
    { headers: { "content-type": "application/json", origin: BASE_URL, cookie }, tags: { name: "account.active-business" } });
  if (select.status !== 200) throw new Error(`Sélection du commerce refusée (${select.status}).`);
  return { cookie };
}

export function authHeaders(session, json = false) {
  const headers = { origin: BASE_URL, cookie: session.cookie };
  if (json) headers["content-type"] = "application/json";
  return headers;
}
