// Users, friendships, and the visibility checks that replace Supabase RLS.
// Friends-only is the default (decision 12); share tokens are the only
// public override and live in share.ts.

import type { DatabaseSync } from "node:sqlite";
import type { User } from "../../src/types/cosign.ts";

export function userById(db: DatabaseSync, id: string): User | null {
  return (db.prepare("SELECT * FROM users WHERE id = ?").get(id) as unknown as User) ?? null;
}

export function userByUsername(db: DatabaseSync, username: string): User | null {
  return (
    (db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username) as unknown as User) ?? null
  );
}

export function listUsers(db: DatabaseSync): User[] {
  return db.prepare("SELECT * FROM users ORDER BY created_at").all() as unknown as User[];
}

export function createUser(
  db: DatabaseSync,
  input: { username: string; display_name: string; school_id: string },
): User {
  // Usernames may contain '.', '_' and '-', which all collapse to '-' in a
  // slug — so "a.b" and "a-b" would fight over one id. Suffix on collision.
  const base = `u_${input.username.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  let id = base;
  for (let n = 2; userById(db, id); n++) id = `${base}-${n}`;
  db.prepare(
    "INSERT INTO users (id, username, display_name, school_id, avatar, taste_line, signature_order, created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(id, input.username, input.display_name, input.school_id, null, null, null, new Date().toISOString());
  return userById(db, id) as User;
}

/** Accepted friends of a user (both directions). */
export function friendIdsOf(db: DatabaseSync, userId: string): string[] {
  const rows = db
    .prepare(
      `SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END AS fid
       FROM friendships WHERE status = 'accepted' AND (user_id = ? OR friend_id = ?)`,
    )
    .all(userId, userId, userId) as unknown as Array<{ fid: string }>;
  return rows.map((r) => r.fid);
}

export function areFriends(db: DatabaseSync, a: string, b: string): boolean {
  if (a === b) return true;
  const row = db
    .prepare(
      `SELECT 1 AS x FROM friendships WHERE status = 'accepted'
       AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))`,
    )
    .get(a, b, b, a);
  return !!row;
}

/**
 * Can `viewer` (null = logged out) see a friends-visibility record owned by
 * `ownerId`? Owner and accepted friends only. Public records skip this.
 */
export function canViewFriendsOnly(db: DatabaseSync, viewerId: string | null, ownerId: string): boolean {
  if (!viewerId) return false;
  return viewerId === ownerId || areFriends(db, viewerId, ownerId);
}
