const { execute, queryOne } = require('./postgres');
function createStartupSeedRepository({ pgPool }) {
  if (!pgPool) throw new Error('pgPool is required for postgres startup seed repository.');
  return createPostgresStartupSeedRepository(pgPool);
}

function createPostgresStartupSeedRepository(pool) {
  return {
    async doctorsCount() {
      const row = await queryOne(pool, 'SELECT COUNT(*)::int as count FROM doctors');
      return Number(row?.count || 0);
    },

    insertDoctor({ name, specialization, licenseNumber, email, phone }) {
      return execute(pool, `
        INSERT INTO doctors (name, specialization, license_number, email, phone)
        VALUES (?, ?, ?, ?, ?)
      `, [name, specialization, licenseNumber, email, phone]);
    },

    async chairsCount() {
      const row = await queryOne(pool, 'SELECT COUNT(*)::int as count FROM chairs');
      return Number(row?.count || 0);
    },

    insertChair(name) {
      return execute(pool, 'INSERT INTO chairs (name) VALUES (?)', [name]);
    },

    async usersCount() {
      const row = await queryOne(pool, 'SELECT COUNT(*)::int as count FROM users');
      return Number(row?.count || 0);
    },

    insertUser({ email, passwordHash, name, role }) {
      return execute(pool, `
        INSERT INTO users (email, password_hash, name, role)
        VALUES (?, ?, ?, ?)
      `, [email, passwordHash, name, role]);
    },

    async codebookCount() {
      const row = await queryOne(pool, 'SELECT COUNT(*)::int as count FROM codebook_items');
      return Number(row?.count || 0);
    },

    insertCodebookItem({ type, value, label, groupName = null, metadata = null, price = 0, priceCurrency = 'EUR', sortOrder = 0 }) {
      return execute(pool, `
        INSERT INTO codebook_items (type, value, label, group_name, metadata, price, price_currency, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [type, value, label, groupName, metadata ? JSON.stringify(metadata) : null, price, priceCurrency, sortOrder]);
    },

    async ensureCodebookItem(item) {
      const existing = await queryOne(pool, 'SELECT id FROM codebook_items WHERE type = ? AND value = ? AND COALESCE(group_name, \'\') = COALESCE(?, \'\')', [
        item.type,
        item.value,
        item.groupName || null
      ]);
      if (existing) return;
      return this.insertCodebookItem(item);
    }
  };
}

module.exports = {
  createStartupSeedRepository
};
