import test from "node:test";
import assert from "node:assert/strict";
import { calculateTierPriceMinorUnits, selectPricingTier } from "../../backend/finance/tier_pricing.js";

test("calculates cost plus percentage markup exactly", () => {
  assert.equal(calculateTierPriceMinorUnits(10000, 2500), 12500);
  assert.equal(calculateTierPriceMinorUnits(999, 1000), 1099);
  assert.equal(calculateTierPriceMinorUnits(10000n, 1500n), 11500);
});

test("rounds to the configured minor-unit increment using half-up rounding", () => {
  assert.equal(calculateTierPriceMinorUnits(1001, 0, 5), 1000);
  assert.equal(calculateTierPriceMinorUnits(1003, 0, 5), 1005);
  assert.equal(calculateTierPriceMinorUnits(1000, 1000, 10), 1100);
});

test("rejects invalid cost, margin, increment and unsafe results", () => {
  assert.throws(() => calculateTierPriceMinorUnits(-1, 1000), RangeError);
  assert.throws(() => calculateTierPriceMinorUnits(100, -1), RangeError);
  assert.throws(() => calculateTierPriceMinorUnits(100, 1000001), RangeError);
  assert.throws(() => calculateTierPriceMinorUnits(100, 1000, 0), RangeError);
  assert.throws(() => calculateTierPriceMinorUnits(Number.MAX_SAFE_INTEGER, 10000), RangeError);
});

test("selects the highest enabled quantity tier and requires configured margin", () => {
  const tiers = [
    { tier_code: "retail", min_quantity: 1, profit_margin_bps: 3000, is_enabled: 1 },
    { tier_code: "wholesale", min_quantity: 5, profit_margin_bps: 1800, is_enabled: 1 },
    { tier_code: "bulk_wholesale", min_quantity: 20, profit_margin_bps: 900, is_enabled: 1 }
  ];
  assert.equal(selectPricingTier(1, tiers).tier_code, "retail");
  assert.equal(selectPricingTier(5, tiers).tier_code, "wholesale");
  assert.equal(selectPricingTier(20, tiers).tier_code, "bulk_wholesale");
  assert.throws(() => selectPricingTier(0, tiers), RangeError);
  assert.throws(() => selectPricingTier(2, [
    { tier_code: "retail", min_quantity: 1, profit_margin_bps: null, is_enabled: 1 }
  ]), /no configured profit percentage/);
});
