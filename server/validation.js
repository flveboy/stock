const toNumber = (value) => Number(value);

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

export function validateStock(stock) {
  if (!stock || typeof stock !== "object") invalid("股票数据不能为空");
  if (!String(stock.id || "").trim()) invalid("股票 ID 不能为空");
  if (!String(stock.code || "").trim()) invalid("股票代码不能为空");
  if (!String(stock.name || "").trim()) invalid("股票名称不能为空");
  if (!Number.isFinite(toNumber(stock.openingCost)) || toNumber(stock.openingCost) < 0) invalid("起始成本无效");
  if (!Number.isInteger(toNumber(stock.openingShares)) || toNumber(stock.openingShares) < 0) invalid("起始股数无效");
  if (Number.isNaN(new Date(stock.openingDate).getTime())) invalid("起始日期无效");
  return stock;
}

export function validateOperation(operation) {
  if (!operation || typeof operation !== "object") invalid("操作数据不能为空");
  if (!String(operation.id || "").trim()) invalid("操作 ID 不能为空");
  if (!String(operation.stockId || "").trim()) invalid("股票 ID 不能为空");
  if (!new Set(["buy", "sell", "t"]).has(operation.type)) invalid("操作类型无效");
  if (!Number.isInteger(toNumber(operation.shares)) || toNumber(operation.shares) <= 0) invalid("成交股数无效");
  if (Number.isNaN(new Date(operation.date).getTime())) invalid("成交时间无效");

  if (operation.type === "t") {
    if (!(toNumber(operation.sellPrice) > 0) || !(toNumber(operation.buyPrice) > 0)) invalid("做 T 价格无效");
  } else if (!(toNumber(operation.price) > 0)) {
    invalid("成交价格无效");
  }
  if (operation.correctedCost !== undefined
    && operation.correctedCost !== null
    && !Number.isFinite(toNumber(operation.correctedCost))) {
    invalid("修正成本无效");
  }
  return operation;
}

export function validateSettings(settings) {
  if (!settings || typeof settings !== "object") invalid("费率设置不能为空");
  for (const key of ["commissionRate", "minCommission", "transferRate", "stampRate"]) {
    if (!Number.isFinite(toNumber(settings[key])) || toNumber(settings[key]) < 0) invalid(`${key} 无效`);
  }
  return settings;
}

export function validateImport(payload) {
  if (!payload || typeof payload !== "object") invalid("备份数据无效");
  if (!Array.isArray(payload.stocks) || !Array.isArray(payload.operations)) invalid("备份文件缺少股票或操作记录");
  payload.stocks.forEach(validateStock);
  payload.operations.forEach(validateOperation);
  if (payload.settings) validateSettings(payload.settings);
  return payload;
}
