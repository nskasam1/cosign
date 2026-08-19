// Typed client for the local Cosign server. Every request stays on this
// machine (Vite proxies /api to localhost:8787 in dev; same origin in prod).

import type {
  GroupSession,
  IntentTag,
  List,
  ListItem,
  Log,
  LogTaps,
  NoiseLevel,
  NotificationType,
  CrowdLevel,
  RankingEntry,
  SemesterPhase,
  ShareToken,
  Shop,
  ShopAmenities,
  ShopPhoto,
  TimeBucket,
  User,
} from "@/types/cosign";
import type { ConstraintKey as GroupConstraintKey } from "@/lib/group";
import type { CollabOrder } from "@/lib/collab";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    credentials: "same-origin",
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
  return body as T;
}

const post = <T,>(path: string, data?: unknown): Promise<T> =>
  req<T>(path, { method: "POST", body: data === undefined ? "{}" : JSON.stringify(data) });

// ── shapes the server returns ───────────────────────────────────────────────

export interface ShopSummary extends Shop {
  photo: string | null;
  open_now: boolean;
  stale: boolean;
  distance_m: number;
  walk_min: number;
  amenities: ShopAmenities | null;
}

export interface ShopDetail {
  shop: ShopSummary;
  hours: Array<{ day: number; open_min: number; close_min: number }>;
  photos: ShopPhoto[];
  intent_tallies: Array<{ intent_tag: IntentTag; tally: number }>;
  conditions: Partial<Record<TimeBucket, { noise: NoiseLevel | null; crowd: CrowdLevel | null; samples: number }>>;
  // Named cosigners are only the ones this viewer may see; `others` covers
  // the rest so the count stays honest without naming strangers.
  cosigners: {
    cosigners: Array<{
      user_id: string;
      username: string;
      display_name: string;
      avatar: string | null;
      position: number;
      is_friend: boolean;
    }>;
    others: number;
    total: number;
  };
  logs: Log[];
  /** The viewer's own last visit — its own query, so a busy shop's 30-log
   *  window cannot hide it. Null when logged out or never been. */
  your_last_visit: string | null;
}

/** The canonical ranking joined to its shops, each with its lead photo —
 *  the comparison screen judges a photograph against a photograph. */
export interface RankedEntry extends RankingEntry {
  shop: Shop & { photo: string | null };
}

export interface ProfileView {
  user: User;
  is_self: boolean;
  can_see_ranking: boolean;
  entries: Array<RankingEntry & { shop: Shop }>;
  logs_count: number;
}

// One definition of what a merged order is: the page reads the same shapes
// the server computed it with (src/lib/collab.ts).
export type { CollabRow } from "@/lib/collab";

export interface ListView {
  list: List;
  items: Array<ListItem & { shop: Shop & { photo: string | null } }>;
  editors: string[];
  can_edit: boolean;
  is_owner: boolean;
  /** `ranked` is how many of THIS list's places that person has put in order
   *  — a count about the list, never about their ordering. */
  contributors: Array<{ user_id: string; display_name: string; username: string; ranked: number }>;
  /** Computed for the reader and written nowhere: a list only moves when an
   *  editor says so, because a change nobody made has nobody to name. */
  derived: CollabOrder & { settled: boolean };
  last_rerank: { id: string; list_id: string; actor_id: string; moved: number; created_at: string } | null;
}

// ── the notification feed (brief #11) ───────────────────────────────────────

export interface FeedEntry {
  id: string;
  type: NotificationType;
  created_at: string;
  read_at: string | null;
  actor: { id: string; username: string; display_name: string; avatar: string | null };
  ref: { kind: string; id: string };
  /** Still asking the reader for something, read off the record every time. */
  needs_answer: boolean;
  subject: Record<string, unknown>;
}

export interface FriendsView {
  accepted: User[];
  incoming: Array<{ friendship_id: string; user: User; created_at: string }>;
  outgoing: Array<{ friendship_id: string; user: User; created_at: string }>;
}

// ── group decision mode (brief #8) ──────────────────────────────────────────

export interface GroupAnswerLine {
  shop_id: string;
  /** Empty unless the reader is a signed-in member of this session. The
   *  LENGTH of anybody's list is never sent — a denominator is the closest
   *  thing to a score this surface could print. */
  positions: Array<{ user_id: string; position: number }>;
  worst: { user_id: string; position: number } | null;
  coverage: number;
  never_been: string[];
}

export interface GroupView {
  session: GroupSession;
  starter: { id: string; username: string; display_name: string; avatar: string | null } | null;
  invited: number;
  state: "alone" | "partial" | "complete";
  /** The reader is a signed-in member, so `positions` are populated. */
  seated: boolean;
  answers: Array<{
    /** Opaque per-response seat id. The participant token — which is a write
     *  credential — never leaves the server. */
    seat: string;
    display_name: string | null;
    is_you: boolean;
    brings_a_list: boolean;
    intent_tag: IntentTag | null;
    outlets: boolean;
    open_now: boolean;
    wifi: boolean;
    max_noise: NoiseLevel | null;
  }>;
  constraints: Array<{ key: GroupConstraintKey; askedBy: string[]; detail: string }>;
  picks: GroupAnswerLine[];
  more: number;
  unknown_to_all: string[];
  unvouched: string[];
  ruled_out: Array<{ key: GroupConstraintKey; n: number }>;
  ruled_out_total: number;
  /** The arithmetic as a column that subtracts to the answer. */
  funnel: {
    total: number;
    steps: Array<{ key: GroupConstraintKey; detail: string; askedBy: string[]; removed: number; remaining: number }>;
    /** Would qualify, but nobody has logged how loud they get at this hour. */
    held: number;
    left: number;
  };
  /** Fails exactly one thing somebody asked for, and says which and whose. */
  one_need_away: Array<{ shop_id: string; key: GroupConstraintKey; detail: string; askedBy: string[] }>;
  /** What each need is worth — including the ones worth nothing. */
  costs: Array<{
    key: GroupConstraintKey;
    detail: string;
    askedBy: string[];
    unlocks: number;
    example: string | null;
  }>;
  costliest: { key: GroupConstraintKey; detail: string; unlocks: number } | null;
  /** Facts about the PLACE, never a restatement of what the group asked for. */
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
      noise: NoiseLevel | null;
      noise_samples: number;
    }
  >;
  members: Record<string, string>;
  resolved_shop_id: string | null;
}

/** One row of Home's list: the shop, why it is there, and how old it is. */
export interface DiscoverEntry extends ShopSummary {
  /** Lifted out of `amenities` because the hero query reads it directly. */
  outlet_count: number | null;
  closes_in_min: number | null;
  camp_ok: boolean;
  /** Friends (and you) with it in their list — the tier, not a tiebreak. */
  friend_count: number;
  friend_score: number;
  friend_sample: number;
  crowd_score: number;
  crowd_sample: number;
  /** The viewer's own position in their own ranking, if they have one. */
  you: number | null;
  /** Accepted friends only — never a stranger, even a public-ranking one. */
  friends: Array<{ username: string; display_name: string; avatar: string | null; position: number }>;
  others: number;
  cosign_total: number;
  age: { days: number | null; stale: boolean; label: string };
}

export interface DiscoverView {
  /** Echoed back, never stored — see the route's comment. */
  at: { lat: number; lng: number };
  phase: SemesterPhase;
  semester: string;
  hero: { mode: "usual" | "finals"; shop_id: string | null; matches: number };
  entries: DiscoverEntry[];
}

/**
 * One saved place from a Google Takeout export, matched against the places
 * Cosign knows. Note what this shape does NOT carry: the coordinate and the
 * address that were in the file. They are read on the server to tell two
 * places apart and then dropped — decision 12, no persistent location
 * history — and the response is the only part of that request that outlives
 * it, so the omission is structural rather than a promise.
 */
export interface TakeoutMatch {
  /** The name they saved it under, which may not be ours. */
  saved: string;
  note: string | null;
  kind: "certain" | "likely" | "unknown";
  because: string;
  distance_m: number | null;
  shop: { id: string; slug: string; name: string; palette: string | null; photo: string | null } | null;
}

export interface TakeoutReport {
  counts: { total: number; certain: number; likely: number; unknown: number };
  matches: TakeoutMatch[];
}

export interface Meta {
  schools: Array<{ id: string; name: string }>;
  semester: string;
  phase: SemesterPhase;
  campus_center: { lat: number; lng: number };
}

// ── api ─────────────────────────────────────────────────────────────────────

export const api = {
  me: () => req<{ user: User | null }>("/api/me"),
  meta: () => req<Meta>("/api/meta"),

  authUsers: () => req<{ users: User[]; dev_auth: boolean }>("/api/auth/users"),
  switchUser: (userId: string) => post<{ user: User }>("/api/auth/switch", { userId }),
  createUser: (input: { username: string; display_name: string; school_id?: string }) =>
    post<{ user: User }>("/api/auth/create", input),
  logout: () => post<{ ok: true }>("/api/auth/logout"),

  shops: () => req<{ shops: ShopSummary[] }>("/api/shops"),
  // The position is read momentarily and handed over for this one response;
  // the server stores none of it (decision 12).
  discover: (at?: { lat: number; lng: number }) =>
    req<DiscoverView>(at ? `/api/discover?lat=${at.lat}&lng=${at.lng}` : "/api/discover"),
  shop: (slugOrId: string) => req<ShopDetail>(`/api/shops/${encodeURIComponent(slugOrId)}`),
  verifyShop: (id: string) => post<{ ok: true }>(`/api/shops/${encodeURIComponent(id)}/verify`),
  searchPlaces: (q: string) => req<{ results: Shop[] }>(`/api/places/search?q=${encodeURIComponent(q)}`),

  myRanking: () => req<{ entries: RankedEntry[] }>("/api/rankings/me"),
  insertRanking: (input: {
    shop_id: string;
    position: number;
    comparisons: Array<{ winner_shop_id: string; loser_shop_id: string }>;
  }) => post<{ entries: RankingEntry[] }>("/api/rankings/insert", input),

  profile: (username: string) => req<ProfileView>(`/api/users/${encodeURIComponent(username)}`),

  createLog: (input: {
    shop_id: string;
    intent_tag: IntentTag;
    noise?: NoiseLevel | null;
    crowd?: CrowdLevel | null;
    taps?: LogTaps;
    line?: string | null;
    photo?: string | null;
  }) => post<{ log: Log }>("/api/logs", input),

  // The signed-in user's own logs, newest first — /rank reads it to offer a
  // resume path for a log whose insertion was abandoned.
  myLogs: () => req<{ logs: Log[] }>("/api/logs/mine"),

  // Posted as a data URL; the server sniffs the bytes and names the file, so
  // what comes back is the only path that may be sent as a log photo.
  uploadPhoto: (dataUrl: string) => post<{ path: string }>("/api/uploads", { data: dataUrl }),

  // The file's text, matched in memory and never written down.
  importTakeout: (files: string[]) => post<TakeoutReport>("/api/import/takeout", { files }),

  myLists: () => req<{ lists: List[] }>("/api/lists/mine"),
  list: (id: string) => req<ListView>(`/api/lists/${encodeURIComponent(id)}`),
  // `items` lands the whole list in one request: an import is eleven places
  // at once, and eleven round trips can leave half a list behind.
  createList: (input: {
    title: string;
    is_collaborative?: boolean;
    items?: Array<{ shop_id: string; note?: string | null }>;
  }) => post<{ list: List; items?: number }>("/api/lists", input),
  addListItem: (listId: string, shopId: string, note?: string) =>
    post<{ ok: true }>(`/api/lists/${encodeURIComponent(listId)}/items`, { shop_id: shopId, note }),
  removeListItem: (listId: string, shopId: string) =>
    req<{ ok: true }>(`/api/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(shopId)}`, {
      method: "DELETE",
    }),

  // Only the owner may hand over the pen, and only to an accepted friend —
  // the server enforces both (server/index.ts).
  addListEditor: (listId: string, username: string) =>
    post<{ ok: true }>(`/api/lists/${encodeURIComponent(listId)}/editors`, { username }),
  /** Put a collaborative list in the order its contributors' lists imply.
   *  409 when there is nothing to move: that is not an event. */
  rerankList: (listId: string) =>
    post<{ rerank: { id: string; moved: number } }>(`/api/lists/${encodeURIComponent(listId)}/rerank`),

  // ── people, and the five things they can do that reach you ───────────────
  friends: () => req<FriendsView>("/api/friends"),
  requestFriend: (username: string) => post<{ friendship: unknown }>("/api/friends/request", { username }),
  acceptFriend: (friendshipId: string) =>
    post<{ friendship: unknown }>(`/api/friends/${encodeURIComponent(friendshipId)}/accept`),

  notifications: () => req<{ entries: FeedEntry[] }>("/api/notifications"),
  markNotificationsRead: (ids: string[]) => post<{ read: number }>("/api/notifications/read", { ids }),

  // ── group mode ───────────────────────────────────────────────────────────
  // Reading and answering never require an account; starting and closing do.
  startGroup: (invite: string[]) => post<{ session: GroupSession }>("/api/group", { invite }),
  group: (id: string, opts: { at?: { lat: number; lng: number }; participantToken?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.at) {
      q.set("lat", String(opts.at.lat));
      q.set("lng", String(opts.at.lng));
    }
    if (opts.participantToken) q.set("pt", opts.participantToken);
    const query = q.toString();
    return req<GroupView>(`/api/group/${encodeURIComponent(id)}${query ? `?${query}` : ""}`);
  },
  submitGroupNeeds: (
    id: string,
    needs: {
      participant_token: string;
      display_name?: string | null;
      intent_tag?: IntentTag | null;
      outlets?: boolean;
      open_now?: boolean;
      wifi?: boolean;
      max_noise?: NoiseLevel | null;
    },
  ) => post<{ ok: true }>(`/api/group/${encodeURIComponent(id)}/needs`, needs),
  resolveGroup: (id: string, shopId: string | null) =>
    post<{ session: GroupSession }>(`/api/group/${encodeURIComponent(id)}/resolve`, { shop_id: shopId }),

  myShareTokens: () => req<{ tokens: ShareToken[] }>("/api/share/mine"),
  createShareToken: (input: { kind: "ranking" | "list" | "profile"; list_id?: string }) =>
    post<{ token: ShareToken }>("/api/share", input),
  revokeShareToken: (token: string) => post<{ ok: true }>(`/api/share/${encodeURIComponent(token)}/revoke`),
};
