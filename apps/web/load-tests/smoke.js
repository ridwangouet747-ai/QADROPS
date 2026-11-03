/* global __ENV */
import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL, authHeaders, openSession } from "./lib/session.js";

/*
 * Test de fumée (mission 11, phase 7) : 2 utilisateurs virtuels pendant 1 minute, lectures seules.
 * But : vérifier que la préproduction répond et que les seuils sont atteignables AVANT pos-peak.js.
 * Ne lancer que contre une préproduction (garde-fou dans lib/target.js) : voir README.md.
 */

export const options = {
  vus: Number(__ENV.QADR_LOAD_SMOKE_VUS ?? 2),
  duration: __ENV.QADR_LOAD_SMOKE_DURATION ?? "1m",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
    checks: ["rate>0.99"],
  },
};

export function setup() {
  return openSession();
}

export default function (session) {
  const headers = authHeaders(session);
  for (const [name, path] of [
    ["account.me", "/api/account/me"],
    ["products.page", "/api/business/products?limit=30"],
    ["dashboard", "/api/business/dashboard"],
    ["reports.daily", "/api/business/reports?period=daily"],
    ["stock.movements", "/api/business/stock/movements?limit=30"],
  ]) {
    const response = http.get(`${BASE_URL}${path}`, { headers, tags: { name } });
    check(response, { [`${name} : 200`]: (r) => r.status === 200 });
  }
  sleep(1);
}
