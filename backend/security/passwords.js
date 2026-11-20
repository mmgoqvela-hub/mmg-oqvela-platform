// MMG OQVELA
// PBKDF2-SHA256 password hashing for Cloudflare Workers.

const ALGORITHM = "PBKDF2";
const HASH_NAME = "SHA-256";
const ITERATIONS = 310000;
const KEY_LENGTH = 256;

function toHex(bytes) {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex) {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) {
    throw new Error("Invalid hexadecimal data");
  }

  return new Uint8Array(
    hex.match(/.{2}/g).map(byte => parseInt(byte, 16))
  );
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }

  return difference === 0;
}

async function deriveHash(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    ALGORITHM,
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: ALGORITHM,
      hash: HASH_NAME,
      salt,
      iterations
    },
    keyMaterial,
    KEY_LENGTH
  );

  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 12) {
    throw new Error("Password must contain at least 12 characters");
  }

  if (password.length > 1024) {
    throw new Error("Password is too long");
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveHash(password, salt, ITERATIONS);

  return [
    "pbkdf2",
    HASH_NAME.toLowerCase(),
    ITERATIONS,
    toHex(salt),
    toHex(hash)
  ].join("$");
}

export async function verifyPassword(password, storedHash) {
  if (
    typeof password !== "string" ||
    typeof storedHash !== "string" ||
    password.length > 1024
  ) {
    return false;
  }

  try {
    const parts = storedHash.split("$");

    if (parts.length !== 5) return false;

    const [algorithm, hashName, iterationsText, saltHex, hashHex] = parts;
    const iterations = Number(iterationsText);

    if (
      algorithm !== "pbkdf2" ||
      hashName !== "sha-256" ||
      !Number.isSafeInteger(iterations) ||
      iterations < 100000 ||
      iterations > 1000000
    ) {
      return false;
    }

    const salt = fromHex(saltHex);
    const expectedHash = fromHex(hashHex);

    if (salt.length !== 16 || expectedHash.length !== 32) {
      return false;
    }

    const actualHash = await deriveHash(password, salt, iterations);

    return constantTimeEqual(actualHash, expectedHash);
  } catch {
    return false;
  }
}
