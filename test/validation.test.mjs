import test from "node:test";
import assert from "node:assert/strict";
import { validateImport, validateOperation, validateSettings, validateStock } from "../server/validation.js";

const stock = {
  id: "stock-1",
  code: "600519",
  name: "贵州茅台",
  openingCost: 1500,
  openingShares: 100,
  openingDate: "2026-07-16T09:30:00+08:00",
};

test("accepts a valid stock and rejects negative opening shares", () => {
  assert.equal(validateStock(stock), stock);
  assert.throws(() => validateStock({ ...stock, openingShares: -1 }), /起始股数无效/);
});

test("validates normal trades and complete T trades", () => {
  const buy = { id: "op-1", stockId: stock.id, type: "buy", price: 1400, shares: 100, date: "2026-07-16T10:00:00+08:00" };
  const tTrade = { id: "op-2", stockId: stock.id, type: "t", sellPrice: 1550, buyPrice: 1500, shares: 100, date: "2026-07-16T14:00:00+08:00" };
  assert.equal(validateOperation(buy), buy);
  assert.equal(validateOperation(tTrade), tTrade);
  assert.throws(() => validateOperation({ ...buy, shares: 0 }), /成交股数无效/);
});

test("validates fee settings and backup structure", () => {
  const settings = { commissionRate: 0.0000854, minCommission: 5, transferRate: 0.00001, stampRate: 0.0005 };
  assert.equal(validateSettings(settings), settings);
  const payload = { stocks: [stock], operations: [], settings };
  assert.equal(validateImport(payload), payload);
  assert.throws(() => validateImport({ stocks: [] }), /缺少股票或操作记录/);
});
