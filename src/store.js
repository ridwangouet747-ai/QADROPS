const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const emptyState = () => ({
  tenants: [], users: [], products: [], sales: [], payments: [], stockMovements: [], expenses: [], idempotency: [], promotionCodes: [], promotionRedemptions: [], auditEvents: []
});

class JsonStore {
  constructor(file) {
    this.file = file;
    this.queue = Promise.resolve();
  }

  async read() {
    try { return JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return emptyState(); throw error; }
  }

  async transaction(work) {
    const next = this.queue.then(async () => {
      const state = await this.read();
      const result = await work(state);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(state, null, 2), 'utf8');
      await fs.rename(temporary, this.file);
      return result;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}

module.exports = { JsonStore };
