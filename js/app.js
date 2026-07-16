import { DEFAULT_SETTINGS, buildLedger, calculateFees, calculateTradePreview, calculateTSimulation } from "./calculator.js";
import { auth, db } from "./db.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (value, digits = 2) => `¥${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const price = (value) => Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const integer = (value) => `${Number(value || 0).toLocaleString("zh-CN")} 股`;
const dateOnly = (value) => new Date(value).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
const dateTime = (value) => new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const localDateTimeValue = (date = new Date()) => {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};
const localDateValue = (date = new Date()) => localDateTimeValue(date).slice(0, 10);
const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const state = {
  stocks: [],
  operations: [],
  settings: { ...DEFAULT_SETTINGS },
  selectedStockId: null,
  tradeType: "buy",
  tMode: "sell-buy",
  historyDate: "",
};

function selectedStock() {
  return state.stocks.find((stock) => stock.id === state.selectedStockId) || null;
}

function selectedOperations() {
  return state.operations.filter((operation) => operation.stockId === state.selectedStockId);
}

function selectedLedger() {
  const stock = selectedStock();
  return stock ? buildLedger(stock, selectedOperations(), state.settings) : null;
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function toast(message, tone = "success") {
  const node = document.createElement("div");
  node.className = `toast ${tone}`;
  node.innerHTML = `<i data-lucide="${tone === "error" ? "circle-alert" : "check-circle-2"}"></i><span></span>`;
  node.querySelector("span").textContent = message;
  $("#toastRegion").appendChild(node);
  refreshIcons();
  window.setTimeout(() => node.remove(), 3200);
}

function showLogin(message = "") {
  const dialog = $("#loginDialog");
  const error = $("#loginError");
  error.hidden = !message;
  error.querySelector("span").textContent = message;
  if (!dialog.open) dialog.showModal();
  window.setTimeout(() => $("#loginPassword").focus(), 50);
}

function hideLogin() {
  if ($("#loginDialog").open) $("#loginDialog").close();
  $("#loginPassword").value = "";
  $("#loginError").hidden = true;
}

async function loadRemoteData() {
  const payload = await db.bootstrap();
  state.stocks = payload.stocks || [];
  state.operations = payload.operations || [];
  state.settings = { ...DEFAULT_SETTINGS, ...(payload.settings || {}) };
  state.selectedStockId = state.stocks.some((stock) => stock.id === state.selectedStockId)
    ? state.selectedStockId
    : state.stocks[0]?.id || null;
  $("#saveState").innerHTML = `<i data-lucide="database"></i>已连接 NAS 数据库`;
  render();
}

async function login(event) {
  event.preventDefault();
  const button = $("#loginButton");
  button.disabled = true;
  $("#loginError").hidden = true;
  try {
    await auth.login($("#loginPassword").value);
    await loadRemoteData();
    hideLogin();
    toast("已连接 NAS 数据库");
  } catch (error) {
    showLogin(error.message);
  } finally {
    button.disabled = false;
  }
}

async function logout() {
  await auth.logout();
  state.stocks = [];
  state.operations = [];
  state.selectedStockId = null;
  render();
  showLogin();
}

function setFormDefaults() {
  $("#tradeDate").value = localDateTimeValue();
  $("#tDate").value = localDateTimeValue();
  $("#openingDate").value = localDateValue();
}

function renderStocks() {
  const list = $("#stockList");
  $("#stockCount").textContent = state.stocks.length;
  if (!state.stocks.length) {
    list.innerHTML = `<div class="side-empty"><i data-lucide="inbox"></i><span>还没有股票</span></div>`;
    refreshIcons();
    return;
  }

  list.innerHTML = state.stocks.map((stock) => {
    const ledger = buildLedger(stock, state.operations.filter((op) => op.stockId === stock.id), state.settings);
    return `<button class="stock-item ${stock.id === state.selectedStockId ? "active" : ""}" data-stock-id="${stock.id}" type="button">
      <span class="stock-avatar">${escapeHtml(stock.name.slice(0, 1))}</span>
      <span class="stock-info"><strong>${escapeHtml(stock.name)}</strong><small>${escapeHtml(stock.code)}</small></span>
      <span class="stock-cost">${price(ledger.cost)}</span>
    </button>`;
  }).join("");
  $$(".stock-item").forEach((button) => button.addEventListener("click", () => {
    state.selectedStockId = button.dataset.stockId;
    state.historyDate = "";
    $("#historyDateFilter").value = "";
    render();
    $("#sidebar").classList.remove("open");
    $("#drawerBackdrop").hidden = true;
  }));
  refreshIcons();
}

function renderHeading() {
  const stock = selectedStock();
  if (!stock) {
    $("#stockHeading").innerHTML = `<div class="skeleton-title">请选择一只股票</div>`;
    $("#deleteStockButton").disabled = true;
    return;
  }
  $("#stockHeading").innerHTML = `<div class="heading-title"><span class="heading-code">${escapeHtml(stock.code)}</span><h1>${escapeHtml(stock.name)}</h1><span class="live-dot"></span><span class="heading-status">账本进行中</span></div><p>起始持仓 ${integer(stock.openingShares)} · ${dateOnly(stock.openingDate)} 开始记录</p>`;
  $("#deleteStockButton").disabled = false;
}

function renderMetrics() {
  const ledger = selectedLedger();
  if (!ledger) return;
  const firstCost = Number(selectedStock().openingCost || 0);
  const costDiff = ledger.cost - firstCost;
  $("#metricCost").textContent = price(ledger.cost);
  $("#metricCostDelta").textContent = `${costDiff <= 0 ? "较起始成本降低 " : "较起始成本增加 "}${price(Math.abs(costDiff))}`;
  $("#metricCostDelta").className = costDiff <= 0 ? "positive" : "negative";
  $("#metricShares").textContent = integer(ledger.shares);
  $("#metricPositionValue").textContent = `成本金额 ${money(ledger.costAmount)}`;
  $("#metricTProfit").textContent = money(ledger.totalTProfit);
  $("#metricTProfit").className = ledger.totalTProfit >= 0 ? "positive" : "negative";
  $("#metricTCount").textContent = `${ledger.tCount} 次完整做 T`;
  $("#metricFees").textContent = money(ledger.totalFees);
  $("#metricTradeCount").textContent = `${ledger.entries.length} 条操作记录`;
}

function renderTradePreview() {
  const stock = selectedStock();
  const ledger = selectedLedger();
  if (!stock || !ledger) return;
  const trade = { type: state.tradeType, price: $("#tradePrice").value, shares: $("#tradeShares").value };
  const fees = calculateFees({ ...trade, stockCode: stock.code }, state.settings);
  $("#tradeCommission").textContent = money(fees.commission);
  $("#tradeTransfer").textContent = money(fees.transfer);
  $("#tradeStamp").textContent = money(fees.stamp);
  $("#tradeFees").textContent = money(fees.total);
  const result = calculateTradePreview(ledger, trade, stock.code, state.settings);
  const hasInput = Number(trade.price) > 0 && Number(trade.shares) > 0;
  $("#previewShares").textContent = hasInput && result.valid ? integer(result.shares) : integer(ledger.shares);
  $("#previewCost").textContent = hasInput && result.valid ? price(result.cost) : price(ledger.cost);
  const delta = $("#previewDelta");
  delta.className = "delta-pill";
  if (!hasInput) {
    delta.classList.add("neutral");
    delta.textContent = "等待输入";
  } else if (!result.valid) {
    delta.classList.add("error");
    delta.textContent = result.reason || "请检查输入";
  } else {
    delta.classList.add(result.costDelta <= 0 ? "positive" : "negative");
    delta.textContent = `${result.costDelta <= 0 ? "降低" : "增加"} ${price(Math.abs(result.costDelta))}`;
  }
  $("#saveTradeButton").disabled = !result.valid;
  $("#saveTradeButton span").textContent = `保存${state.tradeType === "buy" ? "买入" : "卖出"}记录`;
}

function renderTSimulation() {
  const stock = selectedStock();
  const ledger = selectedLedger();
  if (!stock || !ledger) return;
  const tTrade = { sellPrice: $("#tSellPrice").value, buyPrice: $("#tBuyPrice").value, shares: $("#tShares").value };
  const result = calculateTSimulation(ledger, tTrade, stock.code, state.settings);
  const hasInput = Number(tTrade.sellPrice) > 0 && Number(tTrade.buyPrice) > 0 && Number(tTrade.shares) > 0;
  $("#tProfit").textContent = money(result.profit);
  $("#tProfit").className = result.profit >= 0 ? "positive" : "negative";
  $("#tNewCost").textContent = hasInput && result.valid ? price(result.newCost) : "--";
  $("#tCostDelta").textContent = hasInput && result.valid ? `${result.costDelta <= 0 ? "降低 " : "增加 "}${price(Math.abs(result.costDelta))}` : "--";
  $("#tCostDelta").className = result.costDelta <= 0 ? "positive" : "negative";
  $("#tFees").textContent = money(result.fees);
  $("#tBreakEven").textContent = hasInput ? price(result.breakEvenSpread) : "--";
  $("#tHint").textContent = !hasInput ? "输入卖出价、买回价和股数开始测算" : (!result.valid ? result.reason : `卖出净收入 ${money(result.sellNet)} · 买回支出 ${money(result.buyOutflow)}`);
  $("#saveTButton").disabled = !result.valid;
}

function operationTitle(operation) {
  if (operation.type === "t") return "做 T";
  return operation.type === "buy" ? "买入" : "卖出";
}

function operationDetail(operation) {
  if (operation.type === "t") {
    return `卖出 ${price(operation.sellPrice)} · 买回 ${price(operation.buyPrice)} · ${integer(operation.shares)}`;
  }
  return `${price(operation.price)} × ${integer(operation.shares)}`;
}

function renderHistory() {
  const ledger = selectedLedger();
  if (!ledger) return;
  const filter = state.historyDate;
  const entries = ledger.entries.filter((entry) => !filter || String(entry.date).slice(0, 10) === filter);
  $("#historySummary").textContent = filter ? `${filter} 共 ${entries.length} 条记录` : `共 ${entries.length} 条记录 · 每条都显示操作后的成本`;
  const list = $("#historyList");
  if (!entries.length) {
    list.innerHTML = `<div class="history-empty"><i data-lucide="calendar-off"></i><span>${filter ? "这一天没有操作记录" : "还没有操作记录，先在上方保存一笔买卖或做 T"}</span></div>`;
    refreshIcons();
    return;
  }

  const groups = entries.reduce((map, entry) => {
    const key = String(entry.date).slice(0, 10);
    (map[key] ||= []).push(entry);
    return map;
  }, {});
  list.innerHTML = Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0])).map(([day, dayEntries]) => `
    <div class="history-day"><div class="day-label"><span>${dateOnly(day)}</span><span>${dayEntries.length} 条</span></div>
    <div class="history-rows">${dayEntries.sort((a, b) => new Date(b.date) - new Date(a.date)).map((entry) => {
      const isT = entry.type === "t";
      const calculation = entry.calculation;
      const delta = calculation.costDelta;
      const detail = !entry.valid
        ? `${operationDetail(entry)} · ${calculation.reason || "记录无法计入当前持仓"}`
        : isT
          ? `${operationDetail(entry)} · 净收益 ${money(calculation.profit)}`
          : `${operationDetail(entry)} · 费用 ${money(calculation.fees.total)}`;
      return `<article class="history-row ${isT ? "t-row" : ""}">
        <div class="op-icon ${entry.type}"><i data-lucide="${isT ? "repeat-2" : entry.type === "buy" ? "arrow-down-left" : "arrow-up-right"}"></i></div>
        <div class="op-main"><div class="op-title"><strong>${operationTitle(entry)}</strong><span>${dateTime(entry.date)}</span></div><p>${detail}</p>${entry.note ? `<small>${escapeHtml(entry.note)}</small>` : ""}</div>
        <div class="op-result"><span>${entry.valid ? "操作后成本" : "未计入成本"}</span><strong>${price(entry.afterCost)}</strong>${entry.valid ? `<small class="${delta <= 0 ? "positive" : "negative"}">${delta <= 0 ? "降低" : "增加"} ${price(Math.abs(delta))}</small>` : `<small class="negative">记录无效</small>`}</div>
        <button class="icon-button delete-op" data-operation-id="${entry.id}" type="button" aria-label="删除这条记录" title="删除这条记录"><i data-lucide="trash-2"></i></button>
      </article>`;
    }).join("")}</div></div>`).join("");
  $$(".delete-op").forEach((button) => button.addEventListener("click", () => deleteOperation(button.dataset.operationId)));
  refreshIcons();
}

function render() {
  renderStocks();
  renderHeading();
  const hasStock = Boolean(selectedStock());
  $("#emptyState").hidden = hasStock;
  $("#dashboard").hidden = !hasStock;
  if (hasStock) {
    renderMetrics();
    renderTradePreview();
    renderTSimulation();
    renderHistory();
  }
  refreshIcons();
}

async function createStock(event) {
  event.preventDefault();
  const stock = {
    id: uid("stock"),
    code: $("#stockCode").value.trim(),
    name: $("#stockName").value.trim(),
    openingCost: Number($("#openingCost").value),
    openingShares: Number($("#openingShares").value),
    openingDate: `${$("#openingDate").value}T09:30:00`,
    createdAt: new Date().toISOString(),
  };
  if (!stock.code || !stock.name || stock.openingCost < 0 || stock.openingShares < 0) return;
  await db.putStock(stock);
  state.stocks.push(stock);
  state.selectedStockId = stock.id;
  $("#stockDialog").close();
  $("#stockForm").reset();
  setFormDefaults();
  render();
  toast(`已建立 ${stock.name} 账本`);
}

async function saveTrade(event) {
  event.preventDefault();
  const stock = selectedStock();
  const ledger = selectedLedger();
  const operation = {
    id: uid("op"), stockId: stock.id, type: state.tradeType,
    price: Number($("#tradePrice").value), shares: Number($("#tradeShares").value),
    date: new Date($("#tradeDate").value).toISOString(), note: $("#tradeNote").value.trim(),
  };
  const result = calculateTradePreview(ledger, operation, stock.code, state.settings);
  if (!result.valid) return toast(result.reason || "请检查输入", "error");
  await db.putOperation(operation);
  state.operations.push(operation);
  $("#tradeForm").reset();
  $("#tradeDate").value = localDateTimeValue();
  render();
  toast(`${operation.type === "buy" ? "买入" : "卖出"}记录已保存`);
}

async function saveT(event) {
  event.preventDefault();
  const stock = selectedStock();
  const ledger = selectedLedger();
  const operation = {
    id: uid("t"), stockId: stock.id, type: "t", mode: state.tMode,
    sellPrice: Number($("#tSellPrice").value), buyPrice: Number($("#tBuyPrice").value), shares: Number($("#tShares").value),
    date: new Date($("#tDate").value).toISOString(), note: $("#tNote").value.trim(),
  };
  const result = calculateTSimulation(ledger, operation, stock.code, state.settings);
  if (!result.valid) return toast(result.reason || "请检查输入", "error");
  await db.putOperation(operation);
  state.operations.push(operation);
  $("#tForm").reset();
  $("#tDate").value = localDateTimeValue();
  render();
  toast("做 T 记录已保存，持仓成本已更新");
}

async function deleteOperation(id) {
  const operation = state.operations.find((item) => item.id === id);
  if (!operation || !window.confirm("删除后，后续成本会按剩余记录重新计算。确定删除吗？")) return;
  await db.deleteOperation(id);
  state.operations = state.operations.filter((item) => item.id !== id);
  render();
  toast("记录已删除");
}

async function deleteCurrentStock() {
  const stock = selectedStock();
  if (!stock || !window.confirm(`删除 ${stock.name} 及其全部操作记录？`)) return;
  await db.deleteStock(stock.id);
  state.stocks = state.stocks.filter((item) => item.id !== stock.id);
  state.operations = state.operations.filter((item) => item.stockId !== stock.id);
  state.selectedStockId = state.stocks[0]?.id || null;
  render();
  toast("股票账本已删除");
}

function showStockDialog() {
  $("#stockDialog").showModal();
  window.setTimeout(() => $("#stockCode").focus(), 50);
}

function showSettingsDialog() {
  const s = state.settings;
  $("#commissionRate").value = (s.commissionRate * 100).toFixed(5);
  $("#minCommission").value = s.minCommission;
  $("#transferRate").value = (s.transferRate * 100).toFixed(5);
  $("#stampRate").value = (s.stampRate * 100).toFixed(5);
  $("#shOnlyTransfer").checked = s.shOnlyTransfer;
  $("#settingsDialog").showModal();
}

async function saveSettings(event) {
  event.preventDefault();
  state.settings = {
    commissionRate: Number($("#commissionRate").value) / 100,
    minCommission: Number($("#minCommission").value),
    transferRate: Number($("#transferRate").value) / 100,
    stampRate: Number($("#stampRate").value) / 100,
    shOnlyTransfer: $("#shOnlyTransfer").checked,
  };
  await db.putSetting("fees", state.settings);
  $("#settingsDialog").close();
  render();
  toast("费率设置已保存，历史成本已重新计算");
}

function resetSettings() {
  $("#commissionRate").value = (DEFAULT_SETTINGS.commissionRate * 100).toFixed(5);
  $("#minCommission").value = DEFAULT_SETTINGS.minCommission;
  $("#transferRate").value = (DEFAULT_SETTINGS.transferRate * 100).toFixed(5);
  $("#stampRate").value = (DEFAULT_SETTINGS.stampRate * 100).toFixed(5);
  $("#shOnlyTransfer").checked = DEFAULT_SETTINGS.shOnlyTransfer;
  toast("已填入旧版默认参数");
}

function exportData() {
  const payload = { version: 1, exportedAt: new Date().toISOString(), settings: state.settings, stocks: state.stocks, operations: state.operations };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `持仓账本备份-${localDateValue()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast("备份文件已生成");
}

async function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!Array.isArray(payload.stocks) || !Array.isArray(payload.operations)) throw new Error("文件结构不正确");
    if (!window.confirm(`恢复后会覆盖当前 ${state.stocks.length} 个股票账本，确定继续吗？`)) return;
    await db.importAll(payload);
    state.stocks = payload.stocks;
    state.operations = payload.operations;
    state.settings = { ...DEFAULT_SETTINGS, ...(payload.settings || {}) };
    state.selectedStockId = state.stocks[0]?.id || null;
    render();
    toast("数据恢复成功");
  } catch (error) {
    toast(`恢复失败：${error.message}`, "error");
  } finally {
    event.target.value = "";
  }
}

function bindEvents() {
  $("#addStockButton").addEventListener("click", showStockDialog);
  $("#emptyAddButton").addEventListener("click", showStockDialog);
  $("#stockForm").addEventListener("submit", createStock);
  $("#tradeForm").addEventListener("submit", saveTrade);
  $("#tForm").addEventListener("submit", saveT);
  $("#settingsButton").addEventListener("click", showSettingsDialog);
  $("#settingsForm").addEventListener("submit", saveSettings);
  $("#resetSettingsButton").addEventListener("click", resetSettings);
  $("#deleteStockButton").addEventListener("click", deleteCurrentStock);
  $("#exportButton").addEventListener("click", exportData);
  $("#importButton").addEventListener("click", () => $("#importFileInput").click());
  $("#importFileInput").addEventListener("change", importData);
  $("#loginForm").addEventListener("submit", login);
  $("#logoutButton").addEventListener("click", logout);
  $("#historyDateFilter").addEventListener("change", (event) => { state.historyDate = event.target.value; renderHistory(); });
  $("#clearDateFilter").addEventListener("click", () => { state.historyDate = ""; $("#historyDateFilter").value = ""; renderHistory(); });
  $("#menuButton").addEventListener("click", () => { $("#sidebar").classList.add("open"); $("#drawerBackdrop").hidden = false; });
  $("#drawerBackdrop").addEventListener("click", () => { $("#sidebar").classList.remove("open"); $("#drawerBackdrop").hidden = true; });
  $$(".dialog-close").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));

  $$("[data-trade-type]").forEach((button) => button.addEventListener("click", () => {
    state.tradeType = button.dataset.tradeType;
    $$("[data-trade-type]").forEach((item) => item.classList.toggle("active", item === button));
    $("#tradeForm").classList.toggle("sell-mode", state.tradeType === "sell");
    renderTradePreview();
  }));
  $$("[data-t-mode]").forEach((button) => button.addEventListener("click", () => {
    state.tMode = button.dataset.tMode;
    $$("[data-t-mode]").forEach((item) => item.classList.toggle("active", item === button));
  }));
  ["#tradePrice", "#tradeShares"].forEach((selector) => $(selector).addEventListener("input", renderTradePreview));
  ["#tSellPrice", "#tBuyPrice", "#tShares"].forEach((selector) => $(selector).addEventListener("input", renderTSimulation));
  window.addEventListener("auth-required", () => showLogin("登录已失效，请重新登录"));
  window.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    toast(event.reason?.message || "操作失败，请稍后重试", "error");
  });
}

async function init() {
  setFormDefaults();
  bindEvents();
  render();
  if (!auth.hasSession()) return showLogin();
  try {
    await loadRemoteData();
  } catch (error) {
    if (error.status !== 401) showLogin(error.message);
  }
}

init();
