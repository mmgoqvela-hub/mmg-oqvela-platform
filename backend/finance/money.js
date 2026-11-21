// MMG OQVELA
// Exact money primitives. Currency codes and precision are supplied by the
// caller from versioned currency policy; this module makes no currency assumptions.

const MAX_SAFE_MINOR_UNITS = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_MINOR_UNIT_EXPONENT = 9;

function validateExponent(exponent) {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > MAX_MINOR_UNIT_EXPONENT) {
    throw new RangeError("Minor-unit exponent must be an integer between 0 and 9");
  }
}

function validateDecimalString(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 80) {
    throw new TypeError("Amount must be a decimal string");
  }
  if (value.trim() !== value || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new TypeError("Amount must use plain decimal notation without separators or exponent notation");
  }
}

/**
 * Convert a plain decimal string into an exact integer count of minor units.
 * Rejects excess fractional precision rather than silently rounding.
 *
 * The returned Number is guaranteed to be a safe JavaScript integer and can
 * therefore be bound to SQLite INTEGER without IEEE-754 precision loss.
 */
export function parseAmountToMinorUnits(value, exponent) {
  validateExponent(exponent);
  validateDecimalString(value);

  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  if (fraction.length > exponent) {
    throw new RangeError("Amount has more fractional digits than the configured currency precision");
  }

  const scale = 10n ** BigInt(exponent);
  const fractionalUnits = exponent === 0
    ? 0n
    : BigInt((fraction + "0".repeat(exponent)).slice(0, exponent));
  const absolute = BigInt(whole) * scale + fractionalUnits;
  const signed = negative ? -absolute : absolute;

  if (signed > MAX_SAFE_MINOR_UNITS || signed < -MAX_SAFE_MINOR_UNITS) {
    throw new RangeError("Amount exceeds the safe integer range");
  }
  return Number(signed);
}

/**
 * Format exact integer minor units using the supplied currency precision.
 * Output is fixed-width so persisted/displayed values are deterministic.
 */
export function formatMinorUnits(minorUnits, exponent) {
  validateExponent(exponent);
  let value;
  if (typeof minorUnits === "bigint") {
    value = minorUnits;
  } else if (typeof minorUnits === "number" && Number.isSafeInteger(minorUnits)) {
    value = BigInt(minorUnits);
  } else {
    throw new TypeError("Minor units must be a BigInt or a safe integer");
  }

  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(exponent);
  const whole = absolute / scale;
  if (exponent === 0) return (negative ? "-" : "") + whole.toString();

  const fraction = (absolute % scale).toString().padStart(exponent, "0");
  return (negative ? "-" : "") + whole.toString() + "." + fraction;
}
