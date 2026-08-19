// Group decision mode (brief #8, decision 8): the persistence and the reads
// behind src/lib/group.ts, which owns the actual reasoning.
//
// Two properties this file exists to keep true:
//   * a participant needs no account. Identity is an anonymous browser token
//     (src/lib/participantToken.ts); signing in only adds a ranked list to
//     the arithmetic, it is never the price of answering.
//   * the position is an ARGUMENT, like everywhere else. It arrives on the
//     request, is used to compute a walk for this one response, and is
//     written nowhere (decision 12 — no persistent location history).

import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AcademicCalendar } from "../../src/lib/calendar.ts";
import { CAMPUS_CENTER, haversineMeters, walkingMinutes, type LatLng } from "../../src/lib/geo.ts";
import { timeBucketForHour } from "../../src/lib/timeBucket.ts";
import {
  MAX_PARTICIPANTS,
  funnel,
  intersect,
  oneNeedAway,
  priceOfEachNeed,
  sessionState,
  type ConstraintKey,
  type FunnelStep,
  type GroupAnswer,
  type GroupNeed,
  type GroupPlace,
  type SessionState,
} from "../../src/lib/group.ts";
import type { GroupSession, IntentTag, NoiseLevel, User } from "../../src/types/cosign.ts";
import { localDayMinute } from "../lib/hours.ts";
import { notify } from "./notifications.ts";
import * as shops from "./shops.ts";
import { areFriends, userById } from "./social.ts";

interface NeedRow {
  session_id: string;
  participant_token: string;
  user_id: string | null;
  display_name: string | null;
  intent_tag: IntentTag | null;
  need_outlets: number;
  need_open_now: number;
  need_wifi: number;
  max_noise: NoiseLevel | null;
  created_at: string;
}

export function sessionById(db: DatabaseSync, id: string): GroupSession | null {
  return (db.prepare("SELECT * FROM group_sessions WHERE id = ?").get(id) as unknown as GroupSession) ?? null;
}

export function needRowsOf(db: DatabaseSync, sessionId: string): NeedRow[] {
  return db
    .prepare("SELECT * FROM group_needs WHERE session_id = ? ORDER BY created_at, participant_token")
    .all(sessionId) as unknown as NeedRow[];
}

function toNeed(r: NeedRow): GroupNeed {
  return {
    participant: r.participant_token,
    display_name: r.display_name,
    user_id: r.user_id,
    intent_tag: r.intent_tag,
    outlets: !!r.need_outlets,
    open_now: !!r.need_open_now,
    wifi: !!r.need_wifi,
    max_noise: r.max_noise,
  };
}

/**
 * How many people were asked: whoever started it, plus everyone who got a
 * group_invite for this session. The invitation notification IS the record
 * of the asking — there is no second table saying the same thing twice.
 */
export function invitedCount(db: DatabaseSync, sessionId: string): number {
  const row = db
    .prepare(
      "SELECT count(*) AS n FROM notifications WHERE type = 'group_invite' AND ref_kind = 'group_session' AND ref_id = ?",
    )
    .get(sessionId) as { n: number };
  return Math.min(row.n + 1, MAX_PARTICIPANTS);
}

/**
 * A session id is a LINK, so it is a token: unguessable, url-safe, and
 * carrying no timestamp. It is addressed exactly the way a share token is
 * (decision 4) — anybody who holds it can sit down, which is the whole point
 * and also the reason it must not be enumerable.
 */
function newSessionToken(): string {
  return `g_${randomBytes(12).toString("base64url")}`;
}

export function createSession(
  db: DatabaseSync,
  input: { createdBy: string; schoolId: string; invite: string[] },
  now = new Date(),
): GroupSession {
  const id = newSessionToken();
  db.prepare(
    "INSERT INTO group_sessions (id, created_by, school_id, status, resolved_shop_id, created_at) VALUES (?,?,?,'open',NULL,?)",
  ).run(id, input.createdBy, input.schoolId, now.toISOString());
  // "A friend asked" — one of the five human actions that notify. Capped at
  // the party size: a session cannot be used to message the whole campus.
  for (const uid of input.invite.slice(0, MAX_PARTICIPANTS - 1)) {
    notify(db, { userId: uid, actorId: input.createdBy, type: "group_invite", refKind: "group_session", refId: id }, now);
  }
  return sessionById(db, id)!;
}

export interface NeedsInput {
  participantToken: string;
  userId: string | null;
  displayName: string | null;
  intentTag: IntentTag | null;
  outlets: boolean;
  openNow: boolean;
  wifi: boolean;
  maxNoise: NoiseLevel | null;
}

/**
 * Say what you need. Changing your mind replaces your own answer and nobody
 * else's — the row is keyed by the participant, and a signed-in person holds
 * exactly one seat however many tabs they open (the partial unique index).
 *
 * Returns false when the table is full and this is a new face.
 */
export function submitNeeds(
  db: DatabaseSync,
  sessionId: string,
  input: NeedsInput,
  now = new Date(),
): boolean {
  const rows = needRowsOf(db, sessionId);
  const byToken = rows.find((r) => r.participant_token === input.participantToken);
  const byUser = input.userId ? rows.find((r) => r.user_id === input.userId) : undefined;
  // Somebody who answered anonymously on one device and signed in on another
  // has TWO rows, and stamping their user_id onto the anonymous one collides
  // with the partial unique index — which used to be a 500 and left that
  // browser permanently unable to answer. One person is one seat: the
  // account's row wins and the anonymous one is folded into it.
  if (byToken && byUser && byToken.participant_token !== byUser.participant_token) {
    db.prepare("DELETE FROM group_needs WHERE session_id = ? AND participant_token = ?").run(
      sessionId,
      byToken.participant_token,
    );
  }
  const mine = byUser ?? byToken;
  if (!mine && rows.length >= MAX_PARTICIPANTS) return false;
  db.prepare(
    `INSERT INTO group_needs
       (session_id, participant_token, user_id, display_name, intent_tag,
        need_outlets, need_open_now, need_wifi, max_noise, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (session_id, participant_token) DO UPDATE SET
       user_id = excluded.user_id,
       display_name = excluded.display_name,
       intent_tag = excluded.intent_tag,
       need_outlets = excluded.need_outlets,
       need_open_now = excluded.need_open_now,
       need_wifi = excluded.need_wifi,
       max_noise = excluded.max_noise`,
  ).run(
    sessionId,
    mine?.participant_token ?? input.participantToken,
    input.userId,
    input.displayName,
    input.intentTag,
    input.outlets ? 1 : 0,
    input.openNow ? 1 : 0,
    input.wifi ? 1 : 0,
    input.maxNoise,
    (mine?.created_at ?? now.toISOString()),
  );
  return true;
}

/**
 * Somebody says where they are going. It closes the session rather than
 * "winning" it: the answer was already computed, and this records that a
 * person agreed with it (or overrode it), which is the only thing a group of
 * four actually decides.
 */
export function resolveSession(
  db: DatabaseSync,
  sessionId: string,
  userId: string,
  shopId: string | null,
): GroupSession | null {
  const s = sessionById(db, sessionId);
  if (!s || s.status !== "open" || s.created_by !== userId) return null;
  db.prepare("UPDATE group_sessions SET status = 'resolved', resolved_shop_id = ? WHERE id = ?").run(
    shopId,
    sessionId,
  );
  return sessionById(db, sessionId);
}

/**
 * How many survivors the answer names, and therefore how many places' worth
 * of anybody's ordering a link-holder can read.
 *
 * Answering a session puts your ordered list into THAT ROOM's arithmetic —
 * which is consent, and is what makes the answer worth anything — but a
 * session with nobody tapping any constraint would otherwise pass every
 * place, and the page would hand whoever holds the link four people's entire
 * rankings. Six is what the screen shows; the rest is a count.
 */
export const MAX_SHOWN = 6;

export interface ShownPick {
  shop_id: string;
  /**
   * Where each member of THIS session has it — and only for a viewer who is
   * themself a signed-in member. A by-link seat is anonymous: it contributes
   * needs, it sees the answer and the arithmetic, and it never sees a
   * position, because `rankings.visibility` defaults to friends and sitting
   * at a table is not a friendship.
   *
   * The LENGTH of anybody's list is never sent to anybody. "Maya 21st of 22"
   * is a position and a denominator, and a denominator is the closest thing
   * to a score this surface could print.
   */
  positions: Array<{ user_id: string; position: number }>;
  worst: { user_id: string; position: number } | null;
  /** How many of the members have it in their list. Safe for everyone. */
  coverage: number;
  /** Members who answered and have never ranked it. Names only. */
  never_been: string[];
}

export interface GroupView {
  session: GroupSession;
  starter: Pick<User, "id" | "username" | "display_name" | "avatar"> | null;
  invited: number;
  state: SessionState;
  /** The viewer is a signed-in member, so positions are on this payload. */
  seated: boolean;
  /** One line per person who has answered, in arrival order. */
  answers: Array<{
    /**
     * An opaque per-response seat id — NEVER the participant token.
     *
     * The token is the seat's only write credential: anybody holding it can
     * replace that person's answer, and `POST .../needs` takes no auth by
     * design. Publishing it to every reader of a public link meant a
     * link-holder could overwrite a signed-in friend's answer under her name,
     * null her `user_id` (which silently dropped her ranked list out of the
     * arithmetic and changed the group's answer), and step past the
     * four-seat cap. This id is enough for a React key and for joining
     * `constraints[].askedBy` back to a seat, which is all the client used it
     * for; whether the reader owns a seat is `is_you`, computed here.
     */
    seat: string;
    display_name: string | null;
    /** True for the participant this request is from — the only one they may edit. */
    is_you: boolean;
    brings_a_list: boolean;
    intent_tag: IntentTag | null;
    outlets: boolean;
    open_now: boolean;
    wifi: boolean;
    max_noise: NoiseLevel | null;
  }>;
  /** The constraints the needs union into, in the order they are printed. */
  constraints: GroupAnswer["constraints"];
  /** Best first, capped at MAX_SHOWN. */
  picks: ShownPick[];
  /** Survivors past the cap — a number, never a list. */
  more: number;
  /** Fits everything, nobody in the room has ever ranked it. */
  unknown_to_all: string[];
  /** Would fit, but nobody has logged how loud it gets at this hour. */
  unvouched: string[];
  /** How many places each constraint is on its own responsible for losing. */
  ruled_out: Array<{ key: GroupAnswer["constraints"][number]["key"]; n: number }>;
  ruled_out_total: number;
  /** The same arithmetic as a column that subtracts to the answer. */
  funnel: { total: number; steps: FunnelStep[]; held: number; left: number };
  /** Fails exactly one thing somebody asked for, and says which and whose. */
  one_need_away: Array<{ shop_id: string; key: ConstraintKey; detail: string; askedBy: string[] }>;
  /** What each need is worth, including the ones worth nothing. */
  costs: Array<{ key: ConstraintKey; detail: string; askedBy: string[]; unlocks: number; example: string | null }>;
  costliest: GroupAnswer["costliest"];
  /** Shop id → what the page needs to print about it. Facts about the PLACE,
   *  never a restatement of what the group asked for. */
  places: Record<
    string,
    {
      name: string;
      slug: string;
      palette: string | null;
      photo: string | null;
      walk_min: number;
      outlet_count: number | null;
      wifi_mbps: number | null;
      closes_in_min: number | null;
      noise: string | null;
      noise_samples: number;
    }
  >;
  /** Whose lists are in the arithmetic, first names only. */
  members: Record<string, string>;
  resolved_shop_id: string | null;
}

/**
 * Everything the group page reads, computed for this instant and this
 * position. Nothing here is cached and nothing is written.
 */
/**
 * May this signed-in person take a seat? Every signed-in member has to be an
 * accepted friend of every OTHER signed-in member, not merely of whoever
 * started it — otherwise a host with two friends who do not know each other
 * puts each of their rankings in front of the other, and a group session
 * becomes a way to introduce two private lists.
 */
export function mayJoin(db: DatabaseSync, sessionId: string, userId: string): boolean {
  const session = sessionById(db, sessionId);
  if (!session) return false;
  // The host counts even before answering — `server/db/seed.ts` has always
  // written the invariant that way. Without them, the FIRST signed-in arrival
  // passed vacuously, and somebody the host has not agreed to know could take
  // a seat and lock the host out of the table started in their own name.
  const others = new Set<string>([session.created_by]);
  for (const r of needRowsOf(db, sessionId)) if (r.user_id) others.add(r.user_id);
  others.delete(userId);
  return [...others].every((id) => areFriends(db, userId, id));
}

export function sessionView(
  db: DatabaseSync,
  calendar: AcademicCalendar,
  sessionId: string,
  opts: { now?: Date; at?: LatLng; participantToken?: string | null; viewerId?: string | null } = {},
): GroupView | null {
  const session = sessionById(db, sessionId);
  if (!session) return null;
  const now = opts.now ?? new Date();
  const at = opts.at ?? CAMPUS_CENTER;

  const rows = needRowsOf(db, sessionId);
  const needs = rows.map(toNeed);
  const memberIds = needs.map((n) => n.user_id).filter((id): id is string => !!id);
  // Positions are for the people at the table, and only the ones who are
  // signed in — everybody else reads the answer without reading anybody's
  // ranked list (see ShownPick, and PLAN's Phase 5B decision on scope).
  const seated = !!opts.viewerId && memberIds.includes(opts.viewerId);

  const { minute } = localDayMinute(now, calendar.timezone);
  const bucket = timeBucketForHour(Math.floor(minute / 60));

  const positionsOf = new Map<string, Array<{ user_id: string; position: number; of: number }>>();
  const withAList = new Set<string>();
  for (const uid of memberIds) {
    const entries = db
      .prepare("SELECT shop_id, position FROM ranking_entries WHERE user_id = ? ORDER BY position")
      .all(uid) as unknown as Array<{ shop_id: string; position: number }>;
    if (entries.length > 0) withAList.add(uid);
    for (const e of entries) {
      const list = positionsOf.get(e.shop_id) ?? [];
      list.push({ user_id: uid, position: e.position, of: entries.length });
      positionsOf.set(e.shop_id, list);
    }
  }

  const places: GroupPlace[] = shops.allShops(db, session.school_id).map((s) => {
    const a = shops.amenitiesOf(db, s.id);
    const conditions = shops.conditionsByBucket(db, s.id)[bucket];
    const distance = haversineMeters(at, s);
    return {
      id: s.id,
      name: s.name,
      open_now: shops.isShopOpen(db, s.id, now, calendar.timezone),
      outlet_count: a?.outlet_count ?? null,
      wifi_mbps: a?.wifi_mbps ?? null,
      table_size: a?.table_size ?? null,
      // What people logged HERE, at THIS time of day. Absent is absent.
      noise: conditions?.noise ?? null,
      noise_samples: conditions?.samples ?? 0,
      walk_min: walkingMinutes(distance),
      positions: positionsOf.get(s.id) ?? [],
    };
  });

  const answer = intersect(needs, places);
  const invited = invitedCount(db, sessionId);
  const starter = userById(db, session.created_by);

  const named: GroupView["places"] = {};
  for (const s of shops.allShops(db, session.school_id)) {
    const p = places.find((x) => x.id === s.id)!;
    named[s.id] = {
      name: s.name,
      slug: s.slug,
      palette: s.palette,
      photo: shops.photosOf(db, s.id)[0]?.path ?? null,
      walk_min: p.walk_min,
      outlet_count: p.outlet_count,
      wifi_mbps: p.wifi_mbps,
      closes_in_min: shops.shopClosesIn(db, s.id, now, calendar.timezone),
      noise: p.noise,
      noise_samples: p.noise_samples,
    };
  }

  const members: Record<string, string> = {};
  for (const uid of memberIds) {
    const u = userById(db, uid);
    if (u) members[uid] = u.display_name.split(" ")[0];
  }

  const byKey = new Map<string, number>();
  for (const r of answer.ruledOut) for (const k of r.failed) byKey.set(k, (byKey.get(k) ?? 0) + 1);

  // Seats are numbered in arrival order; the tokens never leave the server.
  const seatOf = new Map(rows.map((r, i) => [r.participant_token, `seat-${i + 1}`]));
  const seats = (tokens: string[]) => tokens.flatMap((t) => (seatOf.has(t) ? [seatOf.get(t)!] : []));

  return {
    session,
    starter: starter && {
      id: starter.id,
      username: starter.username,
      display_name: starter.display_name,
      avatar: starter.avatar,
    },
    invited,
    state: sessionState(needs.length, invited),
    seated,
    answers: rows.map((r) => ({
      seat: seatOf.get(r.participant_token)!,
      display_name: r.display_name,
      // Whoever is reading this — by their browser's token, or by their
      // account, because a person who answered on their phone and opened it
      // on a laptop has still answered.
      is_you:
        (!!opts.participantToken && r.participant_token === opts.participantToken) ||
        (!!opts.viewerId && r.user_id === opts.viewerId),
      // Signing in is not the price of answering — it only means this
      // person's own ordered list is in the arithmetic.
      brings_a_list: !!r.user_id && withAList.has(r.user_id),
      intent_tag: r.intent_tag,
      outlets: !!r.need_outlets,
      open_now: !!r.need_open_now,
      wifi: !!r.need_wifi,
      max_noise: r.max_noise,
    })),
    constraints: answer.constraints.map((c) => ({ ...c, askedBy: seats(c.askedBy) })),
    picks: answer.picks.slice(0, MAX_SHOWN).map((p) => ({
      shop_id: p.place.id,
      // A by-link seat gets the count and no positions (see ShownPick).
      positions: seated ? p.place.positions.map(({ user_id, position }) => ({ user_id, position })) : [],
      worst: seated && p.worst ? { user_id: p.worst.user_id, position: p.worst.position } : null,
      coverage: p.coverage,
      never_been: seated
        ? memberIds
            .filter((uid) => withAList.has(uid) && !p.place.positions.some((x) => x.user_id === uid))
            .map((uid) => members[uid] ?? uid)
        : [],
    })),
    more: Math.max(0, answer.picks.length - MAX_SHOWN),
    unknown_to_all: answer.unknownToAll.slice(0, MAX_SHOWN).map((p) => p.id),
    unvouched: answer.unvouched.slice(0, MAX_SHOWN).map((p) => p.id),
    ruled_out: [...byKey.entries()]
      .map(([key, n]) => ({ key: key as GroupAnswer["constraints"][number]["key"], n }))
      .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key)),
    ruled_out_total: answer.ruledOut.length,
    // EVERY askedBy is mapped through `seats` — the constraint list, the
    // ledger, the near-misses and the prices all carry the same field, and
    // three of the four were still shipping raw participant tokens after the
    // first pass. A partial redaction is not one.
    funnel: (() => {
      const f = funnel(needs, places);
      return { ...f, steps: f.steps.map((st) => ({ ...st, askedBy: seats(st.askedBy) })) };
    })(),
    one_need_away: oneNeedAway(answer)
      .slice(0, 3)
      .map((n) => {
        const c = answer.constraints.find((x) => x.key === n.key)!;
        return { shop_id: n.place.id, key: n.key, detail: c.detail, askedBy: seats(c.askedBy) };
      }),
    costs: priceOfEachNeed(needs, places).map((c) => ({
      ...c,
      askedBy: seats(c.askedBy),
      example: c.example?.id ?? null,
    })),
    costliest: answer.costliest,
    places: named,
    members,
    resolved_shop_id: session.resolved_shop_id,
  };
}
