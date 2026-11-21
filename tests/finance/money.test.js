import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAmountToMinorUnits,
  formatMinorUnits
} from "../../backend/finance/money.js";

test("parses decimal strings exactly using caller-supplied precision", () => {
  assert.equal(parseAmountToMinorUnits("12.34", 2), 1234);
  assert.equal(parseAmountToMinorUnits("12", 2), 1200);
  assert.equal(parseAmountToMinorUnits("0.0007", 4), 7);
  assert.equal(parseAmountToMinorUnits("-4.2", 2), -420);
  assert.equal(parseAmountToMinorUnits("900", 0), 900);
  assert.equal(parseAmountToMinorUnits("-0.00", 2), 0);
});

test("formats integer minor units deterministically", () => {
  assert.equal(formatMinorUnits(1234, 2), "12.34");
  assert.equal(formatMinorUnits(-420, 2), "-4.20");
  assert.equal(formatMinorUnits(7n, 4), "0.0007");
  assert.equal(formatMinorUnits(900, 0), "900");
});

test("does not silently round excess fractional precision", () => {
  assert.throws(() => parseAmountToMinorUnits("1.234", 2), RangeError);
  assert.throws(() => parseAmountToMinorUnits("1.1", 0), RangeError);
});

test("rejects floating-point inputs and ambiguous decimal syntax", () => {
  for (const value of [1.25, "", " 1.00", "1.00 ", "01.00", "+1.00", "1e2", "1,000.00", ".50"]) {
    assert.throws(() => parseAmountToMinorUnits(value, 2));
  }
});

test("rejects unsafe values and invalid precision", () => {
  assert.throws(() => parseAmountToMinorUnits("90071992547409.92", 2), RangeError);
  assert.throws(() => parseAmountToMinorUnits("1.00", -1), RangeError);
  assert.throws(() => parseAmountToMinorUnits("1.00", 10), RangeError);
  assert.throws(() => formatMinorUnits(1.5, 2), TypeError);
});
