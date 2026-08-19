// Signed-cookie session for the dev user-switcher (auth v1). HMAC-SHA256
// over "userId.expiry" with a machine-local secret generated on first run
// into server/data/ (gitignored) — no key ships in the repo, no external
// auth service exists. Share/profile pages never read this cookie.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../db/db.ts";

export const COOKIE_NAME = "cosign_session";
const SECRET_PATH = join(DATA_DIR, "cookie-secret.txt");
const THIRTY_DAYS_S = 30 * 24 * 60 * 60;

let _secret: Buffer | null = null;

function secret(): Buffer {
  if (_secret) return _secret;
  if (!existsSync(SECRET_PATH)) {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(SECRET_PATH, randomBytes(32).toString("hex"), { encoding: "utf-8" });
  }
  _secret = Buffer.from(readFileSync(SECRET_PATH, "utf-8").trim(), "hex");
  return _secret;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function makeSessionCookie(userId: string, nowS = Math.floor(Date.now() / 1000)): string {
  const exp = nowS + THIRTY_DAYS_S;
  const payload = `${userId}.${exp}`;
  const value = `${payload}.${sign(payload)}`;
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${THIRTY_DAYS_S}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Verify the cookie header value; returns the userId or null. */
export function verifySession(cookieHeader: string | undefined, nowS = Math.floor(Date.now() / 1000)): string | null {
  if (!cookieHeader) return null;
  const raw = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  const expected = sign(`${userId}.${expStr}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(expStr) < nowS) return null;
  return userId;
}
