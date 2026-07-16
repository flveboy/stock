import pg from "pg";

const { Pool } = pg;

export function createStorage(connectionString) {
  const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30000 });

  return {
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS stocks (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          payload JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS operations (
          id TEXT PRIMARY KEY,
          stock_id TEXT NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
          operation_date TIMESTAMPTZ NOT NULL,
          payload JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS operations_stock_id_idx ON operations(stock_id);
        CREATE INDEX IF NOT EXISTS operations_date_idx ON operations(operation_date);
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    },

    async health() {
      await pool.query("SELECT 1");
    },

    async getBootstrap() {
      const [stocks, operations, setting] = await Promise.all([
        pool.query("SELECT payload FROM stocks ORDER BY COALESCE(payload->>'createdAt', '') ASC, id ASC"),
        pool.query("SELECT payload FROM operations ORDER BY operation_date ASC, id ASC"),
        pool.query("SELECT value FROM settings WHERE key = 'fees'"),
      ]);
      return {
        stocks: stocks.rows.map((row) => row.payload),
        operations: operations.rows.map((row) => row.payload),
        settings: setting.rows[0]?.value || null,
      };
    },

    async putStock(stock) {
      await pool.query(
        `INSERT INTO stocks (id, code, name, payload) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, payload = EXCLUDED.payload, updated_at = NOW()`,
        [stock.id, stock.code, stock.name, stock],
      );
      return stock;
    },

    async deleteStock(id) {
      await pool.query("DELETE FROM stocks WHERE id = $1", [id]);
    },

    async putOperation(operation) {
      await pool.query(
        `INSERT INTO operations (id, stock_id, operation_date, payload) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET stock_id = EXCLUDED.stock_id, operation_date = EXCLUDED.operation_date, payload = EXCLUDED.payload, updated_at = NOW()`,
        [operation.id, operation.stockId, operation.date, operation],
      );
      return operation;
    },

    async deleteOperation(id) {
      await pool.query("DELETE FROM operations WHERE id = $1", [id]);
    },

    async putSetting(key, value) {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value],
      );
      return { key, value };
    },

    async importAll(payload) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM operations");
        await client.query("DELETE FROM stocks");
        await client.query("DELETE FROM settings");
        for (const stock of payload.stocks) {
          await client.query("INSERT INTO stocks (id, code, name, payload) VALUES ($1, $2, $3, $4)", [stock.id, stock.code, stock.name, stock]);
        }
        for (const operation of payload.operations) {
          await client.query("INSERT INTO operations (id, stock_id, operation_date, payload) VALUES ($1, $2, $3, $4)", [operation.id, operation.stockId, operation.date, operation]);
        }
        if (payload.settings) {
          await client.query("INSERT INTO settings (key, value) VALUES ('fees', $1)", [payload.settings]);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async close() {
      await pool.end();
    },
  };
}
