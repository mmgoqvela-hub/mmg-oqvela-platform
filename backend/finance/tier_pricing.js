// Exact cost-plus pricing helpers. Margins are markups on cost, in basis points.
export function calculateTierPriceMinorUnits(costMinorUnits, profitMarginBps, roundingIncrementMinorUnits = 1) {
  const cost = typeof costMinorUnits === "bigint" ? costMinorUnits : BigInt(costMinorUnits);
  const margin = typeof profitMarginBps === "bigint" ? profitMarginBps : BigInt(profitMarginBps);
  const increment = typeof roundingIncrementMinorUnits === "bigint"
    ? roundingIncrementMinorUnits
    : BigInt(roundingIncrementMinorUnits);

  if (cost < 0n || margin < 0n || margin > 1000000n || increment < 1n) {
    throw new RangeError("Invalid cost, profit margin, or rounding increment");
  }

  // Half-up rounding to the currency's configured minor-unit increment.
  const numerator = cost * (10000n + margin);
  const denominator = 10000n * increment;
  const roundedUnits = (numerator + denominator / 2n) / denominator;
  const result = roundedUnits * increment;

  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Calculated price exceeds the safe integer range");
  }
  return Number(result);
}

export function selectPricingTier(quantity, tiers) {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError("Quantity must be a positive integer");
  }
  const enabled = (tiers || [])
    .filter(tier => tier?.is_enabled === 1 || tier?.is_enabled === true)
    .filter(tier => Number.isInteger(tier.min_quantity) && tier.min_quantity >= 1)
    .sort((a, b) => b.min_quantity - a.min_quantity);
  const selected = enabled.find(tier => quantity >= tier.min_quantity);
  if (!selected) throw new Error("No enabled pricing tier matches this quantity");
  if (!Number.isInteger(selected.profit_margin_bps) ||
      selected.profit_margin_bps < 0 || selected.profit_margin_bps > 1000000) {
    throw new Error("The selected pricing tier has no configured profit percentage");
  }
  return selected;
}
