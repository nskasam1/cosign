// Notifications (brief #11): only ever from a human action.
//
// This is the ONLY file in the product that inserts into `notifications` —
// `src/design/no-bait.test.ts` asserts that, because "no engagement bait" is
// worth nothing as a promise and everything as a bottleneck. There is no
// timer, no schedule, no digest and no batch job anywhere in the codebase
// that could reach this table; every function below takes the action record
// that justifies the row and is called from the route that writes it.
//
// A row carries no copy of its own. It points at the record — a friendship,
// a list_editors row, a list_reranks row, a group session — and `feedFor`
// renders from THAT. So a friend request that has since been accepted reads
// as accepted, and an action record that is gone takes its notification with
// it rather than leaving a sentence about something that no longer exists.

import type { DatabaseSync } from "node:sqlite";
import type { NotificationRef, NotificationType, User } from "../../src/types/cosign.ts";

let counter = 0;
function newId(): string {
  counter += 1;
  return `n_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

interface NotifyInput {
  /** Who is being told. Never the actor — the CHECK constraint agrees. */
  userId: string;
  /** Who did the thing. */
  actorId: string;
  type: NotificationType;
  refKind: NotificationRef;
  refId: string;
}

/**
 * Record that somebody did something to somebody. Idempotent by
 * (recipient, type, record): telling a person twice about one act is the
 * first inch of the slope this product does not step onto.
 *
 * Returns false when the row already existed or when the recipient is the
 * actor — nobody is notified of their own doing.
 */
export function notify(db: DatabaseSync, input: NotifyInput, now = new Date()): boolean {
  if (input.userId === input.actorId) return false;
  const res = db
    .prepare(
      `INSERT INTO notifications (id, user_id, actor_id, type, ref_kind, ref_id, created_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT (user_id, type, ref_kind, ref_id) DO NOTHING`,
    )
    .run(newId(), input.userId, input.actorId, input.type, input.refKind, input.refId, now.toISOString());
  return Number(res.changes) > 0;
}

export interface FeedEntry {
  id: string;
  type: NotificationType;
  created_at: string;
  read_at: string | null;
  actor: Pick<User, "id" | "username" | "display_name" | "avatar">;
  ref: { kind: NotificationRef; id: string };
  /**
   * True only while the record still needs something FROM THE READER — a
   * friend request nobody has answered, a group session the reader has not
   * told what they need. It is read off the record every time, never stored,
   * so answering somewhere else settles it here too.
   */
  needs_answer: boolean;
  /** Everything the sentence is built from, read from the action record. */
  subject: Record<string, unknown>;
}

interface Row {
  id: string;
  actor_id: string;
  type: NotificationType;
  ref_kind: NotificationRef;
  ref_id: string;
  created_at: string;
  read_at: string | null;
}

/**
 * The reader's own feed, newest first, rendered from the action records.
 *
 * A row whose record has disappeared is dropped rather than patched: an
 * un-friending, a deleted list or a cancelled session should take the
 * sentence about it with them.
 */
export function feedFor(db: DatabaseSync, userId: string, limit = 50): FeedEntry[] {
  const rows = db
    .prepare(
      `SELECT id, actor_id, type, ref_kind, ref_id, created_at, read_at
       FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(userId, limit) as unknown as Row[];

  const out: FeedEntry[] = [];
  for (const r of rows) {
    const actor = db
      .prepare("SELECT id, username, display_name, avatar FROM users WHERE id = ?")
      .get(r.actor_id) as unknown as FeedEntry["actor"] | undefined;
    if (!actor) continue;
    const resolved = resolve(db, userId, r);
    if (!resolved) continue;
    out.push({
      id: r.id,
      type: r.type,
      created_at: r.created_at,
      read_at: r.read_at,
      actor,
      ref: { kind: r.ref_kind, id: r.ref_id },
      ...resolved,
    });
  }
  return out;
}

function resolve(
  db: DatabaseSync,
  userId: string,
  r: Row,
): { needs_answer: boolean; subject: Record<string, unknown> } | null {
  switch (r.type) {
    case "friend_request":
    case "friend_accepted": {
      const f = db
        .prepare("SELECT id, user_id, friend_id, status, responded_at FROM friendships WHERE id = ?")
        .get(r.ref_id) as unknown as
        | { id: string; user_id: string; friend_id: string; status: string; responded_at: string | null }
        | undefined;
      if (!f) return null;
      return {
        // Only the person who was asked can answer, and only while it is
        // still pending. The row is the truth: accepting from the profile
        // page settles this line without touching the notification.
        needs_answer: r.type === "friend_request" && f.status === "pending" && f.friend_id === userId,
        subject: { friendship_id: f.id, status: f.status },
      };
    }
    case "list_editor_added": {
      // The record is the list_editors row keyed (list, the reader).
      const editor = db
        .prepare("SELECT added_at FROM list_editors WHERE list_id = ? AND user_id = ?")
        .get(r.ref_id, userId) as unknown as { added_at: string } | undefined;
      if (!editor) return null;
      const list = listSummary(db, r.ref_id);
      if (!list) return null;
      return { needs_answer: false, subject: { ...list, added_at: editor.added_at } };
    }
    case "list_reranked": {
      const rr = db
        .prepare("SELECT id, list_id, moved FROM list_reranks WHERE id = ?")
        .get(r.ref_id) as unknown as { id: string; list_id: string; moved: number } | undefined;
      if (!rr) return null;
      const list = listSummary(db, rr.list_id);
      if (!list) return null;
      return { needs_answer: false, subject: { ...list, rerank_id: rr.id, moved: rr.moved } };
    }
    case "group_invite": {
      const s = db
        .prepare("SELECT id, status, created_at FROM group_sessions WHERE id = ?")
        .get(r.ref_id) as unknown as { id: string; status: string } | undefined;
      if (!s) return null;
      const answered = (
        db.prepare("SELECT count(*) AS n FROM group_needs WHERE session_id = ?").get(s.id) as { n: number }
      ).n;
      const mine = db
        .prepare("SELECT 1 AS x FROM group_needs WHERE session_id = ? AND user_id = ?")
        .get(s.id, userId);
      return {
        // Still asking only while the session is open and the reader has not
        // said what they need. Answering it is what closes the ask.
        needs_answer: s.status === "open" && !mine,
        subject: { session_id: s.id, status: s.status, answered },
      };
    }
  }
}

function listSummary(db: DatabaseSync, listId: string): Record<string, unknown> | null {
  const l = db
    .prepare("SELECT id, title, is_collaborative FROM lists WHERE id = ?")
    .get(listId) as unknown as { id: string; title: string; is_collaborative: number } | undefined;
  return l ? { list_id: l.id, title: l.title, is_collaborative: !!l.is_collaborative } : null;
}

/**
 * Mark entries read. The reader's own act, and the only write anybody makes
 * to their own feed — there is no "clear all" that pretends the things did
 * not happen, and nothing is ever deleted here on a schedule.
 */
export function markRead(db: DatabaseSync, userId: string, ids: string[], now = new Date()): number {
  if (ids.length === 0) return 0;
  const stmt = db.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL");
  let n = 0;
  for (const id of ids) n += Number(stmt.run(now.toISOString(), id, userId).changes);
  return n;
}
