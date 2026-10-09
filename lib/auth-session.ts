import { createHash, createHmac, scryptSync, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "fio_session";
export const SESSION_SECONDS = 12 * 60 * 60;
export type AuthConfig = { username: string; password: string; secret: string; operator: string };
export type StoreUser = { userId: string; displayName: string };

export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig | null {
  const username = env.LOJA_ADMIN_USER?.trim();
  const password = env.LOJA_ADMIN_PASSWORD;
  const secret = env.LOJA_SESSION_SECRET;
  if (!username || username.length > 100 || !password || password.length < 12 || password.length > 256 || !secret || secret.length < 32) return null;
  return { username, password, secret, operator: env.LOJA_OPERATOR_NAME?.trim().slice(0, 100) || "Operador" };
}

const digest = (value: string) => createHash("sha256").update(value).digest();
function credentialVersion(config: AuthConfig) {
  return createHmac("sha256", config.secret).update(JSON.stringify([config.username, config.password])).digest("base64url");
}
export function credentialsMatch(username: unknown, password: unknown, config: AuthConfig): boolean {
  if (typeof username !== "string" || typeof password !== "string" || username.length > 100 || password.length > 256) return false;
  const expected = scryptSync(config.password, config.secret, 32);
  const supplied = scryptSync(password, config.secret, 32);
  return timingSafeEqual(digest(username.trim()), digest(config.username)) && timingSafeEqual(expected, supplied);
}
export function createSession(config: AuthConfig, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: config.username, cv: credentialVersion(config), iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + SESSION_SECONDS })).toString("base64url");
  return `${payload}.${createHmac("sha256", config.secret).update(payload).digest("base64url")}`;
}
export function verifySession(token: unknown, config: AuthConfig, now = Date.now()): StoreUser | null {
  if (typeof token !== "string" || token.length > 2000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [payload, signature] = token.split(".");
  const expected = createHmac("sha256", config.secret).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const seconds = Math.floor(now / 1000);
    if (data.v !== 1 || data.sub !== config.username || data.cv !== credentialVersion(config) || !Number.isSafeInteger(data.iat) || !Number.isSafeInteger(data.exp) || data.iat > seconds + 30 || data.exp <= seconds || data.exp - data.iat !== SESSION_SECONDS) return null;
    return { userId: `store:${config.username}`, displayName: config.operator };
  } catch { return null; }
}
