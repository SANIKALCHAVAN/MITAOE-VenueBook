import crypto from "node:crypto";

const JWT_SECRET = process.env.JWT_SECRET || "mitaoe-venuebook-secret-key-prod-2026-auth-token";

/**
 * Hash a plain text password using scrypt with a random salt.
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString("hex")}`;
}

/**
 * Verify a plain text password against a stored salt:hash string.
 */
export function verifyPassword(password, storedCombined) {
  if (!storedCombined || !storedCombined.includes(":")) return false;
  const [salt, key] = storedCombined.split(":");
  const keyBuffer = Buffer.from(key, "hex");
  const derivedKeyBuffer = crypto.scryptSync(password, salt, 64);
  if (keyBuffer.length !== derivedKeyBuffer.length) return false;
  return crypto.timingSafeEqual(keyBuffer, derivedKeyBuffer);
}

/**
 * Generate a cryptographically signed HMAC-SHA256 JWT token.
 */
export function signJwt(payload, expiresInSeconds = 86400) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSeconds };

  const b64Header = Buffer.from(JSON.stringify(header)).toString("base64url");
  const b64Payload = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${b64Header}.${b64Payload}`)
    .digest("base64url");

  return `${b64Header}.${b64Payload}.${signature}`;
}

/**
 * Verify and decode an HMAC-SHA256 JWT token.
 * Returns decoded payload if valid, or null if invalid or expired.
 */
export function verifyJwt(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [b64Header, b64Payload, signature] = parts;
  const expectedSig = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${b64Header}.${b64Payload}`)
    .digest("base64url");

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(b64Payload, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null; // Expired
    }
    return payload;
  } catch {
    return null;
  }
}
