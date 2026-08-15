// Typed client for the local Cosign server. Every request stays on this
// machine (Vite proxies /api to localhost:8787 in dev; same origin in prod).

import type {
  IntentTag,
  List,
  ListItem,
  Log,
  LogTaps,
  NoiseLevel,
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
}

export interface ProfileView {
  user: User;
  is_self: boolean;
  can_see_ranking: boolean;
  entries: Array<RankingEntry & { shop: Shop }>;
  logs_count: number;
}

export interface ListView {
  list: List;
  items: Array<ListItem & { shop: Shop }>;
  editors: string[];
  can_edit: boolean;
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

  authUsers: () => req<{ users: User[] }>("/api/auth/users"),
  switchUser: (userId: string) => post<{ user: User }>("/api/auth/switch", { userId }),
  createUser: (input: { username: string; display_name: string; school_id?: string }) =>
    post<{ user: User }>("/api/auth/create", input),
  logout: () => post<{ ok: true }>("/api/auth/logout"),

  shops: () => req<{ shops: ShopSummary[] }>("/api/shops"),
  shop: (slugOrId: string) => req<ShopDetail>(`/api/shops/${encodeURIComponent(slugOrId)}`),
  verifyShop: (id: string) => post<{ ok: true }>(`/api/shops/${encodeURIComponent(id)}/verify`),
  searchPlaces: (q: string) => req<{ results: Shop[] }>(`/api/places/search?q=${encodeURIComponent(q)}`),

  myRanking: () => req<{ entries: Array<RankingEntry & { shop: Shop }> }>("/api/rankings/me"),
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

  myLists: () => req<{ lists: List[] }>("/api/lists/mine"),
  list: (id: string) => req<ListView>(`/api/lists/${encodeURIComponent(id)}`),
  createList: (input: { title: string; is_collaborative?: boolean }) =>
    post<{ list: List }>("/api/lists", input),
  addListItem: (listId: string, shopId: string, note?: string) =>
    post<{ ok: true }>(`/api/lists/${encodeURIComponent(listId)}/items`, { shop_id: shopId, note }),
  removeListItem: (listId: string, shopId: string) =>
    req<{ ok: true }>(`/api/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(shopId)}`, {
      method: "DELETE",
    }),

  myShareTokens: () => req<{ tokens: ShareToken[] }>("/api/share/mine"),
  createShareToken: (input: { kind: "ranking" | "list" | "profile"; list_id?: string }) =>
    post<{ token: ShareToken }>("/api/share", input),
  revokeShareToken: (token: string) => post<{ ok: true }>(`/api/share/${encodeURIComponent(token)}/revoke`),
};
