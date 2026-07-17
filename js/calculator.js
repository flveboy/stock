export const DEFAULT_SETTINGS = Object.freeze({
  commissionRate: 0.0000854,
  minCommission: 5,
  transferRate: 0.00001,
  stampRate: 0.0005,
  shOnlyTransfer: true,
});

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const shanghaiDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function tradingDateKey(value) {
  return shanghaiDayFormatter.format(new Date(value));
}

export function calculateFees({ type, price, shares, stockCode = "", actualFees = {} }, settings = DEFAULT_SETTINGS) {
  const tradePrice = number(price);
  const tradeShares = number(shares);
  const amount = tradePrice * tradeShares;
  if (amount <= 0) {
    return { amount: 0, commission: 0, transfer: 0, stamp: 0, total: 0, overridden: [] };
  }

  const automaticCommission = Math.max(amount * number(settings.commissionRate), number(settings.minCommission));
  const shouldChargeTransfer = !settings.shOnlyTransfer || String(stockCode).startsWith("6");
  const automaticTransfer = shouldChargeTransfer ? amount * number(settings.transferRate) : 0;
  const automaticStamp = type === "sell" ? amount * number(settings.stampRate) : 0;
  const override = (key, fallback) => Object.hasOwn(actualFees, key)
    && actualFees[key] !== null
    && actualFees[key] !== ""
    && Number.isFinite(Number(actualFees[key]))
    ? number(actualFees[key])
    : fallback;
  const commission = override("commission", automaticCommission);
  const transfer = override("transfer", automaticTransfer);
  const stamp = override("stamp", automaticStamp);
  const overridden = ["commission", "transfer", "stamp"].filter((key) => Object.hasOwn(actualFees, key));
  return { amount, commission, transfer, stamp, total: commission + transfer + stamp, overridden };
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

export function matchActualTTrades(entries) {
  const tradesByDay = new Map();
  entries
    .filter((entry) => entry.valid && !entry.excludeFromT && (entry.type === "buy" || entry.type === "sell"))
    .forEach((entry) => {
      const day = tradingDateKey(entry.date);
      if (!tradesByDay.has(day)) tradesByDay.set(day, []);
      tradesByDay.get(day).push(entry);
    });

  const matches = [];
  for (const [day, dayTrades] of tradesByDay) {
    const lots = (type) => dayTrades
      .filter((entry) => entry.type === type)
      .sort((a, b) => new Date(a.date) - new Date(b.date) || String(a.id).localeCompare(String(b.id)))
      .map((entry) => ({ entry, remaining: number(entry.shares) }));
    const buys = lots("buy");
    const sells = lots("sell");
    let buyIndex = 0;
    let sellIndex = 0;

    while (buyIndex < buys.length && sellIndex < sells.length) {
      const buyLot = buys[buyIndex];
      const sellLot = sells[sellIndex];
      const shares = Math.min(buyLot.remaining, sellLot.remaining);
      const buyFeesPerShare = number(buyLot.entry.calculation?.fees?.total) / number(buyLot.entry.shares);
      const sellFeesPerShare = number(sellLot.entry.calculation?.fees?.total) / number(sellLot.entry.shares);
      const buyOutflow = (number(buyLot.entry.price) + buyFeesPerShare) * shares;
      const sellNet = (number(sellLot.entry.price) - sellFeesPerShare) * shares;
      const buyTime = new Date(buyLot.entry.date).getTime();
      const sellTime = new Date(sellLot.entry.date).getTime();
      const completionEntry = buyTime >= sellTime ? buyLot.entry : sellLot.entry;

      matches.push({
        id: `${day}:${buyLot.entry.id}:${sellLot.entry.id}`,
        day,
        shares,
        buyOperationId: buyLot.entry.id,
        sellOperationId: sellLot.entry.id,
        buyPrice: number(buyLot.entry.price),
        sellPrice: number(sellLot.entry.price),
        buyOutflow,
        sellNet,
        fees: (buyFeesPerShare + sellFeesPerShare) * shares,
        profit: sellNet - buyOutflow,
        mode: buyTime <= sellTime ? "buy-sell" : "sell-buy",
        completionEntryId: completionEntry.id,
        completionDate: completionEntry.date,
      });

      buyLot.remaining -= shares;
      sellLot.remaining -= shares;
      if (buyLot.remaining <= 0) buyIndex += 1;
      if (sellLot.remaining <= 0) sellIndex += 1;
    }
  }

  const summaries = [...matches.reduce((map, match) => {
    const summary = map.get(match.day) || {
      day: match.day,
      shares: 0,
      profit: 0,
      fees: 0,
      pairCount: 0,
      modes: new Set(),
      completionDate: match.completionDate,
      completionEntryId: match.completionEntryId,
    };
    summary.shares += match.shares;
    summary.profit += match.profit;
    summary.fees += match.fees;
    summary.pairCount += 1;
    summary.modes.add(match.mode);
    if (new Date(match.completionDate) >= new Date(summary.completionDate)) {
      summary.completionDate = match.completionDate;
      summary.completionEntryId = match.completionEntryId;
    }
    map.set(match.day, summary);
    return map;
  }, new Map()).values()].map((summary) => ({
    ...summary,
    mode: summary.modes.size === 1 ? [...summary.modes][0] : "mixed",
    modes: undefined,
  }));

  return { matches, summaries };
}

export function buildLedger(stock, operations, settings = DEFAULT_SETTINGS) {
  let shares = number(stock.openingShares);
  let costAmount = shares * number(stock.openingCost);
  let totalFees = 0;

  const sorted = [...operations].sort((a, b) => {
    const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
    return dateDiff || String(a.id).localeCompare(String(b.id));
  });

  const entries = sorted.map((operation) => {
    const beforeShares = shares;
    const beforeCost = shares > 0 ? costAmount / shares : 0;
    let calculation;

    const simulation = operation.type === "t";
    if (simulation) {
      calculation = calculateTSimulation(
        { shares, costAmount },
        operation,
        stock.code,
        settings,
      );
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
    const corrected = !simulation
      && calculation.valid
      && shares > 0
      && operation.correctedCost !== null
      && operation.correctedCost !== undefined
      && Number.isFinite(correctedCost);
    if (corrected) costAmount = correctedCost * shares;

    const afterCost = shares > 0 ? costAmount / shares : 0;

    return {
      ...operation,
      valid: calculation.valid,
      simulation,
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

  const tradeEntries = entries.filter((entry) => !entry.simulation);
  const simulationEntries = entries.filter((entry) => entry.simulation);
  const tMatching = matchActualTTrades(tradeEntries);

  return {
    shares,
    costAmount,
    cost: shares > 0 ? costAmount / shares : 0,
    totalFees,
    totalTProfit: tMatching.summaries.reduce((sum, summary) => sum + summary.profit, 0),
    tCount: tMatching.summaries.length,
    tMatches: tMatching.matches,
    tSummaries: tMatching.summaries,
    tradeEntries,
    simulationEntries,
    entries,
  };
}
