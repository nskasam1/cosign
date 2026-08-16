// The canonical ordered ranking per user, its comparison audit log, and the
// rank aggregations. Crowd baseline = aggregated rank position derived from
// comparisons/list positions — never an averaged rating (decision 8).

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Comparison, RankingEntry } from "../../src/types/cosign.ts";
import { canViewFriendsOnly, friendIdsOf } from "./social.ts";

export function rankingOf(db: DatabaseSync, userId: string): RankingEntry[] {
  return db
    .prepare("SELECT * FROM ranking_entries WHERE user_id = ? ORDER BY position")
    .all(userId) as unknown as RankingEntry[];
}

export function rankedShopIds(db: DatabaseSync, userId: string): string[] {
  return rankingOf(db, userId).map((e) => e.shop_id);
}

/**
 * Insert a shop at a 1-based position, shifting the rest down, and persist
 * the better/worse taps that found the slot. One transaction: the list and
 * its audit log can't drift.
 */
export function insertIntoRanking(
  db: DatabaseSync,
  userId: string,
  shopId: string,
  position: number,
  comparisons: Array<Pick<Comparison, "winner_shop_id" | "loser_shop_id">>,
): void {
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    // Re-ranking an existing entry: pull it out first, then re-insert, so
    // PRIMARY KEY (user_id, shop_id) can't reject the whole insertion.
    const existing = db
      .prepare("SELECT position FROM ranking_entries WHERE user_id = ? AND shop_id = ?")
      .get(userId, shopId) as { position: number } | undefined;
    if (existing) {
      db.prepare("DELETE FROM ranking_entries WHERE user_id = ? AND shop_id = ?").run(userId, shopId);
      db.prepare(
        "UPDATE ranking_entries SET position = position - 1 WHERE user_id = ? AND position > ?",
      ).run(userId, existing.position);
    }
    // shift down from the end to keep UNIQUE(user_id, position) satisfied
    const tail = db
      .prepare(
        "SELECT shop_id, position FROM ranking_entries WHERE user_id = ? AND position >= ? ORDER BY position DESC",
      )
      .all(userId, position) as unknown as Array<{ shop_id: string; position: number }>;
    const bump = db.prepare(
      "UPDATE ranking_entries SET position = ? WHERE user_id = ? AND shop_id = ?",
    );
    for (const row of tail) bump.run(row.position + 1, userId, row.shop_id);
    db.prepare(
      "INSERT INTO ranking_entries (user_id, shop_id, position, inserted_at) VALUES (?,?,?,?)",
    ).run(userId, shopId, position, now);
    const insCmp = db.prepare(
      "INSERT INTO comparisons (id, user_id, winner_shop_id, loser_shop_id, context, created_at) VALUES (?,?,?,?,?,?)",
    );
    for (const c of comparisons) {
      insCmp.run(randomUUID(), userId, c.winner_shop_id, c.loser_shop_id, existing ? "reorder" : "insertion", now);
    }
    // The ranking's own row, in the same transaction as the entries it
    // describes. It carries visibility (decision 9) — without it a first-ever
    // insertion is friends-only only because no row says otherwise — and the
    // "last put in order" stamp the share page reads. The upsert touches
    // updated_at alone: a ranking already made public stays public.
    db.prepare(
      `INSERT INTO rankings (user_id, visibility, updated_at) VALUES (?, 'friends', ?)
         ON CONFLICT(user_id) DO UPDATE SET updated_at = excluded.updated_at`,
    ).run(userId, now);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export interface ShopScore {
  shop_id: string;
  score: number; // 0..1, higher = better-ranked
  sample: number; // how many rankings include it
}

/**
 * Crowd baseline: for each shop, the mean rank percentile across every
 * user's ordered list (1.0 = everyone's #1). Positions derive from
 * comparisons, so this is aggregated rank — no ratings involved.
 */
export function crowdScores(db: DatabaseSync): Map<string, ShopScore> {
  const rows = db
    .prepare(
      `SELECT re.shop_id, re.position, c.n
       FROM ranking_entries re
       JOIN (SELECT user_id, count(*) AS n FROM ranking_entries GROUP BY user_id) c
         ON c.user_id = re.user_id`,
    )
    .all() as unknown as Array<{ shop_id: string; position: number; n: number }>;
  return aggregate(rows);
}

/**
 * Friend-weighted scores for a viewer: friends' lists dominate (weight 3)
 * over the crowd (weight 1). Friends outrank the crowd — decision 8.
 */
export function friendWeightedScores(db: DatabaseSync, viewerId: string): Map<string, ShopScore> {
  const friends = new Set([viewerId, ...friendIdsOf(db, viewerId)]);
  const rows = db
    .prepare(
      `SELECT re.user_id, re.shop_id, re.position, c.n
       FROM ranking_entries re
       JOIN (SELECT user_id, count(*) AS n FROM ranking_entries GROUP BY user_id) c
         ON c.user_id = re.user_id`,
    )
    .all() as unknown as Array<{ user_id: string; shop_id: string; position: number; n: number }>;
  const weighted = rows.map((r) => ({
    shop_id: r.shop_id,
    position: r.position,
    n: r.n,
    weight: friends.has(r.user_id) ? 3 : 1,
  }));
  const byShop = new Map<string, ShopScore>();
  for (const r of weighted) {
    const pct = r.n === 1 ? 1 : 1 - (r.position - 1) / (r.n - 1);
    const cur = byShop.get(r.shop_id) ?? { shop_id: r.shop_id, score: 0, sample: 0 };
    // running weighted mean via accumulated weight in `sample`
    cur.score = (cur.score * cur.sample + pct * r.weight) / (cur.sample + r.weight);
    cur.sample += r.weight;
    byShop.set(r.shop_id, cur);
  }
  return byShop;
}

function aggregate(rows: Array<{ shop_id: string; position: number; n: number }>): Map<string, ShopScore> {
  const byShop = new Map<string, ShopScore>();
  for (const r of rows) {
    const pct = r.n === 1 ? 1 : 1 - (r.position - 1) / (r.n - 1);
    const cur = byShop.get(r.shop_id) ?? { shop_id: r.shop_id, score: 0, sample: 0 };
    cur.score = (cur.score * cur.sample + pct) / (cur.sample + 1);
    cur.sample += 1;
    byShop.set(r.shop_id, cur);
  }
  return byShop;
}

export interface Cosigner {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  position: number;
  is_friend: boolean;
}

/** Whether `viewer` may see `owner`'s canonical ranking (decision 9). */
export function canViewRanking(db: DatabaseSync, viewerId: string | null, ownerId: string): boolean {
  const row = db.prepare("SELECT visibility FROM rankings WHERE user_id = ?").get(ownerId) as
    | { visibility: string }
    | undefined;
  if (row?.visibility === "public") return true;
  return canViewFriendsOnly(db, viewerId, ownerId);
}

/**
 * Cosigners of a shop (decision 13): users whose canonical ranked lists
 * include it — friends of the viewer first, then others; each with the
 * position it holds in their list.
 *
 * Only rankings the viewer may actually see are named. `others` counts the
 * rest, so the shop page can still say how many people cosigned it without
 * leaking who they are or where it sits in a stranger's private list.
 */
export function cosignersOf(
  db: DatabaseSync,
  shopId: string,
  viewerId: string | null,
): { cosigners: Cosigner[]; others: number; total: number } {
  const rows = db
    .prepare(
      `SELECT re.user_id, u.username, u.display_name, u.avatar, re.position,
              coalesce(r.visibility, 'friends') AS visibility
       FROM ranking_entries re
       JOIN users u ON u.id = re.user_id
       LEFT JOIN rankings r ON r.user_id = re.user_id
       WHERE re.shop_id = ? ORDER BY re.position`,
    )
    .all(shopId) as unknown as Array<Cosigner & { visibility: string }>;
  const friends = viewerId ? new Set(friendIdsOf(db, viewerId)) : new Set<string>();
  const visible: Cosigner[] = [];
  let others = 0;
  for (const r of rows) {
    const isSelf = r.user_id === viewerId;
    const isFriend = friends.has(r.user_id);
    if (r.visibility === "public" || isSelf || isFriend) {
      const { visibility: _v, ...rest } = r;
      visible.push({ ...rest, is_friend: isFriend || isSelf });
    } else {
      others++;
    }
  }
  visible.sort((a, b) => Number(b.is_friend) - Number(a.is_friend) || a.position - b.position);
  return { cosigners: visible, others, total: rows.length };
}

export interface ShareCosigner {
  username: string;
  display_name: string;
  avatar: string | null;
  is_friend: boolean; // of the author, not of the (logged-out) reader
}

/**
 * Cosigners as the *public share page* may show them (decision 13, reconciled
 * with decision 12's friends-only default).
 *
 * There is no viewer to be friends with — the reader is logged out — so the
 * ordering axis is the author's friendships: their friends first, then
 * everyone else, each by the position the shop holds in that person's list.
 *
 * Naming is a separate question from ordering. The author consented to
 * publishing their own list; nobody else did. So only people whose ranking is
 * `public` are named, and the rest are counted. Otherwise one person sharing a
 * link would out every friend's friends-only list.
 */
export function cosignersForShare(
  db: DatabaseSync,
  shopId: string,
  authorId: string,
): { named: ShareCosigner[]; others: number; total: number } {
  const rows = db
    .prepare(
      `SELECT re.user_id, u.username, u.display_name, u.avatar, re.position,
              coalesce(r.visibility, 'friends') AS visibility
       FROM ranking_entries re
       JOIN users u ON u.id = re.user_id
       LEFT JOIN rankings r ON r.user_id = re.user_id
       WHERE re.shop_id = ? ORDER BY re.position`,
    )
    .all(shopId) as unknown as Array<{
    user_id: string;
    username: string;
    display_name: string;
    avatar: string | null;
    position: number;
    visibility: string;
  }>;
  const friends = new Set(friendIdsOf(db, authorId));
  const named: Array<ShareCosigner & { position: number }> = [];
  let others = 0;
  for (const r of rows) {
    if (r.user_id === authorId) continue; // the author is the list, not a cosigner of it
    if (r.visibility === "public") {
      named.push({
        username: r.username,
        display_name: r.display_name,
        avatar: r.avatar,
        is_friend: friends.has(r.user_id),
        position: r.position,
      });
    } else {
      others++;
    }
  }
  named.sort((a, b) => Number(b.is_friend) - Number(a.is_friend) || a.position - b.position);
  return {
    named: named.map(({ position: _p, ...rest }) => rest),
    others,
    total: rows.length,
  };
}
