export const DEFAULT_SETTINGS = Object.freeze({
  commissionRate: 0.0000854,
  minCommission: 5,
  transferRate: 0.00001,
  stampRate: 0.0005,
  shOnlyTransfer: true,
});

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function calculateFees({ type, price, shares, stockCode = "" }, settings = DEFAULT_SETTINGS) {
  const tradePrice = number(price);
  const tradeShares = number(shares);
  const amount = tradePrice * tradeShares;
  if (amount <= 0) {
    return { amount: 0, commission: 0, transfer: 0, stamp: 0, total: 0 };
  }

  const commission = Math.max(amount * number(settings.commissionRate), number(settings.minCommission));
  const shouldChargeTransfer = !settings.shOnlyTransfer || String(stockCode).startsWith("6");
  const transfer = shouldChargeTransfer ? amount * number(settings.transferRate) : 0;
  const stamp = type === "sell" ? amount * number(settings.stampRate) : 0;
  return { amount, commission, transfer, stamp, total: commission + transfer + stamp };
}

export function calculateTradePreview(position, trade, stockCode, settings = DEFAULT_SETTINGS) {
  const currentShares = number(position.shares);
  const currentCostAmount = number(position.costAmount);
  const shares = number(trade.shares);
  const fees = calculateFees({ ...trade, stockCode }, settings);
  const nextShares = trade.type === "buy" ? currentShares + shares : currentShares - shares;

  if (trade.type === "sell" && shares > currentShares) {
    return { valid: false, reason: "卖出股数不能超过当前持仓", fees };
  }

  let nextCostAmount;
  if (trade.type === "buy") {
    nextCostAmount = currentCostAmount + fees.amount + fees.total;
  } else if (nextShares === 0) {
    nextCostAmount = 0;
  } else {
    nextCostAmount = currentCostAmount - (fees.amount - fees.total);
  }

  const previousCost = currentShares > 0 ? currentCostAmount / currentShares : 0;
  const nextCost = nextShares > 0 ? nextCostAmount / nextShares : 0;
  return {
    valid: shares > 0 && number(trade.price) > 0,
    fees,
    shares: nextShares,
    costAmount: nextCostAmount,
    cost: nextCost,
    costDelta: nextCost - previousCost,
  };
}

export function calculateTSimulation(position, tTrade, stockCode, settings = DEFAULT_SETTINGS) {
  const shares = number(tTrade.shares);
  const currentShares = number(position.shares);
  const currentCostAmount = number(position.costAmount);
  const sellFees = calculateFees({ type: "sell", price: tTrade.sellPrice, shares, stockCode }, settings);
  const buyFees = calculateFees({ type: "buy", price: tTrade.buyPrice, shares, stockCode }, settings);
  const sellNet = sellFees.amount - sellFees.total;
  const buyOutflow = buyFees.amount + buyFees.total;
  const profit = sellNet - buyOutflow;
  const currentCost = currentShares > 0 ? currentCostAmount / currentShares : 0;
  const newCostAmount = currentCostAmount - profit;
  const newCost = currentShares > 0 ? newCostAmount / currentShares : 0;
  const sellPrice = number(tTrade.sellPrice);
  const breakEvenBuyPrice = shares > 0
    ? (sellNet - buyFees.total) / shares
    : 0;

  return {
    valid: shares > 0 && sellPrice > 0 && number(tTrade.buyPrice) > 0 && shares <= currentShares,
    reason: shares > currentShares ? "做 T 股数不能超过当前持仓" : "",
    shares,
    sellFees,
    buyFees,
    fees: sellFees.total + buyFees.total,
    sellNet,
    buyOutflow,
    profit,
    newCostAmount,
    newCost,
    costDelta: newCost - currentCost,
    spread: sellPrice - number(tTrade.buyPrice),
    breakEvenBuyPrice,
    breakEvenSpread: sellPrice - breakEvenBuyPrice,
  };
}

export function buildLedger(stock, operations, settings = DEFAULT_SETTINGS) {
  let shares = number(stock.openingShares);
  let costAmount = shares * number(stock.openingCost);
  let totalFees = 0;
  let totalTProfit = 0;
  let tCount = 0;

  const sorted = [...operations].sort((a, b) => {
    const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
    return dateDiff || String(a.id).localeCompare(String(b.id));
  });

  const entries = sorted.map((operation) => {
    const beforeShares = shares;
    const beforeCost = shares > 0 ? costAmount / shares : 0;
    let calculation;

    if (operation.type === "t") {
      calculation = calculateTSimulation(
        { shares, costAmount },
        operation,
        stock.code,
        settings,
      );
      if (calculation.valid) {
        costAmount = calculation.newCostAmount;
        totalFees += calculation.fees;
        totalTProfit += calculation.profit;
        tCount += 1;
      }
    } else {
      calculation = calculateTradePreview(
        { shares, costAmount },
        operation,
        stock.code,
        settings,
      );
      if (calculation.valid) {
        shares = calculation.shares;
        costAmount = calculation.costAmount;
        totalFees += calculation.fees.total;
      }
    }

    const automaticAfterCost = shares > 0 ? costAmount / shares : 0;
    const correctedCost = Number(operation.correctedCost);
    const corrected = calculation.valid
      && shares > 0
      && operation.correctedCost !== null
      && operation.correctedCost !== undefined
      && Number.isFinite(correctedCost);
    if (corrected) costAmount = correctedCost * shares;

    const afterCost = shares > 0 ? costAmount / shares : 0;

    return {
      ...operation,
      valid: calculation.valid,
      calculation,
      beforeShares,
      beforeCost,
      afterShares: shares,
      automaticAfterCost,
      corrected,
      correctionDelta: corrected ? afterCost - automaticAfterCost : 0,
      costDelta: afterCost - beforeCost,
      afterCost,
      afterCostAmount: costAmount,
    };
  });

  return {
    shares,
    costAmount,
    cost: shares > 0 ? costAmount / shares : 0,
    totalFees,
    totalTProfit,
    tCount,
    entries,
  };
}
