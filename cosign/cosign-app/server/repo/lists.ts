// Thematic + collaborative lists. Friends-only by default; a share token is
// the only way a list becomes publicly reachable (share.ts).

import type { DatabaseSync } from "node:sqlite";
import type { List, ListItem } from "../../src/types/cosign.ts";
import { canViewFriendsOnly } from "./social.ts";

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
