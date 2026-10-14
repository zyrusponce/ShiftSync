import crypto from "node:crypto";

/** AES-256-GCM. Output: "v1." + base64url(iv | tag | ciphertext). */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}
export function decryptSecret(value: string, key: Buffer): string {
  if (!value.startsWith("v1.")) throw new Error("Unknown secret format");
  const raw = Buffer.from(value.slice(3), "base64url");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    raw.subarray(0, 12),
  );
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([
    decipher.update(raw.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}

/** A tamper-proof, expiring token for the OAuth `state` parameter. */
export function signState(
  payload: Record<string, unknown>,
  key: Buffer,
): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${mac}`;
}
export function verifyState<T extends { exp: number }>(
  token: string,
  key: Buffer,
  now = Date.now(),
): T | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = crypto.createHmac("sha256", key).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  // Node's decoder ignores the unused bits of the last character, so several
  // spellings decode to the same bytes. Only the canonical one is accepted.
  if (
    given.toString("base64url") !== mac ||
    given.length !== expected.length ||
    !crypto.timingSafeEqual(given, expected)
  )
    return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as T;
    return typeof payload.exp === "number" && payload.exp > now
      ? payload
      : null;
  } catch {
    return null;
  }
}
