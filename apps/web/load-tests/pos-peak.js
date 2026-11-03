/* global __ENV, __VU, __ITER */
import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL, authHeaders, openSession } from "./lib/session.js";

/*
 * Pic de caisse (mission 11, phase 7) : montée progressive de 100 à 1 000 utilisateurs virtuels.
 * Chaque utilisateur virtuel joue un poste de caisse : recherche au catalogue, vente en espèces avec clé
 * d'idempotence (2 % de rejeux volontaires, qui doivent rendre la même vente), relecture de la vente.
 *
 * Par défaut, LECTURES SEULES. Les ventes ne partent que si QADR_LOAD_WRITE=true, sur un commerce de test
 * dont le stock a été préparé (voir README.md). Ne lancer que contre une préproduction (blocage B-1).
 */

const WRITE = __ENV.QADR_LOAD_WRITE === "true";
const MAX_VUS = Number(__ENV.QADR_LOAD_MAX_VUS ?? 1000);
const step = (fraction) => Math.max(1, Math.round(MAX_VUS * fraction));

export const options = {
  scenarios: {
    caisse: {
      executor: "ramping-vus",
      startVUs: 0,
      gracefulRampDown: "30s",
      stages: [
        { duration: "2m", target: step(0.1) }, // 100
        { duration: "3m", target: step(0.1) },
        { duration: "3m", target: step(0.25) }, // 250
        { duration: "3m", target: step(0.5) }, // 500
        { duration: "3m", target: step(1) }, // 1 000
        { duration: "5m", target: step(1) }, // palier au pic
        { duration: "2m", target: 0 },
      ],
    },
  },
  thresholds: {
    // Au-delà de 5 % d'erreurs, la campagne s'arrête d'elle-même : inutile de surcharger la préproduction.
    http_req_failed: [{ threshold: "rate<0.01", abortOnFail: false }, { threshold: "rate<0.05", abortOnFail: true, delayAbortEval: "1m" }],
    "http_req_duration{name:products.search}": ["p(95)<800"],
    "http_req_duration{name:sales.read}": ["p(95)<800"],
    "http_req_duration{name:sales.create}": ["p(95)<1500", "p(99)<3000"],
    checks: ["rate>0.99"],
  },
};

/** Articles vendables du commerce de test : identifiant de variante et prix, lus une fois. */
export function setup() {
  const session = openSession();
  const response = http.get(`${BASE_URL}/api/business/products?limit=100`, { headers: authHeaders(session), tags: { name: "products.setup" } });
  if (response.status !== 200) throw new Error(`Catalogue illisible (${response.status}).`);
  const minimum = Number(__ENV.QADR_LOAD_MIN_STOCK ?? 1000);
  const articles = response.json("items")
    .filter((item) => Number(item.onHand) >= minimum && /^[1-9]\d*$/.test(item.salePriceXof))
    .map((item) => ({ variantId: item.variantId, priceXof: item.salePriceXof, name: item.name }));
  if (WRITE && articles.length === 0) throw new Error(`Aucun article avec au moins ${minimum} en stock : préparez le commerce de test (README).`);
  return { session, articles };
}

export default function (data) {
  const headers = authHeaders(data.session);
  const article = data.articles.length ? data.articles[(__VU + __ITER) % data.articles.length] : null;
  const query = article ? encodeURIComponent(article.name.slice(0, 4)) : "a";
  const search = http.get(`${BASE_URL}/api/business/products?limit=30&q=${query}`, { headers, tags: { name: "products.search" } });
  check(search, { "recherche : 200": (r) => r.status === 200 });

  if (WRITE && article) {
    const body = JSON.stringify({
      idempotencyKey: `charge-${__VU}-${__ITER}-${Date.now()}`,
      lines: [{ variantId: article.variantId, quantity: "1" }],
      payments: [{ method: "cash", amountXof: article.priceXof }],
    });
    const jsonHeaders = authHeaders(data.session, true);
    const sale = http.post(`${BASE_URL}/api/business/sales`, body, { headers: jsonHeaders, tags: { name: "sales.create" } });
    const created = check(sale, {
      "vente : 201": (r) => r.status === 201,
      "vente : montant en chaîne entière": (r) => /^[1-9]\d*$/.test(r.json("sale.totalXof") ?? ""),
    });
    if (created && Math.random() < 0.02) {
      // Réseau perdu côté client : le même envoi doit rendre la même vente, jamais une seconde.
      const replay = http.post(`${BASE_URL}/api/business/sales`, body, { headers: jsonHeaders, tags: { name: "sales.replay" } });
      check(replay, {
        "rejeu : 200": (r) => r.status === 200,
        "rejeu : même vente": (r) => r.json("sale.id") === sale.json("sale.id") && r.json("sale.replayed") === true,
      });
    }
    if (created) {
      const read = http.get(`${BASE_URL}/api/business/sales/${sale.json("sale.id")}`, { headers, tags: { name: "sales.read" } });
      check(read, { "relecture : 200": (r) => r.status === 200 });
    }
  }
  sleep(1 + Math.random() * 2);
}
