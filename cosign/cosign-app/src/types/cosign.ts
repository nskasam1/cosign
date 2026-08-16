// Cosign domain types — shared by the SPA and the local server. These mirror
// server/db/schema.sql; the CHECK constraints there enforce these enums.
// No rating scales anywhere: qualitative fields are labeled enums, ranking
// is an ordered list built from head-to-head comparisons.

export type IntentTag =
  | "deep_work"
  | "group_project"
  | "reading"
  | "meeting_someone"
  | "first_date"
  | "quick_grab"
  | "killing_time"
  | "late_night"
  | "just_the_coffee";

export const INTENT_TAGS: IntentTag[] = [
  "deep_work",
  "group_project",
  "reading",
  "meeting_someone",
  "first_date",
  "quick_grab",
  "killing_time",
  "late_night",
  "just_the_coffee",
];

/** Full labels — the log flow, where the phrasing is the point. */
export const INTENT_TAG_LABELS: Record<IntentTag, string> = {
  deep_work: "Deep work",
  group_project: "Group project",
  reading: "Reading",
  meeting_someone: "Meeting someone",
  first_date: "First date",
  quick_grab: "Quick grab",
  killing_time: "Killing time between classes",
  late_night: "Late night",
  just_the_coffee: "Actually here for the coffee",
};

/**
 * Compact labels for dense surfaces — filter chips, the share page's
 * metadata line — where the long forms wrap and break the rhythm. Same
 * nine tags (decision 5); only the wording is shortened.
 */
export const INTENT_TAG_LABELS_SHORT: Record<IntentTag, string> = {
  ...INTENT_TAG_LABELS,
  killing_time: "Killing time",
  just_the_coffee: "Just the coffee",
};

export type TimeBucket = "morning" | "afternoon" | "evening" | "late_night";
export type NoiseLevel = "quiet" | "conversational" | "loud";
export type CrowdLevel = "empty" | "comfortable" | "packed";
export type TableSize = "laptop" | "laptop_plus_friend" | "mug_only";
export type BathroomAccess = "open" | "code" | "customer_only";
export type Visibility = "friends" | "public";

/** The enums, once. The route guard, the repo whitelist and the log flow all
 *  read these — a second copy is how a numeric scale eventually sneaks in. */
export const NOISE_LEVELS: NoiseLevel[] = ["quiet", "conversational", "loud"];
export const CROWD_LEVELS: CrowdLevel[] = ["empty", "comfortable", "packed"];

export const NOISE_LABELS: Record<NoiseLevel, string> = {
  quiet: "Quiet",
  conversational: "Conversational",
  loud: "Loud",
};

export const CROWD_LABELS: Record<CrowdLevel, string> = {
  empty: "Empty",
  comfortable: "Comfortable",
  packed: "Packed",
};

export interface School {
  id: string;
  name: string;
}

export interface User {
  id: string;
  username: string;
  display_name: string;
  school_id: string;
  avatar: string | null;
  taste_line: string | null;
  signature_order: string | null;
  created_at: string;
}

export interface ShopHours {
  day: number; // 0 = Sunday
  open_min: number;
  close_min: number; // may exceed 1440 (past midnight)
}

export interface ShopAmenities {
  shop_id: string;
  outlet_count: number | null;
  outlet_note: string | null;
  seat_count: number | null;
  table_size: TableSize | null;
  wifi_mbps: number | null; // null = no wifi
  wifi_note: string | null;
  bathroom_access: BathroomAccess | null;
  bathroom_code: string | null;
  natural_light: boolean;
  camp_ok: boolean;
  camp_note: string | null;
  updated_at: string;
}

export interface ShopPhoto {
  id: string;
  shop_id: string;
  path: string;
  kind: "room" | "best_seat" | "counter";
  sort: number;
}

export interface Shop {
  id: string;
  slug: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  school_id: string;
  price_drip: number | null;
  price_latte: number | null;
  student_discount: boolean;
  student_discount_note: string | null;
  one_liner: string | null;
  palette: string | null;
  last_verified_at: string | null;
  created_at: string;
}

/** Structured taps captured on a log — confirmations, not ratings. */
export interface LogTaps {
  found_outlet?: boolean;
  wifi_held_up?: boolean;
  got_a_table?: boolean;
  would_camp?: boolean;
}

/** The only tap keys that may ever be persisted, all strictly boolean. */
export const LOG_TAP_KEYS = ["found_outlet", "wifi_held_up", "got_a_table", "would_camp"] as const;
export type LogTapKey = (typeof LOG_TAP_KEYS)[number];

export interface Log {
  id: string;
  user_id: string;
  shop_id: string;
  intent_tag: IntentTag;
  time_bucket: TimeBucket;
  semester: string; // '2026-spring' | 'break'
  noise: NoiseLevel | null;
  crowd: CrowdLevel | null;
  taps: LogTaps;
  photo: string | null;
  line: string | null;
  visibility: Visibility;
  created_at: string;
}

/** One better/worse tap from binary-search insertion. */
export interface Comparison {
  id: string;
  user_id: string;
  winner_shop_id: string;
  loser_shop_id: string;
  context: "insertion" | "reorder";
  created_at: string;
}

/** One entry in a user's canonical ordered ranking (1-based position). */
export interface RankingEntry {
  user_id: string;
  shop_id: string;
  position: number;
  inserted_at: string;
}

export interface List {
  id: string;
  owner_id: string;
  title: string;
  is_collaborative: boolean;
  visibility: Visibility;
  created_at: string;
}

export interface ListItem {
  list_id: string;
  shop_id: string;
  position: number;
  added_by: string;
  note: string | null;
  added_at: string;
}

export type FriendshipStatus = "pending" | "accepted";

export interface Friendship {
  id: string;
  user_id: string;
  friend_id: string;
  status: FriendshipStatus;
  created_at: string;
  responded_at: string | null;
}

export type ShareTokenKind = "ranking" | "list" | "profile";

export interface ShareToken {
  token: string;
  kind: ShareTokenKind;
  user_id: string;
  list_id: string | null;
  created_at: string;
  revoked_at: string | null;
}

export type NotificationType =
  | "friend_request"
  | "friend_accepted"
  | "list_editor_added"
  | "list_reranked"
  | "group_invite"
  | "friend_logged";

export interface AppNotification {
  id: string;
  user_id: string;
  actor_id: string;
  type: NotificationType;
  ref_kind: string;
  ref_id: string;
  created_at: string;
  read_at: string | null;
}

export interface GroupNeeds {
  session_id: string;
  participant_token: string;
  display_name: string | null;
  intent_tag: IntentTag | null;
  need_outlets: boolean;
  need_open_now: boolean;
  need_wifi: boolean;
  max_noise: NoiseLevel | null;
  created_at: string;
}

export interface GroupSession {
  id: string;
  created_by: string;
  school_id: string;
  status: "open" | "resolved" | "cancelled";
  resolved_shop_id: string | null;
  created_at: string;
}

export type SemesterPhase = "week_one" | "mid_semester" | "finals" | "break";
