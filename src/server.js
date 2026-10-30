const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { JsonStore } = require('./store');
const { hashPassword, verifyPassword, signSession, verifySession } = require('./auth');

const PORT = Number(process.env.PORT || 3000);
const store = new JsonStore(process.env.QADR_DATA_FILE || path.join(process.cwd(), 'data', 'qadr-ops.json'));
const roles = { owner: 3, manager: 2, cashier: 1 };
const sectors = new Set(['hardware', 'phones', 'general_store', 'clothing']);
const paymentMethods = new Set(['cash', 'wave', 'orange_money', 'mtn_momo', 'other']);
const promotionTypes = new Set(['trial', 'discount_percent', 'discount_fixed', 'vip_access']);

function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function now() { return new Date().toISOString(); }
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function value(input, field, { required = true, max = 160 } = {}) {
  const result = typeof input?.[field] === 'string' ? input[field].trim() : '';
  if (required && !result) fail(400, `${field} est requis.`);
  if (result.length > max) fail(400, `${field} est trop long.`);
  return result;
}
function integer(input, field, { min = 0, required = true } = {}) {
  const result = Number(input?.[field]);
  if (!required && input?.[field] === undefined) return undefined;
  if (Number.isInteger(result) && result >= min) return result;
  fail(400, `${field} est invalide.`);
}
function publicTenant(tenant) {
  return { id: tenant.id, name: tenant.name, sector: tenant.sector, phone: tenant.phone, address: tenant.address, email: tenant.email, currency: tenant.currency, color: tenant.color, status: tenant.status, subscription: tenant.subscription };
}
function publicUser(user) { return { id: user.id, name: user.name, email: user.email, role: user.role }; }
function addCalendarMonths(start, months) {
  const source = new Date(start); const absoluteMonth = source.getUTCMonth() + months;
  const year = source.getUTCFullYear() + Math.floor(absoluteMonth / 12); const month = ((absoluteMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(source.getUTCDate(), lastDay), source.getUTCHours(), source.getUTCMinutes(), source.getUTCSeconds(), source.getUTCMilliseconds())).toISOString();
}
function promotionSnapshot(promotion) {
  return { type: promotion.type, trialDays: promotion.trialDays || 0, trialMonths: promotion.trialMonths || 0, discountPercent: promotion.discountPercent || 0, discountMinor: promotion.discountMinor || 0, discountPeriods: promotion.discountPeriods || 0, campaignName: promotion.campaignName };
}
function subscriptionExpired(tenant, at = Date.now()) { return tenant.subscription?.endsAt && new Date(tenant.subscription.endsAt).getTime() <= at; }
function identityFromState(state, request) {
  const session = sessionFrom(request); const user = state.users.find((candidate) => candidate.id === session.userId && candidate.tenantId === session.tenantId && candidate.active);
  const tenant = state.tenants.find((candidate) => candidate.id === session.tenantId);
  if (!user || !tenant) fail(401, 'Compte introuvable.'); return { user, tenant };
}
function platformActorFromState(state, request) {
  const session = sessionFrom(request); const user = state.users.find((candidate) => candidate.id === session.userId && candidate.role === 'platform_admin' && candidate.active);
  if (!user || session.tenantId) fail(403, 'Accès superadministrateur requis.'); return { user };
}

async function body(request) {
  let size = 0; let raw = '';
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 512_000) fail(413, 'Corps de requête trop volumineux.');
    raw += chunk;
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { fail(400, 'JSON invalide.'); }
}
function send(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload));
}
function sessionFrom(request) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  if (!session) fail(401, 'Session invalide ou expirée.');
  return session;
}
async function actorFrom(request, minimumRole = 'cashier') {
  const state = await store.read();
  const { user, tenant } = identityFromState(state, request);
  if (tenant.status === 'active' && subscriptionExpired(tenant)) {
    await store.transaction((draft) => { const current = draft.tenants.find((item) => item.id === tenant.id); if (current?.status === 'active' && subscriptionExpired(current)) { current.status = 'expired'; current.subscription.status = 'expired'; current.subscription.expiredAt = now(); } });
    fail(403, 'Votre abonnement a expiré.');
  }
  if (tenant.status !== 'active') fail(403, 'Cet espace est actuellement indisponible.');
  if (roles[user.role] < roles[minimumRole]) fail(403, 'Permission insuffisante.');
  return { user, tenant };
}
function sessionFor(user) {
  return signSession({ userId: user.id, tenantId: user.tenantId || null, role: user.role, expiresAt: Date.now() + 1000 * 60 * 60 * 12 });
}
function assertIdempotency(request) {
  const key = request.headers['idempotency-key'];
  if (!key || typeof key !== 'string' || key.length > 160) fail(400, 'La clé Idempotency-Key est requise.');
  return key;
}
function dayRange() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function api(request, response, url) {
  const { pathname } = url;
  if (request.method === 'POST' && pathname === '/api/auth/register') {
    const input = await body(request);
    const name = value(input, 'ownerName');
    const email = value(input, 'email', { max: 254 }).toLowerCase();
    const password = value(input, 'password', { max: 256 });
    const businessName = value(input, 'businessName');
    const sector = value(input, 'sector', { max: 40 });
    if (password.length < 10) fail(400, 'Le mot de passe doit contenir au moins 10 caractères.');
    if (!sectors.has(sector)) fail(400, 'Secteur non pris en charge.');
    const result = await store.transaction((state) => {
      if (state.users.some((user) => user.email === email)) fail(409, 'Cette adresse e-mail est déjà utilisée.');
      const tenant = { id: id('tenant'), name: businessName, sector, phone: value(input, 'phone'), address: value(input, 'address', { required: false }), email: value(input, 'businessEmail', { required: false, max: 254 }), currency: 'XOF', color: '#2563eb', status: 'pending', subscription: { plan: 'standard', status: 'pending', startsAt: null, endsAt: null, periodId: null, promotion: null }, createdAt: now() };
      const user = { id: id('user'), tenantId: tenant.id, name, email, role: 'owner', passwordHash: hashPassword(password), active: true, createdAt: now() };
      state.tenants.push(tenant); state.users.push(user);
      return { token: sessionFor(user), user: publicUser(user), tenant: publicTenant(tenant) };
    });
    return send(response, 201, result);
  }
  if (request.method === 'POST' && pathname === '/api/auth/login') {
    const input = await body(request); const email = value(input, 'email', { max: 254 }).toLowerCase(); const password = value(input, 'password', { max: 256 });
    const state = await store.read(); const user = state.users.find((candidate) => candidate.email === email && candidate.active);
    if (!user || !verifyPassword(password, user.passwordHash)) fail(401, 'Identifiants incorrects.');
    if (user.role === 'platform_admin') return send(response, 200, { token: sessionFor(user), user: publicUser(user), platform: true });
    const tenant = state.tenants.find((candidate) => candidate.id === user.tenantId);
    if (!tenant) fail(403, 'Cet espace est introuvable.');
    return send(response, 200, { token: sessionFor(user), user: publicUser(user), tenant: publicTenant(tenant) });
  }
  if (request.method === 'GET' && pathname === '/api/me') {
    const state = await store.read();
    const session = sessionFrom(request);
    if (session.tenantId) { const { user, tenant } = identityFromState(state, request); if (tenant.status === 'active' && subscriptionExpired(tenant)) { const updated = await store.transaction((draft) => { const current = draft.tenants.find((item) => item.id === tenant.id); current.status = 'expired'; current.subscription.status = 'expired'; current.subscription.expiredAt = now(); return current; }); return send(response, 200, { user: publicUser(user), tenant: publicTenant(updated) }); } return send(response, 200, { user: publicUser(user), tenant: publicTenant(tenant) }); }
    const { user } = platformActorFromState(state, request); return send(response, 200, { user: publicUser(user), platform: true });
  }
  if (request.method === 'POST' && pathname === '/api/subscription/redeem') {
    const session = sessionFrom(request); const input = await body(request); const code = value(input, 'code', { max: 64 }).replace(/\s+/g, '').toUpperCase();
    const result = await store.transaction((state) => {
      const { user, tenant } = identityFromState(state, request);
      if (tenant.status === 'suspended') fail(403, 'Cet espace est suspendu.');
      const promotion = state.promotionCodes.find((item) => item.code === code);
      if (!promotion) fail(404, 'Code promotionnel introuvable.');
      const at = now();
      if (!promotion.active) fail(409, 'Ce code promotionnel est désactivé.');
      if (promotion.startsAt && at < promotion.startsAt) fail(409, 'Ce code n’est pas encore valide.');
      if (promotion.expiresAt && at >= promotion.expiresAt) fail(409, 'Ce code promotionnel a expiré.');
      if (promotion.reservedTenantId && promotion.reservedTenantId !== tenant.id) fail(403, 'Ce code est réservé à une autre entreprise.');
      if (promotion.allowedSectors.length && !promotion.allowedSectors.includes(tenant.sector)) fail(403, 'Ce code n’est pas disponible pour votre secteur.');
      if (promotion.plans.length && !promotion.plans.includes(tenant.subscription.plan)) fail(403, 'Ce code n’est pas compatible avec votre formule.');
      const uses = state.promotionRedemptions.filter((item) => item.promotionId === promotion.id && item.status === 'applied');
      const tenantUses = uses.filter((item) => item.tenantId === tenant.id);
      if (promotion.maxUses !== null && uses.length >= promotion.maxUses) fail(409, 'La limite d’utilisation de ce code est atteinte.');
      if (tenantUses.length >= promotion.maxUsesPerTenant) fail(409, 'Votre entreprise a déjà utilisé ce code.');
      if (['trial', 'vip_access'].includes(promotion.type) && tenantUses.length) fail(409, 'Cet avantage d’accès a déjà été accordé à votre entreprise.');
      if (tenant.subscription.periodId && tenantUses.some((item) => item.subscriptionPeriodId === tenant.subscription.periodId)) fail(409, 'Ce code est déjà appliqué à cette période d’abonnement.');
      const snapshot = promotionSnapshot(promotion); const startAt = at;
      let endAt = tenant.subscription.endsAt;
      if (promotion.type === 'trial' || promotion.type === 'vip_access') {
        endAt = promotion.trialMonths ? addCalendarMonths(startAt, promotion.trialMonths) : new Date(new Date(startAt).getTime() + promotion.trialDays * 86400000).toISOString();
        tenant.status = 'active'; tenant.subscription.status = 'active'; tenant.subscription.startsAt = startAt; tenant.subscription.endsAt = endAt; tenant.subscription.periodId = id('period');
      } else {
        tenant.subscription.promotion = { ...snapshot, appliedAt: at };
      }
      const redemption = { id: id('promotion_use'), promotionId: promotion.id, tenantId: tenant.id, subscriptionPeriodId: tenant.subscription.periodId, appliedAt: at, status: 'applied', benefit: snapshot, subscriptionStartAt: tenant.subscription.startsAt, subscriptionEndAt: endAt, appliedBy: user.id };
      state.promotionRedemptions.push(redemption); promotion.usageCount += 1;
      state.auditEvents.push({ id: id('audit'), actorId: user.id, tenantId: tenant.id, action: 'promotion.redeemed', targetId: promotion.id, createdAt: at, metadata: { code: promotion.code, redemptionId: redemption.id } });
      return { redemption, tenant: publicTenant(tenant) };
    });
    return send(response, 201, result);
  }
  if (request.method === 'GET' && pathname === '/api/platform/dashboard') {
    const state = await store.read(); platformActorFromState(state, request);
    const at = now(); const codes = state.promotionCodes;
    return send(response, 200, { totals: { all: codes.length, active: codes.filter((item) => item.active && (!item.expiresAt || item.expiresAt > at)).length, expired: codes.filter((item) => item.expiresAt && item.expiresAt <= at).length, disabled: codes.filter((item) => !item.active).length, uses: state.promotionRedemptions.filter((item) => item.status === 'applied').length } });
  }
  if (request.method === 'GET' && pathname === '/api/platform/promotions') {
    const state = await store.read(); platformActorFromState(state, request); const status = url.searchParams.get('status'); const type = url.searchParams.get('type'); const search = (url.searchParams.get('q') || '').toLowerCase(); const at = now();
    const promotions = state.promotionCodes.filter((item) => (!type || item.type === type) && (!search || `${item.code} ${item.campaignName}`.toLowerCase().includes(search)) && (!status || (status === 'active' ? item.active && (!item.expiresAt || item.expiresAt > at) : status === 'expired' ? Boolean(item.expiresAt && item.expiresAt <= at) : status === 'disabled' ? !item.active : true))).map((promotion) => ({ ...promotion, redemptions: state.promotionRedemptions.filter((use) => use.promotionId === promotion.id).map((use) => ({ ...use, tenantName: state.tenants.find((tenant) => tenant.id === use.tenantId)?.name || 'Entreprise supprimée' })) }));
    return send(response, 200, { promotions });
  }
  if (request.method === 'POST' && pathname === '/api/platform/promotions') {
    const input = await body(request); const state = await store.read(); const { user } = platformActorFromState(state, request);
    const promotion = await store.transaction((draft) => {
      const type = value(input, 'type', { max: 40 }); if (!promotionTypes.has(type)) fail(400, 'Type d’avantage invalide.');
      const suppliedCode = value(input, 'code', { required: false, max: 64 }); const code = (suppliedCode ? suppliedCode.replace(/\s+/g, '').toUpperCase() : `PROMO-${crypto.randomBytes(6).toString('hex').toUpperCase()}`);
      if (!/^[A-Z0-9-]{6,64}$/.test(code)) fail(400, 'Le code ne peut contenir que des lettres, chiffres et tirets.');
      if (draft.promotionCodes.some((item) => item.code === code)) fail(409, 'Ce code existe déjà.');
      const startsAt = value(input, 'startsAt', { required: false, max: 40 }) || null; const expiresAt = value(input, 'expiresAt', { required: false, max: 40 }) || null;
      if (startsAt && Number.isNaN(Date.parse(startsAt))) fail(400, 'Date de début invalide.'); if (expiresAt && Number.isNaN(Date.parse(expiresAt))) fail(400, 'Date d’expiration invalide.'); if (startsAt && expiresAt && Date.parse(expiresAt) <= Date.parse(startsAt)) fail(400, 'L’expiration doit suivre le début.');
      const trialDays = integer(input, 'trialDays', { min: 0, required: false }) || 0; const trialMonths = integer(input, 'trialMonths', { min: 0, required: false }) || 0;
      const discountPercent = integer(input, 'discountPercent', { min: 0, required: false }) || 0; const discountMinor = integer(input, 'discountMinor', { min: 0, required: false }) || 0;
      if (['trial', 'vip_access'].includes(type) && (!Number.isInteger(trialDays + trialMonths) || trialDays + trialMonths < 1 || (trialDays && trialMonths))) fail(400, 'Définissez une durée en jours ou en mois.');
      if (type === 'discount_percent' && (!discountPercent || discountPercent > 100)) fail(400, 'La réduction doit être comprise entre 1 et 100 %.');
      if (type === 'discount_fixed' && !discountMinor) fail(400, 'Le montant de réduction est requis.');
      const allowedSectors = Array.isArray(input.allowedSectors) ? input.allowedSectors : []; if (allowedSectors.some((sector) => !sectors.has(sector))) fail(400, 'Restriction de secteur invalide.');
      const plans = Array.isArray(input.plans) ? input.plans.map(String) : [];
      const record = { id: id('promotion'), code, campaignName: value(input, 'campaignName'), description: value(input, 'description', { required: false, max: 500 }), type, trialDays, trialMonths, discountPercent, discountMinor, discountPeriods: integer(input, 'discountPeriods', { min: 1, required: false }) || 1, startsAt: startsAt ? new Date(startsAt).toISOString() : null, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null, maxUses: integer(input, 'maxUses', { min: 1, required: false }) ?? null, maxUsesPerTenant: integer(input, 'maxUsesPerTenant', { min: 1, required: false }) || 1, allowedSectors, plans, reservedTenantId: value(input, 'reservedTenantId', { required: false, max: 80 }) || null, active: input.active !== false, usageCount: 0, createdAt: now(), createdBy: user.id };
      draft.promotionCodes.push(record); draft.auditEvents.push({ id: id('audit'), actorId: user.id, action: 'promotion.created', targetId: record.id, createdAt: now(), metadata: { code: record.code } }); return record;
    });
    return send(response, 201, { promotion });
  }
  const disablePromotionMatch = pathname.match(/^\/api\/platform\/promotions\/([^/]+)\/disable$/);
  if (request.method === 'POST' && disablePromotionMatch) {
    const state = await store.read(); const { user } = platformActorFromState(state, request);
    const promotion = await store.transaction((draft) => { const record = draft.promotionCodes.find((item) => item.id === disablePromotionMatch[1]); if (!record) fail(404, 'Code promotionnel introuvable.'); record.active = false; record.disabledAt = now(); record.disabledBy = user.id; draft.auditEvents.push({ id: id('audit'), actorId: user.id, action: 'promotion.disabled', targetId: record.id, createdAt: now(), metadata: { code: record.code } }); return record; });
    return send(response, 200, { promotion });
  }
  const updatePromotionMatch = pathname.match(/^\/api\/platform\/promotions\/([^/]+)$/);
  if (request.method === 'PATCH' && updatePromotionMatch) {
    const input = await body(request); const state = await store.read(); const { user } = platformActorFromState(state, request);
    const promotion = await store.transaction((draft) => {
      const record = draft.promotionCodes.find((item) => item.id === updatePromotionMatch[1]); if (!record) fail(404, 'Code promotionnel introuvable.');
      if (input.campaignName !== undefined) record.campaignName = value(input, 'campaignName');
      if (input.description !== undefined) record.description = value(input, 'description', { required: false, max: 500 });
      if (input.startsAt !== undefined) { if (input.startsAt && Number.isNaN(Date.parse(input.startsAt))) fail(400, 'Date de début invalide.'); record.startsAt = input.startsAt ? new Date(input.startsAt).toISOString() : null; }
      if (input.expiresAt !== undefined) { if (input.expiresAt && Number.isNaN(Date.parse(input.expiresAt))) fail(400, 'Date d’expiration invalide.'); record.expiresAt = input.expiresAt ? new Date(input.expiresAt).toISOString() : null; }
      if (record.startsAt && record.expiresAt && Date.parse(record.expiresAt) <= Date.parse(record.startsAt)) fail(400, 'L’expiration doit suivre le début.');
      if (input.maxUses !== undefined) { record.maxUses = input.maxUses === null ? null : integer(input, 'maxUses', { min: 1 }); if (record.maxUses !== null && record.maxUses < record.usageCount) fail(409, 'La limite ne peut pas être inférieure aux utilisations existantes.'); }
      if (input.maxUsesPerTenant !== undefined) record.maxUsesPerTenant = integer(input, 'maxUsesPerTenant', { min: 1 });
      if (input.reservedTenantId !== undefined) record.reservedTenantId = value(input, 'reservedTenantId', { required: false, max: 80 }) || null;
      if (input.allowedSectors !== undefined) { if (!Array.isArray(input.allowedSectors) || input.allowedSectors.some((sector) => !sectors.has(sector))) fail(400, 'Restriction de secteur invalide.'); record.allowedSectors = input.allowedSectors; }
      if (input.plans !== undefined) { if (!Array.isArray(input.plans)) fail(400, 'Restriction de formule invalide.'); record.plans = input.plans.map(String); }
      if (input.active !== undefined) record.active = Boolean(input.active);
      record.updatedAt = now(); record.updatedBy = user.id;
      draft.auditEvents.push({ id: id('audit'), actorId: user.id, action: 'promotion.updated', targetId: record.id, createdAt: now(), metadata: { code: record.code } }); return record;
    });
    return send(response, 200, { promotion });
  }
  if (request.method === 'GET' && pathname === '/api/products') {
    const { tenant } = await actorFrom(request); const query = (url.searchParams.get('q') || '').toLowerCase();
    const state = await store.read();
    const products = state.products.filter((product) => product.tenantId === tenant.id && product.active && (!query || `${product.name} ${product.category} ${product.sku}`.toLowerCase().includes(query)));
    return send(response, 200, { products });
  }
  if (request.method === 'POST' && pathname === '/api/products') {
    const { user, tenant } = await actorFrom(request, 'manager'); const input = await body(request);
    const product = await store.transaction((state) => {
      const record = { id: id('product'), tenantId: tenant.id, name: value(input, 'name'), category: value(input, 'category', { required: false }), sku: value(input, 'sku', { required: false, max: 80 }), unit: value(input, 'unit', { required: false, max: 30 }) || 'pièce', priceMinor: integer(input, 'priceMinor', { min: 1 }), costMinor: integer(input, 'costMinor', { min: 0, required: false }) ?? 0, stockQuantity: integer(input, 'stockQuantity', { min: 0, required: false }) ?? 0, lowStockThreshold: integer(input, 'lowStockThreshold', { min: 0, required: false }) ?? 0, attributes: input.attributes && typeof input.attributes === 'object' && !Array.isArray(input.attributes) ? input.attributes : {}, active: true, createdAt: now(), updatedAt: now() };
      if (state.products.some((item) => item.tenantId === tenant.id && record.sku && item.sku === record.sku)) fail(409, 'Ce SKU existe déjà dans votre espace.');
      state.products.push(record);
      if (record.stockQuantity) state.stockMovements.push({ id: id('movement'), tenantId: tenant.id, productId: record.id, type: 'initial', quantity: record.stockQuantity, reference: record.id, actorId: user.id, createdAt: now() });
      return record;
    });
    return send(response, 201, { product });
  }
  if (request.method === 'GET' && pathname === '/api/dashboard') {
    const { tenant } = await actorFrom(request); const { start, end } = dayRange(); const state = await store.read();
    const daySales = state.sales.filter((sale) => sale.tenantId === tenant.id && sale.createdAt >= start && sale.createdAt < end && sale.status !== 'cancelled');
    const payments = state.payments.filter((payment) => payment.tenantId === tenant.id && payment.status === 'confirmed' && payment.createdAt >= start && payment.createdAt < end);
    const expenses = state.expenses.filter((expense) => expense.tenantId === tenant.id && expense.createdAt >= start && expense.createdAt < end);
    const byMethod = Object.fromEntries([...paymentMethods].map((method) => [method, payments.filter((payment) => payment.method === method).reduce((sum, payment) => sum + payment.amountMinor, 0)]));
    const lowStock = state.products.filter((product) => product.tenantId === tenant.id && product.active && product.stockQuantity <= product.lowStockThreshold);
    return send(response, 200, { salesTotalMinor: daySales.reduce((sum, sale) => sum + sale.totalMinor, 0), salesCount: daySales.length, receivedMinor: payments.reduce((sum, payment) => sum + payment.amountMinor, 0), expensesMinor: expenses.reduce((sum, expense) => sum + expense.amountMinor, 0), byMethod, lowStock });
  }
  if (request.method === 'POST' && pathname === '/api/sales') {
    const { user, tenant } = await actorFrom(request); const input = await body(request); const key = assertIdempotency(request);
    const sale = await store.transaction((state) => {
      const prior = state.idempotency.find((item) => item.tenantId === tenant.id && item.scope === 'sale' && item.key === key);
      if (prior) return state.sales.find((item) => item.id === prior.resourceId);
      if (!Array.isArray(input.items) || !input.items.length) fail(400, 'Ajoutez au moins un produit.');
      const items = input.items.map((line) => {
        const product = state.products.find((item) => item.id === line.productId && item.tenantId === tenant.id && item.active);
        if (!product) fail(404, 'Produit introuvable.'); const quantity = integer(line, 'quantity', { min: 1 });
        if (product.stockQuantity < quantity) fail(409, `Stock insuffisant pour ${product.name}.`);
        return { productId: product.id, name: product.name, unit: product.unit, quantity, unitPriceMinor: product.priceMinor, totalMinor: product.priceMinor * quantity };
      });
      const totalMinor = items.reduce((sum, item) => sum + item.totalMinor, 0);
      const submitted = Array.isArray(input.payments) ? input.payments : [];
      let receivedMinor = 0; let submittedMinor = 0;
      const paymentRows = submitted.map((payment) => {
        const method = value(payment, 'method', { max: 40 }); if (!paymentMethods.has(method)) fail(400, 'Moyen de paiement invalide.');
        const amountMinor = integer(payment, 'amountMinor', { min: 1 }); const status = method === 'cash' ? 'confirmed' : (payment.status === 'confirmed' ? 'confirmed' : 'pending');
        submittedMinor += amountMinor;
        if (status === 'confirmed') receivedMinor += amountMinor;
        return { id: id('payment'), tenantId: tenant.id, saleId: null, method, amountMinor, status, providerReference: value(payment, 'providerReference', { required: false, max: 120 }), createdAt: now(), createdBy: user.id };
      });
      if (submittedMinor > totalMinor) fail(409, 'Les paiements dépassent le total de la vente.');
      const sale = { id: id('sale'), tenantId: tenant.id, reference: `V-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`, items, totalMinor, receivedMinor, balanceMinor: totalMinor - receivedMinor, customerName: value(input, 'customerName', { required: false }), status: receivedMinor === totalMinor ? 'paid' : (receivedMinor ? 'partial' : 'credit'), createdAt: now(), createdBy: user.id };
      for (const line of items) {
        const product = state.products.find((item) => item.id === line.productId); product.stockQuantity -= line.quantity; product.updatedAt = now();
        state.stockMovements.push({ id: id('movement'), tenantId: tenant.id, productId: product.id, type: 'sale', quantity: -line.quantity, reference: sale.id, actorId: user.id, createdAt: now() });
      }
      paymentRows.forEach((payment) => { payment.saleId = sale.id; state.payments.push(payment); }); state.sales.push(sale); state.idempotency.push({ tenantId: tenant.id, scope: 'sale', key, resourceId: sale.id, createdAt: now() });
      return sale;
    });
    return send(response, 201, { sale });
  }
  const paymentMatch = pathname.match(/^\/api\/payments\/([^/]+)$/);
  if (request.method === 'POST' && paymentMatch) {
    const { user, tenant } = await actorFrom(request); const input = await body(request); const key = assertIdempotency(request);
    const payment = await store.transaction((state) => {
      const prior = state.idempotency.find((item) => item.tenantId === tenant.id && item.scope === 'payment' && item.key === key);
      if (prior) return state.payments.find((item) => item.id === prior.resourceId);
      const sale = state.sales.find((item) => item.id === paymentMatch[1] && item.tenantId === tenant.id); if (!sale) fail(404, 'Vente introuvable.');
      const method = value(input, 'method', { max: 40 }); if (!paymentMethods.has(method)) fail(400, 'Moyen de paiement invalide.'); const amountMinor = integer(input, 'amountMinor', { min: 1 });
      const committedMinor = state.payments.filter((item) => item.saleId === sale.id && item.status !== 'failed' && item.status !== 'refunded').reduce((sum, item) => sum + item.amountMinor, 0);
      if (committedMinor + amountMinor > sale.totalMinor) fail(409, 'Le montant dépasse le solde restant.');
      const payment = { id: id('payment'), tenantId: tenant.id, saleId: sale.id, method, amountMinor, status: method === 'cash' ? 'confirmed' : 'pending', providerReference: value(input, 'providerReference', { required: false, max: 120 }), createdAt: now(), createdBy: user.id };
      state.payments.push(payment); if (payment.status === 'confirmed') { sale.receivedMinor += amountMinor; sale.balanceMinor -= amountMinor; sale.status = sale.balanceMinor ? 'partial' : 'paid'; }
      state.idempotency.push({ tenantId: tenant.id, scope: 'payment', key, resourceId: payment.id, createdAt: now() }); return payment;
    });
    return send(response, 201, { payment });
  }
  if (request.method === 'GET' && pathname === '/api/stock-movements') {
    const { tenant } = await actorFrom(request, 'manager'); const state = await store.read();
    return send(response, 200, { movements: state.stockMovements.filter((movement) => movement.tenantId === tenant.id).slice(-200).reverse() });
  }
  if (request.method === 'GET' && pathname === '/api/expenses') {
    const { tenant } = await actorFrom(request, 'manager'); const state = await store.read();
    return send(response, 200, { expenses: state.expenses.filter((expense) => expense.tenantId === tenant.id).slice(-200).reverse() });
  }
  if (request.method === 'POST' && pathname === '/api/expenses') {
    const { user, tenant } = await actorFrom(request, 'manager'); const input = await body(request);
    const expense = await store.transaction((state) => { const record = { id: id('expense'), tenantId: tenant.id, label: value(input, 'label'), amountMinor: integer(input, 'amountMinor', { min: 1 }), method: value(input, 'method', { required: false, max: 40 }) || 'cash', createdAt: now(), createdBy: user.id }; state.expenses.push(record); return record; });
    return send(response, 201, { expense });
  }
  fail(404, 'Route introuvable.');
}

async function serveStatic(response, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!/^[a-zA-Z0-9._/-]+$/.test(requested)) fail(404, 'Fichier introuvable.');
  const file = path.join(__dirname, '..', 'public', requested);
  const root = path.join(__dirname, '..', 'public');
  if (!file.startsWith(root)) fail(404, 'Fichier introuvable.');
  const content = await fs.readFile(file); const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'text/html';
  response.writeHead(200, { 'content-type': `${type}; charset=utf-8` }); response.end(content);
}

const server = http.createServer(async (request, response) => {
  try { const url = new URL(request.url, `http://${request.headers.host}`); if (url.pathname.startsWith('/api/')) await api(request, response, url); else if (request.method === 'GET') await serveStatic(response, url.pathname); else fail(405, 'Méthode non autorisée.'); }
  catch (error) { send(response, error.status || 500, { error: error.status ? error.message : 'Erreur interne.' }); if (!error.status) console.error(error); }
});

async function bootstrapPlatformAdmin() {
  const email = process.env.QADR_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase(); const password = process.env.QADR_BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;
  if (password.length < 10) throw new Error('QADR_BOOTSTRAP_ADMIN_PASSWORD doit contenir au moins 10 caractères.');
  await store.transaction((state) => {
    if (state.users.some((user) => user.email === email)) return;
    state.users.push({ id: id('platform_user'), tenantId: null, name: 'Administrateur QADR OPS', email, role: 'platform_admin', passwordHash: hashPassword(password), active: true, createdAt: now() });
  });
}

if (require.main === module) bootstrapPlatformAdmin().then(() => server.listen(PORT, () => console.log(`QADR OPS running at http://localhost:${PORT}`))).catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { server, store };
