// Share tokens: the per-list/profile opt-in (decision 12). Unguessable,
// scoped to exactly one surface, revocable. Resolving a revoked token
// returns 'revoked' so the page can render a tombstone instead of content.

import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ShareToken } from "../../src/types/cosign.ts";

export type TokenResolution =
  | { status: "ok"; token: ShareToken }
  | { status: "revoked" }
  | { status: "missing" };

export function resolveToken(db: DatabaseSync, token: string): TokenResolution {
  const row = db.prepare("SELECT * FROM share_tokens WHERE token = ?").get(token) as
    | ShareToken
    | undefined;
  if (!row) return { status: "missing" };
  if (row.revoked_at) return { status: "revoked" };
  return { status: "ok", token: row };
}

export function tokensOf(db: DatabaseSync, userId: string): ShareToken[] {
  return db
    .prepare("SELECT * FROM share_tokens WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as unknown as ShareToken[];
}

export function createToken(
  db: DatabaseSync,
  input: { kind: "ranking" | "list" | "profile"; user_id: string; list_id?: string | null },
): ShareToken {
  const token = randomBytes(9).toString("base64url");
  db.prepare(
    "INSERT INTO share_tokens (token, kind, user_id, list_id, created_at, revoked_at) VALUES (?,?,?,?,?,NULL)",
  ).run(token, input.kind, input.user_id, input.list_id ?? null, new Date().toISOString());
  return db.prepare("SELECT * FROM share_tokens WHERE token = ?").get(token) as unknown as ShareToken;
}

/** Revoke; only the owner may. Returns false if not found / not owner. */
export function revokeToken(db: DatabaseSync, token: string, userId: string): boolean {
  const row = db.prepare("SELECT user_id FROM share_tokens WHERE token = ?").get(token) as
    | { user_id: string }
    | undefined;
  if (!row || row.user_id !== userId) return false;
  db.prepare("UPDATE share_tokens SET revoked_at = ? WHERE token = ?").run(new Date().toISOString(), token);
  return true;
}
