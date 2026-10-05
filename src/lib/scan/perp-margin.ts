export type PerpOrderConfig = {
  ticker: string;
  side: "bid" | "ask";
  contracts: number;
  price: number;
  leverage: number;
  takeProfit?: number;
  stopLoss?: number;
};

/** Collateral math. Kalshi does not accept this leverage number on the order. */
export function calculateMarginRequirement(price: number, count: number, leverage: number) {
  const notional = price * count;
  const clampedLeverage = Math.max(1, leverage);
  const requiredMargin = notional / clampedLeverage;
  const liquidationBufferPercent = (1 / clampedLeverage) * 0.85 * 100;
  return { notional, requiredMargin, liquidationBufferPercent };
}

/**
 * `order` is the body Kalshi accepts.
 * `triggers` is the desk's own note. It is not posted. Unknown fields get the order rejected.
 */
export function buildPerpBracketPayload(config: PerpOrderConfig, clientOrderId: string) {
  const { requiredMargin } = calculateMarginRequirement(config.price, config.contracts, config.leverage);
  return {
    order: {
      ticker: config.ticker,
      client_order_id: clientOrderId,
      side: config.side,
      count: config.contracts.toFixed(4),
      price: config.price.toFixed(4),
      time_in_force: "immediate_or_cancel" as const,
      self_trade_prevention_type: "taker_at_cross" as const,
      post_only: false,
    },
    triggers: {
      allocated_margin_dollars: requiredMargin.toFixed(2),
      effective_leverage: config.leverage.toFixed(1),
      take_profit_price: config.takeProfit ? config.takeProfit.toFixed(4) : null,
      stop_loss_price: config.stopLoss ? config.stopLoss.toFixed(4) : null,
    },
  };
}
