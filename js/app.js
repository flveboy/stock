import { DEFAULT_SETTINGS, buildLedger, calculateFees, calculateTradePreview, calculateTSimulation, tradingDateKey } from "./calculator.js";
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
  workspaceView: "trade",
  historyDate: "",
  historyPage: 1,
  historyPageSize: 6,
  correctionOperationId: null,
  costChart: null,
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
    state.historyPage = 1;
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
  $("#metricTCount").textContent = `${ledger.tCount} 个交易日完成 T`;
  $("#metricFees").textContent = money(ledger.totalFees);
  $("#metricTradeCount").textContent = `${ledger.tradeEntries.length} 条真实交易`;
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
  const legacyCount = ledger.simulationEntries.length;
  $("#legacySimulationNotice").hidden = legacyCount === 0;
  $("#legacySimulationText").textContent = legacyCount
    ? `有 ${legacyCount} 条旧版测算记录，已停止计入成本和复盘。`
    : "";
}

function operationTitle(operation) {
  if (operation.type === "t") return "历史测算";
  return operation.type === "buy" ? "买入" : "卖出";
}

function operationDetail(operation) {
  if (operation.type === "t") {
    return `卖出 ${price(operation.sellPrice)} · 买回 ${price(operation.buyPrice)} · ${integer(operation.shares)}`;
  }
  return `${price(operation.price)} × ${integer(operation.shares)}`;
}

function renderCostChart() {
  const stock = selectedStock();
  const ledger = selectedLedger();
  if (!stock || !ledger) return;
  const entries = ledger.tradeEntries.filter((entry) => entry.valid);
  const empty = $("#chartEmpty");
  const canvasWrap = $("#chartCanvasWrap");

  if (state.costChart) {
    state.costChart.destroy();
    state.costChart = null;
  }

  if (!entries.length || !window.Chart) {
    canvasWrap.hidden = true;
    empty.hidden = false;
    empty.querySelector("span").textContent = window.Chart
      ? "保存第一条操作后，这里会显示成本曲线"
      : "图表组件加载失败，请刷新页面重试";
    return;
  }

  canvasWrap.hidden = false;
  empty.hidden = true;
  const points = [
    { x: new Date(stock.openingDate).getTime(), y: Number(stock.openingCost), label: "起始持仓", date: stock.openingDate },
    ...entries.map((entry) => ({
      x: new Date(entry.date).getTime(),
      y: entry.afterCost,
      label: operationTitle(entry),
      date: entry.date,
      entryId: entry.id,
    })),
  ];
  const correctedPoints = entries.filter((entry) => entry.corrected).map((entry) => ({
    x: new Date(entry.date).getTime(),
    y: entry.afterCost,
    entry,
  }));
  const tPoints = ledger.tSummaries.map((summary) => {
    const entry = entries.find((item) => item.id === summary.completionEntryId);
    return entry ? { x: new Date(summary.completionDate).getTime(), y: entry.afterCost, summary } : null;
  }).filter(Boolean);
  $("#chartSummary").textContent = `${entries.length} 次真实操作 · ${ledger.tSummaries.length} 个交易日完成 T`;

  state.costChart = new window.Chart($("#costChart"), {
    type: "line",
    data: {
      datasets: [{
        kind: "cost",
        data: points,
        borderColor: "#0a8f86",
        backgroundColor: "rgba(10, 143, 134, .08)",
        borderWidth: 2,
        fill: true,
        tension: 0.24,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: "#ffffff",
        pointBorderColor: "#0a8f86",
        pointBorderWidth: 2,
      }, {
        type: "scatter",
        kind: "actual-t",
        data: tPoints,
        pointStyle: "rectRot",
        pointRadius: 6,
        pointHoverRadius: 8,
        pointBackgroundColor: "#315b7d",
        pointBorderColor: "#ffffff",
        pointBorderWidth: 2,
      }, {
        type: "scatter",
        kind: "correction",
        data: correctedPoints,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: "#c27721",
        pointBorderColor: "#ffffff",
        pointBorderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "nearest" },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            title: (items) => dateTime(items[0].parsed.x),
            label: (item) => {
              if (item.dataset.kind === "actual-t") {
                const summary = item.raw.summary;
                return `实际做 T ${integer(summary.shares)} · 净收益 ${money(summary.profit)}`;
              }
              if (item.dataset.kind === "correction") return `成本修正为 ${price(item.parsed.y)}`;
              return `${item.raw.label}后成本 ${price(item.parsed.y)}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          grid: { display: false },
          ticks: { color: "#71808b", maxRotation: 0, autoSkip: true, maxTicksLimit: 6, callback: (value) => dateTime(Number(value)), font: { size: 10 } },
        },
        y: {
          border: { display: false },
          grid: { color: "#edf0f2" },
          ticks: { color: "#71808b", callback: (value) => `¥${Number(value).toFixed(2)}`, font: { size: 10 } },
        },
      },
    },
  });
}

function renderHistory() {
  const ledger = selectedLedger();
  if (!ledger) return;
  const filter = state.historyDate;
  const entries = ledger.tradeEntries
    .filter((entry) => !filter || tradingDateKey(entry.date) === filter)
    .sort((a, b) => new Date(b.date) - new Date(a.date) || String(b.id).localeCompare(String(a.id)));
  const totalPages = Math.max(1, Math.ceil(entries.length / state.historyPageSize));
  state.historyPage = Math.min(Math.max(1, state.historyPage), totalPages);
  const start = (state.historyPage - 1) * state.historyPageSize;
  const pageEntries = entries.slice(start, start + state.historyPageSize);
  $("#historySummary").textContent = filter
    ? `${filter} 共 ${entries.length} 笔真实买卖 · 第 ${state.historyPage} / ${totalPages} 页`
    : `共 ${entries.length} 笔真实买卖 · 自动识别 ${ledger.tCount} 个做 T 交易日`;
  const list = $("#historyList");
  const pagination = $("#historyPagination");
  if (!entries.length) {
    list.innerHTML = `<div class="history-empty"><i data-lucide="calendar-off"></i><span>${filter ? "这一天没有真实买卖记录" : "还没有操作记录，先保存一笔买入或卖出"}</span></div>`;
    pagination.hidden = true;
    refreshIcons();
    return;
  }

  pagination.hidden = totalPages <= 1;
  $("#historyPageLabel").textContent = `第 ${state.historyPage} / ${totalPages} 页`;
  $("#historyPrevPage").disabled = state.historyPage <= 1;
  $("#historyNextPage").disabled = state.historyPage >= totalPages;

  const groups = pageEntries.reduce((map, entry) => {
    const key = tradingDateKey(entry.date);
    (map[key] ||= []).push(entry);
    return map;
  }, {});
  const tSummaryByDay = new Map(ledger.tSummaries.map((summary) => [summary.day, summary]));
  list.innerHTML = Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0])).map(([day, dayEntries]) => `
    <div class="history-day"><div class="day-label"><span>${dateOnly(`${day}T00:00:00+08:00`)}</span><span>${dayEntries.length} 笔</span></div>
    ${tSummaryByDay.has(day) ? (() => {
      const summary = tSummaryByDay.get(day);
      const mode = summary.mode === "sell-buy" ? "先卖后买" : summary.mode === "buy-sell" ? "先买后卖" : "多笔双向撮合";
      return `<div class="t-day-summary">
        <div class="t-summary-icon"><i data-lucide="repeat-2"></i></div>
        <div><strong>实际做 T · ${mode}</strong><span>自动匹配 ${integer(summary.shares)} · ${summary.pairCount} 组买卖</span></div>
        <div class="t-summary-profit"><span>扣费后收益</span><strong class="${summary.profit >= 0 ? "positive" : "negative"}">${money(summary.profit)}</strong></div>
      </div>`;
    })() : ""}
    <div class="history-rows">${dayEntries.map((entry) => {
      const calculation = entry.calculation;
      const delta = entry.costDelta;
      const detail = !entry.valid
        ? `${operationDetail(entry)} · ${calculation.reason || "记录无法计入当前持仓"}`
        : `${operationDetail(entry)} · 费用 ${money(calculation.fees.total)}`;
      return `<article class="history-row ${entry.corrected ? "corrected-row" : ""}">
        <div class="op-icon ${entry.type}"><i data-lucide="${entry.type === "buy" ? "arrow-down-left" : "arrow-up-right"}"></i></div>
        <div class="op-main"><div class="op-title"><strong>${operationTitle(entry)}</strong><span>${dateTime(entry.date)}</span></div><p>${detail}</p>${entry.note ? `<small>${escapeHtml(entry.note)}</small>` : ""}</div>
        <div class="op-result"><span>${entry.valid ? (entry.corrected ? "修正后成本" : "操作后成本") : "未计入成本"}</span><strong>${price(entry.afterCost)}</strong>${entry.valid ? `<small class="${delta <= 0 ? "positive" : "negative"}">${delta <= 0 ? "降低" : "增加"} ${price(Math.abs(delta))}</small>${entry.corrected ? `<small class="corrected-note">自动值 ${price(entry.automaticAfterCost)}</small>` : ""}` : `<small class="negative">记录无效</small>`}</div>
        <div class="op-actions">
          ${entry.valid && entry.afterShares > 0 ? `<button class="icon-button correct-cost" data-operation-id="${entry.id}" type="button" aria-label="修正操作后成本" title="修正操作后成本"><i data-lucide="pencil-line"></i></button>` : ""}
          <button class="icon-button delete-op" data-operation-id="${entry.id}" type="button" aria-label="删除这条记录" title="删除这条记录"><i data-lucide="trash-2"></i></button>
        </div>
      </article>`;
    }).join("")}</div></div>`).join("");
  $$(".correct-cost").forEach((button) => button.addEventListener("click", () => openCorrectionDialog(button.dataset.operationId)));
  $$(".delete-op").forEach((button) => button.addEventListener("click", () => deleteOperation(button.dataset.operationId)));
  refreshIcons();
}

function renderWorkspaceView() {
  $$('[data-workspace-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.workspacePanel !== state.workspaceView;
  });
  $$('[data-workspace-view]').forEach((button) => {
    const active = button.dataset.workspaceView === state.workspaceView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
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
    renderCostChart();
    renderHistory();
    renderWorkspaceView();
  } else if (state.costChart) {
    state.costChart.destroy();
    state.costChart = null;
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
  state.historyPage = 1;
  $("#tradeForm").reset();
  $("#tradeDate").value = localDateTimeValue();
  render();
  const matchedShares = selectedLedger().tMatches
    .filter((match) => match.buyOperationId === operation.id || match.sellOperationId === operation.id)
    .reduce((sum, match) => sum + match.shares, 0);
  toast(matchedShares > 0
    ? `${operation.type === "buy" ? "买入" : "卖出"}已保存，自动识别当日做 T ${integer(matchedShares)}`
    : `${operation.type === "buy" ? "买入" : "卖出"}记录已保存`);
}

async function clearLegacySimulations() {
  const simulations = selectedOperations().filter((operation) => operation.type === "t");
  if (!simulations.length || !window.confirm(`删除 ${simulations.length} 条旧版做 T 测算记录？真实买卖记录不会受影响。`)) return;
  await Promise.all(simulations.map((operation) => db.deleteOperation(operation.id)));
  const ids = new Set(simulations.map((operation) => operation.id));
  state.operations = state.operations.filter((operation) => !ids.has(operation.id));
  render();
  toast("旧版测算记录已清理");
}

function openCorrectionDialog(id) {
  const entry = selectedLedger()?.entries.find((item) => item.id === id);
  if (!entry || !entry.valid || entry.afterShares <= 0) return;
  state.correctionOperationId = id;
  $("#correctionOperationSummary").textContent = `${operationTitle(entry)} · ${dateTime(entry.date)} · 操作后 ${integer(entry.afterShares)}`;
  $("#automaticCostValue").textContent = price(entry.automaticAfterCost);
  $("#currentCostValue").textContent = price(entry.afterCost);
  $("#correctedCostInput").value = Number(entry.afterCost).toFixed(4);
  $("#removeCorrectionButton").hidden = !entry.corrected;
  $("#correctionDialog").showModal();
  window.setTimeout(() => $("#correctedCostInput").select(), 50);
}

async function saveCorrection(event) {
  event.preventDefault();
  const id = state.correctionOperationId;
  const operation = state.operations.find((item) => item.id === id);
  const rawValue = $("#correctedCostInput").value.trim();
  const correctedCost = Number(rawValue);
  if (!operation || !rawValue || !Number.isFinite(correctedCost)) return toast("请输入有效的修正成本", "error");

  const updated = { ...operation, correctedCost };
  await db.putOperation(updated);
  state.operations = state.operations.map((item) => item.id === id ? updated : item);
  $("#correctionDialog").close();
  state.correctionOperationId = null;
  render();
  toast("成本修正已保存，后续记录已重新计算");
}

async function removeCorrection() {
  const id = state.correctionOperationId;
  const operation = state.operations.find((item) => item.id === id);
  if (!operation) return;
  const { correctedCost: _removed, ...updated } = operation;
  await db.putOperation(updated);
  state.operations = state.operations.map((item) => item.id === id ? updated : item);
  $("#correctionDialog").close();
  state.correctionOperationId = null;
  render();
  toast("已取消修正，成本恢复为自动计算值");
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
  $("#tForm").addEventListener("submit", (event) => event.preventDefault());
  $("#clearLegacySimulations").addEventListener("click", clearLegacySimulations);
  $("#correctionForm").addEventListener("submit", saveCorrection);
  $("#removeCorrectionButton").addEventListener("click", removeCorrection);
  $("#settingsButton").addEventListener("click", showSettingsDialog);
  $("#settingsForm").addEventListener("submit", saveSettings);
  $("#resetSettingsButton").addEventListener("click", resetSettings);
  $("#deleteStockButton").addEventListener("click", deleteCurrentStock);
  $("#exportButton").addEventListener("click", exportData);
  $("#importButton").addEventListener("click", () => $("#importFileInput").click());
  $("#importFileInput").addEventListener("change", importData);
  $("#loginForm").addEventListener("submit", login);
  $("#logoutButton").addEventListener("click", logout);
  $("#historyDateFilter").addEventListener("change", (event) => { state.historyDate = event.target.value; state.historyPage = 1; renderHistory(); });
  $("#clearDateFilter").addEventListener("click", () => { state.historyDate = ""; state.historyPage = 1; $("#historyDateFilter").value = ""; renderHistory(); });
  $("#historyPrevPage").addEventListener("click", () => { state.historyPage -= 1; renderHistory(); });
  $("#historyNextPage").addEventListener("click", () => { state.historyPage += 1; renderHistory(); });
  $("#menuButton").addEventListener("click", () => { $("#sidebar").classList.add("open"); $("#drawerBackdrop").hidden = false; });
  $("#drawerBackdrop").addEventListener("click", () => { $("#sidebar").classList.remove("open"); $("#drawerBackdrop").hidden = true; });
  $$(".dialog-close").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));

  $$("[data-trade-type]").forEach((button) => button.addEventListener("click", () => {
    state.tradeType = button.dataset.tradeType;
    $$("[data-trade-type]").forEach((item) => item.classList.toggle("active", item === button));
    $("#tradeForm").classList.toggle("sell-mode", state.tradeType === "sell");
    renderTradePreview();
  }));
  $$("[data-workspace-view]").forEach((button) => button.addEventListener("click", () => {
    state.workspaceView = button.dataset.workspaceView;
    renderWorkspaceView();
    if (state.workspaceView === "simulation") renderTSimulation();
    refreshIcons();
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
