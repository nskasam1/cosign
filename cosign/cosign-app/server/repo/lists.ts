// Thematic + collaborative lists. Friends-only by default; a share token is
// the only way a list becomes publicly reachable (share.ts).

import type { DatabaseSync } from "node:sqlite";
import type { List, ListItem, User } from "../../src/types/cosign.ts";
import { collabOrder, movesAnything, type CollabOrder, type Contributor } from "../../src/lib/collab.ts";
import { notify } from "./notifications.ts";
import { canViewFriendsOnly, userById } from "./social.ts";

interface ListRow extends Omit<List, "is_collaborative"> {
  is_collaborative: number;
}

function coerce(l: ListRow): List {
  return { ...l, is_collaborative: !!l.is_collaborative };
}

export function listById(db: DatabaseSync, id: string): List | null {
  const row = db.prepare("SELECT * FROM lists WHERE id = ?").get(id) as unknown as ListRow | undefined;
  return row ? coerce(row) : null;
}

export function itemsOf(db: DatabaseSync, listId: string): ListItem[] {
  return db
    .prepare("SELECT * FROM list_items WHERE list_id = ? ORDER BY position")
    .all(listId) as unknown as ListItem[];
}

export function editorsOf(db: DatabaseSync, listId: string): string[] {
  const rows = db
    .prepare("SELECT user_id FROM list_editors WHERE list_id = ?")
    .all(listId) as unknown as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
}

export function listsOwnedBy(db: DatabaseSync, userId: string): List[] {
  const rows = db
    .prepare("SELECT * FROM lists WHERE owner_id = ? ORDER BY created_at DESC")
    .all(userId) as unknown as ListRow[];
  return rows.map(coerce);
}

export function canViewList(db: DatabaseSync, viewerId: string | null, list: List): boolean {
  if (list.visibility === "public") return true;
  if (viewerId && editorsOf(db, list.id).includes(viewerId)) return true;
  return canViewFriendsOnly(db, viewerId, list.owner_id);
}

export function canEditList(db: DatabaseSync, userId: string, list: List): boolean {
  return list.owner_id === userId || editorsOf(db, list.id).includes(userId);
}

export function createList(
  db: DatabaseSync,
  input: { owner_id: string; title: string; is_collaborative?: boolean; visibility?: "friends" | "public" },
): List {
  const id = `l_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  db.prepare(
    "INSERT INTO lists (id, owner_id, title, is_collaborative, visibility, created_at) VALUES (?,?,?,?,?,?)",
  ).run(id, input.owner_id, input.title, input.is_collaborative ? 1 : 0, input.visibility ?? "friends", new Date().toISOString());
  return listById(db, id) as List;
}

export function addItem(db: DatabaseSync, listId: string, shopId: string, addedBy: string, note?: string): void {
  const max = db
    .prepare("SELECT coalesce(max(position), 0) AS m FROM list_items WHERE list_id = ?")
    .get(listId) as { m: number };
  db.prepare(
    "INSERT INTO list_items (list_id, shop_id, position, added_by, note, added_at) VALUES (?,?,?,?,?,?)",
  ).run(listId, shopId, max.m + 1, addedBy, note ?? null, new Date().toISOString());
}

export function removeItem(db: DatabaseSync, listId: string, shopId: string): void {
  db.prepare("DELETE FROM list_items WHERE list_id = ? AND shop_id = ?").run(listId, shopId);
}

// ── collaboration (Phase 5B, brief #8) ─────────────────────────────────────

/**
 * Everyone whose ordered list this one is allowed to be built from: the
 * owner and the editors, in that order. Nobody else — a collaborative list
 * is not a poll of the campus, and a stranger's ranking has no business
 * moving somebody's list around.
 */
export function contributorsOf(db: DatabaseSync, list: List): Contributor[] {
  const ids = [list.owner_id, ...editorsOf(db, list.id).filter((id) => id !== list.owner_id)];
  return ids.flatMap((user_id) => {
    const user = userById(db, user_id);
    if (!user) return [];
    const ranking = db
      .prepare("SELECT shop_id FROM ranking_entries WHERE user_id = ? ORDER BY position")
      .all(user_id) as unknown as Array<{ shop_id: string }>;
    return [{ user_id, display_name: user.display_name.split(" ")[0], ranking: ranking.map((r) => r.shop_id) }];
  });
}

export interface ListReRank {
  id: string;
  list_id: string;
  actor_id: string;
  moved: number;
  created_at: string;
}

export function lastRerank(db: DatabaseSync, listId: string): ListReRank | null {
  return (
    (db
      .prepare("SELECT * FROM list_reranks WHERE list_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(listId) as unknown as ListReRank) ?? null
  );
}

/** The order the contributors' own lists imply, without writing anything. */
export function derivedOrder(db: DatabaseSync, list: List): CollabOrder {
  return collabOrder(
    itemsOf(db, list.id).map((it) => ({ shop_id: it.shop_id, position: it.position, added_by: it.added_by })),
    contributorsOf(db, list),
  );
}

/** Already in the order its contributors imply — so there is nothing to do
 *  and nothing to tell anybody about. */
export function isSettled(db: DatabaseSync, list: List): boolean {
  const order = derivedOrder(db, list);
  if (order.source === "owner") return true;
  const items = itemsOf(db, list.id).map((it) => ({
    shop_id: it.shop_id,
    position: it.position,
    added_by: it.added_by,
  }));
  return !movesAnything(items, order);
}

/**
 * Put the list in the order its contributors' rankings imply, and tell the
 * other editors that somebody did.
 *
 * It is an act, not a recomputation on read. A list that quietly re-ordered
 * itself whenever somebody else ranked something would be a notification
 * with no human behind it — the one thing brief #11 forbids — and it would
 * also mean nobody could ever point at the order and say who made it.
 *
 * Returns null when there is nothing to do: fewer than two contributors have
 * ranked anything, or the derived order is the order already there. A
 * re-rank that moves nothing is not an event and must not notify anybody.
 */
export function rerank(db: DatabaseSync, list: List, actorId: string, now = new Date()): ListReRank | null {
  const items = itemsOf(db, list.id).map((it) => ({
    shop_id: it.shop_id,
    position: it.position,
    added_by: it.added_by,
  }));
  const order = derivedOrder(db, list);
  if (order.source !== "contributors" || !movesAnything(items, order)) return null;

  const next = [...order.ranked, ...order.unranked].map((r) => r.shop_id);
  const was = new Map(items.map((it) => [it.shop_id, it.position]));
  const moved = next.filter((id, i) => was.get(id) !== i + 1).length;
  if (moved === 0) return null;

  const id = `rr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  db.exec("BEGIN");
  try {
    // list_items is keyed (list, shop) with no unique on position, so the
    // rewrite needs no shuffling — but it is one transaction anyway: half a
    // re-order is a list nobody agreed to.
    const stmt = db.prepare("UPDATE list_items SET position = ? WHERE list_id = ? AND shop_id = ?");
    next.forEach((shopId, i) => stmt.run(i + 1, list.id, shopId));
    db.prepare(
      "INSERT INTO list_reranks (id, list_id, actor_id, moved, created_at) VALUES (?,?,?,?,?)",
    ).run(id, list.id, actorId, moved, now.toISOString());
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  // Everybody who can edit it, except whoever did it.
  for (const uid of [list.owner_id, ...editorsOf(db, list.id)]) {
    notify(db, { userId: uid, actorId, type: "list_reranked", refKind: "list_rerank", refId: id }, now);
  }
  return lastRerank(db, list.id);
}

/**
 * Hand somebody else the pen. Only the owner may — an editor who could add
 * editors is an unbounded list of people with write access to somebody
 * else's list, arrived at one invitation at a time.
 */
export function addEditor(
  db: DatabaseSync,
  list: List,
  userId: string,
  actorId: string,
  now = new Date(),
): boolean {
  if (actorId !== list.owner_id) return false;
  if (userId === list.owner_id) return false;
  if (editorsOf(db, list.id).includes(userId)) return false;
  db.prepare("INSERT INTO list_editors (list_id, user_id, added_at) VALUES (?,?,?)").run(
    list.id,
    userId,
    now.toISOString(),
  );
  notify(
    db,
    { userId, actorId, type: "list_editor_added", refKind: "list_editor", refId: list.id },
    now,
  );
  return true;
}

export function editorUsersOf(db: DatabaseSync, listId: string): User[] {
  return editorsOf(db, listId).flatMap((id) => {
    const u = userById(db, id);
    return u ? [u] : [];
  });
}
