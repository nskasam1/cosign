// Hand-authored to mirror supabase/migrations/20260811000000_cosign_rebuild_phase1.sql.
// Once a Supabase project is linked, regenerate via `supabase gen types typescript`
// and this file can go away in favor of the generated one.

export type TimeBucket = "morning" | "afternoon" | "evening" | "late_night";
export type TableSize = "laptop" | "laptop_plus_friend" | "mug_only";
export type BathroomAccess = "open" | "code" | "customer_only";
export type ShopPhotoType = "room" | "best_seat" | "counter";
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
export type FriendshipStatus = "pending" | "accepted";
export type GroupSessionStatus = "open" | "resolved" | "cancelled";
export type VoteDirection = "up" | "down";

export interface School {
  id: string;
  slug: string;
  name: string;
}

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  school_id: string | null;
  avatar_url: string | null;
  one_line_taste_summary: string | null;
  created_at: string;
}

export interface Shop {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  school_id: string;
  hours_json: Record<string, unknown> | null;
  price_drip: number | null;
  price_latte: number | null;
  has_student_discount: boolean;
  last_verified_at: string | null;
  created_at: string;
}

export interface ShopSnapshot {
  id: string;
  shop_id: string;
  time_bucket: TimeBucket;
  noise_level: 1 | 2 | 3 | null;
  crowding: 1 | 2 | 3 | null;
  camp_ability: boolean | null;
  camp_ability_note: string | null;
  honest_note: string | null;
  recorded_by: string | null;
  recorded_at: string;
}

export interface ShopAmenities {
  shop_id: string;
  outlet_count: number | null;
  outlet_location_note: string | null;
  seat_count: number | null;
  laptop_viable_seats: number | null;
  table_size: TableSize | null;
  wifi_speed_mbps: number | null;
  wifi_has_password: boolean | null;
  wifi_password_location_note: string | null;
  bathroom_access: BathroomAccess | null;
  has_natural_light: boolean | null;
  updated_at: string;
}

export interface ShopPhoto {
  id: string;
  shop_id: string;
  url: string;
  type: ShopPhotoType;
  uploaded_by: string | null;
  created_at: string;
}

export interface ShopIntentTagTally {
  shop_id: string;
  intent_tag: IntentTag;
  tally: number;
}

export interface Ranking {
  id: string;
  user_id: string;
  shop_a_id: string;
  shop_b_id: string;
  winner_id: string;
  created_at: string;
}

export interface Friendship {
  id: string;
  user_id: string;
  friend_id: string;
  status: FriendshipStatus;
  created_at: string;
  responded_at: string | null;
}

export interface List {
  id: string;
  title: string;
  owner_id: string;
  is_collaborative: boolean;
  school_id: string | null;
  created_at: string;
}

export interface ListItem {
  id: string;
  list_id: string;
  shop_id: string;
  added_by: string;
  position: number;
  created_at: string;
}

export interface GroupSession {
  id: string;
  created_by: string;
  shop_candidates: string[];
  quorum: number | null;
  status: GroupSessionStatus;
  resolved_shop_id: string | null;
  created_at: string;
}

export interface GroupSessionVote {
  id: string;
  session_id: string;
  participant_token: string;
  shop_id: string;
  vote: VoteDirection;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
}

export interface EloScore {
  shop_id: string;
  elo_score: number;
}

export interface AnalyticsEvent {
  id: string;
  user_id: string | null;
  event: string;
  props: Record<string, unknown> | null;
  created_at: string;
}

export const INTENT_TAG_LABELS: Record<IntentTag, string> = {
  deep_work: "Deep work",
  group_project: "Group project",
  reading: "Reading",
  meeting_someone: "Meeting someone",
  first_date: "First date",
  quick_grab: "Quick grab",
  killing_time: "Killing time",
  late_night: "Late night",
  just_the_coffee: "Just the coffee",
};
