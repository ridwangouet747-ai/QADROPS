const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { hashPassword, signSession } = require('../src/auth');

let server; let store; let base; let platformToken;
const headers = (token, extra = {}) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}`, ...extra });
async function call(route, options = {}) {
  const response = await fetch(`${base}${route}`, options); return { status: response.status, body: await response.json() };
}
async function register(name, email) {
  const response = await call('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ownerName: name, email, password: 'un-mot-de-passe-solide', businessName: `${name} Commerce`, sector: 'general_store', phone: '0700000000', address: 'Abidjan' }) });
  assert.equal(response.status, 201); return response.body;
}
async function createPromotion(input = {}) {
  const response = await call('/api/platform/promotions', { method: 'POST', headers: headers(platformToken), body: JSON.stringify({ campaignName: 'Campagne de test', type: 'trial', trialDays: 7, ...input }) });
  assert.equal(response.status, 201, response.body.error); return response.body.promotion;
}
async function activate(account, promotion) {
  const response = await call('/api/subscription/redeem', { method: 'POST', headers: headers(account.token), body: JSON.stringify({ code: promotion.code }) });
  assert.equal(response.status, 201); return response.body;
}

test.before(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qadr-ops-'));
  process.env.QADR_DATA_FILE = path.join(directory, 'store.json');
  ({ server, store } = require('../src/server'));
  const platformUser = { id: 'platform_test', tenantId: null, name: 'Plateforme', email: 'platform@example.test', role: 'platform_admin', passwordHash: hashPassword('plateforme-securisee'), active: true, createdAt: new Date().toISOString() };
  await store.transaction((state) => state.users.push(platformUser)); platformToken = signSession({ userId: platformUser.id, tenantId: null, role: platformUser.role, expiresAt: Date.now() + 3600000 });
  await new Promise((resolve) => server.listen(0, resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => new Promise((resolve) => server.close(resolve)));

test('isole les produits entre deux commerces', async () => {
  const alpha = await register('Alpha', 'alpha@example.test'); const beta = await register('Beta', 'beta@example.test');
  const promo = await createPromotion({ code: 'ISOLE7', maxUses: 2 }); await activate(alpha, promo); await activate(beta, promo);
  const create = await call('/api/products', { method: 'POST', headers: headers(alpha.token), body: JSON.stringify({ name: 'Marteau', category: 'Outillage', priceMinor: 4500, stockQuantity: 10, lowStockThreshold: 2 }) });
  assert.equal(create.status, 201);
  const betaProducts = await call('/api/products', { headers: headers(beta.token) });
  assert.deepEqual(betaProducts.body.products, []);
});

test('une vente idempotente déduit le stock une seule fois', async () => {
  const owner = await register('Gamma', 'gamma@example.test');
  await activate(owner, await createPromotion({ code: 'VENTE7' }));
  const product = await call('/api/products', { method: 'POST', headers: headers(owner.token), body: JSON.stringify({ name: 'Chargeur', priceMinor: 3000, stockQuantity: 5, lowStockThreshold: 1 }) });
  const key = 'vente-client-unique'; const saleBody = JSON.stringify({ items: [{ productId: product.body.product.id, quantity: 2 }], payments: [{ method: 'cash', amountMinor: 6000 }] });
  const first = await call('/api/sales', { method: 'POST', headers: headers(owner.token, { 'idempotency-key': key }), body: saleBody });
  const retry = await call('/api/sales', { method: 'POST', headers: headers(owner.token, { 'idempotency-key': key }), body: saleBody });
  assert.equal(first.status, 201); assert.equal(retry.status, 201); assert.equal(first.body.sale.id, retry.body.sale.id);
  const state = await store.read(); const stored = state.products.find((item) => item.id === product.body.product.id);
  assert.equal(stored.stockQuantity, 3); assert.equal(state.sales.filter((item) => item.tenantId === owner.tenant.id).length, 1);
});

test('refuse un encaissement supérieur au total', async () => {
  const owner = await register('Delta', 'delta@example.test');
  await activate(owner, await createPromotion({ code: 'DELTA7' }));
  const product = await call('/api/products', { method: 'POST', headers: headers(owner.token), body: JSON.stringify({ name: 'T-shirt', priceMinor: 2000, stockQuantity: 2 }) });
  const sale = await call('/api/sales', { method: 'POST', headers: headers(owner.token, { 'idempotency-key': 'vente-delta' }), body: JSON.stringify({ items: [{ productId: product.body.product.id, quantity: 1 }], payments: [] }) });
  const excess = await call(`/api/payments/${sale.body.sale.id}`, { method: 'POST', headers: headers(owner.token, { 'idempotency-key': 'trop-payer' }), body: JSON.stringify({ method: 'cash', amountMinor: 2001 }) });
  assert.equal(excess.status, 409); assert.match(excess.body.error, /dépasse/);
});

test('un code d’essai valide active réellement un abonnement avec sa durée', async () => {
  const owner = await register('Essai', 'essai@example.test'); const promotion = await createPromotion({ code: 'PILOTE21', trialDays: 21 });
  const result = await activate(owner, promotion); const tenant = result.tenant;
  assert.equal(tenant.status, 'active'); assert.equal(tenant.subscription.status, 'active');
  assert.equal(new Date(tenant.subscription.endsAt).getTime() - new Date(tenant.subscription.startsAt).getTime(), 21 * 86400000);
  const dashboard = await call('/api/platform/dashboard', { headers: headers(platformToken) }); assert.ok(dashboard.body.totals.uses >= 1);
});

test('refuse un code inexistant, expiré ou désactivé', async () => {
  const owner = await register('Refus', 'refus@example.test');
  const missing = await call('/api/subscription/redeem', { method: 'POST', headers: headers(owner.token), body: JSON.stringify({ code: 'INEXISTANT' }) }); assert.equal(missing.status, 404);
  const expired = await createPromotion({ code: 'EXPIRE7', expiresAt: '2020-01-01T00:00:00.000Z' });
  const expiredResult = await call('/api/subscription/redeem', { method: 'POST', headers: headers(owner.token), body: JSON.stringify({ code: expired.code }) }); assert.equal(expiredResult.status, 409);
  const disabled = await createPromotion({ code: 'OFFCODE' });
  const disable = await call(`/api/platform/promotions/${disabled.id}/disable`, { method: 'POST', headers: headers(platformToken) }); assert.equal(disable.status, 200);
  const disabledResult = await call('/api/subscription/redeem', { method: 'POST', headers: headers(owner.token), body: JSON.stringify({ code: disabled.code }) }); assert.equal(disabledResult.status, 409);
});

test('respecte atomiquement la limite d’utilisation et interdit la double application', async () => {
  const first = await register('Limite A', 'limite-a@example.test'); const second = await register('Limite B', 'limite-b@example.test'); const promotion = await createPromotion({ code: 'UNEFOIS', maxUses: 1 });
  const results = await Promise.all([call('/api/subscription/redeem', { method: 'POST', headers: headers(first.token), body: JSON.stringify({ code: promotion.code }) }), call('/api/subscription/redeem', { method: 'POST', headers: headers(second.token), body: JSON.stringify({ code: promotion.code }) })]);
  assert.equal(results.filter((result) => result.status === 201).length, 1); assert.equal(results.filter((result) => result.status === 409).length, 1);
  const winner = results.find((result) => result.status === 201); const account = winner === results[0] ? first : second;
  const repeated = await call('/api/subscription/redeem', { method: 'POST', headers: headers(account.token), body: JSON.stringify({ code: promotion.code }) }); assert.equal(repeated.status, 409);
});

test('un commerçant ne peut pas administrer les promotions de plateforme', async () => {
  const owner = await register('Cloisonnement', 'cloisonnement@example.test');
  const response = await call('/api/platform/promotions', { headers: headers(owner.token) }); assert.equal(response.status, 403);
});

test('l’expiration verrouille les opérations mais conserve les données du commerçant', async () => {
  const owner = await register('Conservation', 'conservation@example.test'); await activate(owner, await createPromotion({ code: 'CONSERVE7' }));
  const product = await call('/api/products', { method: 'POST', headers: headers(owner.token), body: JSON.stringify({ name: 'Article conservé', priceMinor: 1000, stockQuantity: 1 }) }); assert.equal(product.status, 201);
  await store.transaction((state) => { const tenant = state.tenants.find((item) => item.id === owner.tenant.id); tenant.subscription.endsAt = '2020-01-01T00:00:00.000Z'; });
  const me = await call('/api/me', { headers: headers(owner.token) }); assert.equal(me.body.tenant.status, 'expired');
  const dashboard = await call('/api/dashboard', { headers: headers(owner.token) }); assert.equal(dashboard.status, 403);
  const saved = await store.read(); assert.equal(saved.products.filter((item) => item.tenantId === owner.tenant.id).length, 1);
});
