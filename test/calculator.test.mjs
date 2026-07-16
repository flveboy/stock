import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, calculateFees, calculateTradePreview, calculateTSimulation, buildLedger } from "../js/calculator.js";

test("uses legacy fee defaults and Shanghai transfer fee", () => {
  const buy = calculateFees({ type: "buy", price: 10, shares: 100, stockCode: "600000" });
  assert.equal(buy.commission, 5);
  assert.equal(buy.transfer, 0.01);
  assert.equal(buy.stamp, 0);

  const sell = calculateFees({ type: "sell", price: 10, shares: 100, stockCode: "000001" });
  assert.equal(sell.commission, 5);
  assert.equal(sell.transfer, 0);
  assert.equal(sell.stamp, 0.5);
});

test("buy preview includes fees in cost basis", () => {
  const result = calculateTradePreview({ shares: 1000, costAmount: 10000 }, { type: "buy", price: 10, shares: 100 }, "000001");
  assert.equal(result.shares, 1100);
  assert.equal(result.costAmount, 11005);
  assert.equal(result.cost, 10.004545454545454);
});

test("sell preview subtracts net proceeds from cost basis", () => {
  const result = calculateTradePreview({ shares: 1000, costAmount: 10000 }, { type: "sell", price: 12, shares: 100 }, "000001");
  assert.equal(result.shares, 900);
  assert.equal(result.costAmount, 8805.6);
  assert.equal(result.cost, 9.784);
});

test("T simulation accounts for both legs and lowers cost by net profit", () => {
  const result = calculateTSimulation({ shares: 1000, costAmount: 10000 }, { sellPrice: 12, buyPrice: 11, shares: 100 }, "000001");
  assert.equal(result.valid, true);
  assert.ok(Math.abs(result.profit - 89.4) < 1e-9);
  assert.ok(Math.abs(result.newCost - 9.9106) < 1e-9);
  assert.equal(result.fees, 10.6);
});

test("ledger recomputes history in chronological order", () => {
  const stock = { code: "000001", openingShares: 1000, openingCost: 10 };
  const ledger = buildLedger(stock, [
    { id: "b", type: "buy", price: 8, shares: 100, date: "2026-01-02T10:00:00Z" },
    { id: "a", type: "sell", price: 12, shares: 100, date: "2026-01-01T10:00:00Z" },
  ], DEFAULT_SETTINGS);
  assert.equal(ledger.entries[0].id, "a");
  assert.equal(ledger.entries[1].id, "b");
  assert.equal(ledger.shares, 1000);
});

test("ledger keeps an invalid oversell visible without changing the position", () => {
  const stock = { code: "000001", openingShares: 100, openingCost: 10 };
  const ledger = buildLedger(stock, [
    { id: "oversell", type: "sell", price: 12, shares: 200, date: "2026-01-01T10:00:00Z" },
  ], DEFAULT_SETTINGS);
  assert.equal(ledger.entries[0].valid, false);
  assert.equal(ledger.entries[0].calculation.reason, "卖出股数不能超过当前持仓");
  assert.equal(ledger.shares, 100);
  assert.equal(ledger.cost, 10);
});

test("cost correction overrides one entry and becomes the basis for later trades", () => {
  const stock = { code: "000001", openingShares: 1000, openingCost: 10 };
  const ledger = buildLedger(stock, [
    { id: "buy", type: "buy", price: 8, shares: 100, correctedCost: 9.5, date: "2026-01-01T10:00:00Z" },
    { id: "sell", type: "sell", price: 12, shares: 100, date: "2026-01-02T10:00:00Z" },
  ], DEFAULT_SETTINGS);

  assert.equal(ledger.entries[0].corrected, true);
  assert.equal(ledger.entries[0].afterCost, 9.5);
  assert.notEqual(ledger.entries[0].automaticAfterCost, 9.5);
  assert.equal(ledger.entries[1].beforeCost, 9.5);
  assert.ok(Math.abs(ledger.cost - 9.2556) < 1e-9);
});

test("invalid operations do not apply a stored cost correction", () => {
  const stock = { code: "000001", openingShares: 100, openingCost: 10 };
  const ledger = buildLedger(stock, [
    { id: "oversell", type: "sell", price: 12, shares: 200, correctedCost: 1, date: "2026-01-01T10:00:00Z" },
  ], DEFAULT_SETTINGS);

  assert.equal(ledger.entries[0].corrected, false);
  assert.equal(ledger.cost, 10);
});
