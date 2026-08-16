// Users, friendships, and the visibility checks that replace Supabase RLS.
// Friends-only is the default (decision 12); share tokens are the only
// public override and live in share.ts.

import type { DatabaseSync } from "node:sqlite";
import type { Friendship, User } from "../../src/types/cosign.ts";
import { notify } from "./notifications.ts";

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

// ── friendships as human actions (Phase 5B) ────────────────────────────────
//
// Asking somebody to be a friend, and answering, are two of the five things
// in this product that produce a notification. The write and the notification
// happen in the same function on purpose: the row IS what the notification
// points at, and a route that could do one without the other is a route that
// eventually does.

export function friendshipById(db: DatabaseSync, id: string): Friendship | null {
  return (db.prepare("SELECT * FROM friendships WHERE id = ?").get(id) as unknown as Friendship) ?? null;
}

export function friendshipBetween(db: DatabaseSync, a: string, b: string): Friendship | null {
  return (
    (db
      .prepare(
        `SELECT * FROM friendships
         WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
      )
      .get(a, b, b, a) as unknown as Friendship) ?? null
  );
}

/**
 * Ask. Returns the existing row unchanged when there already is one — asking
 * twice is not a second event, and the unique index on the pair says so too.
 */
export function requestFriendship(db: DatabaseSync, fromId: string, toId: string, now = new Date()): Friendship {
  const existing = friendshipBetween(db, fromId, toId);
  if (existing) return existing;
  const id = `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  db.prepare(
    "INSERT INTO friendships (id, user_id, friend_id, status, created_at, responded_at) VALUES (?,?,?,'pending',?,NULL)",
  ).run(id, fromId, toId, now.toISOString());
  const row = friendshipById(db, id)!;
  notify(db, { userId: toId, actorId: fromId, type: "friend_request", refKind: "friendship", refId: id }, now);
  return row;
}

/**
 * Answer. Only the person who was asked may — accepting a request addressed
 * to somebody else is exactly the kind of thing a screen can be persuaded to
 * offer and a route must not.
 */
export function acceptFriendship(
  db: DatabaseSync,
  friendshipId: string,
  userId: string,
  now = new Date(),
): Friendship | null {
  const f = friendshipById(db, friendshipId);
  if (!f || f.friend_id !== userId || f.status !== "pending") return null;
  db.prepare("UPDATE friendships SET status = 'accepted', responded_at = ? WHERE id = ?").run(
    now.toISOString(),
    friendshipId,
  );
  notify(
    db,
    { userId: f.user_id, actorId: userId, type: "friend_accepted", refKind: "friendship", refId: f.id },
    now,
  );
  return friendshipById(db, friendshipId);
}

export interface FriendshipsView {
  accepted: User[];
  /** Asked the viewer; only these can be accepted by the viewer. */
  incoming: Array<{ friendship_id: string; user: User; created_at: string }>;
  /** The viewer asked; nothing to do but wait. */
  outgoing: Array<{ friendship_id: string; user: User; created_at: string }>;
}

export function friendshipsOf(db: DatabaseSync, userId: string): FriendshipsView {
  const rows = db
    .prepare("SELECT * FROM friendships WHERE user_id = ? OR friend_id = ? ORDER BY created_at DESC")
    .all(userId, userId) as unknown as Friendship[];
  const view: FriendshipsView = { accepted: [], incoming: [], outgoing: [] };
  for (const f of rows) {
    const otherId = f.user_id === userId ? f.friend_id : f.user_id;
    const user = userById(db, otherId);
    if (!user) continue;
    if (f.status === "accepted") view.accepted.push(user);
    else if (f.friend_id === userId) {
      view.incoming.push({ friendship_id: f.id, user, created_at: f.created_at });
    } else view.outgoing.push({ friendship_id: f.id, user, created_at: f.created_at });
  }
  view.accepted.sort((a, b) => a.display_name.localeCompare(b.display_name));
  return view;
}
