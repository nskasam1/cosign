-- Cosign rebuild — Phase 1 data model.
-- Replaces the Sip "Vibe Matrix" schema (entries, wishlist) entirely.
-- NOT YET APPLIED to any live project — this is scaffolding, written before
-- Supabase credentials for the new project exist. Review before running
-- `supabase db push` for real, since the drops below are destructive.

drop table if exists public.entries cascade;
drop table if exists public.wishlist cascade;

-- ── Enums ──────────────────────────────────────────────────────────────────

create type public.friendship_status as enum ('pending', 'accepted');
create type public.time_bucket as enum ('morning', 'afternoon', 'evening', 'late_night');
create type public.table_size as enum ('laptop', 'laptop_plus_friend', 'mug_only');
create type public.bathroom_access as enum ('open', 'code', 'customer_only');
create type public.shop_photo_type as enum ('room', 'best_seat', 'counter');
create type public.intent_tag as enum (
  'deep_work', 'group_project', 'reading', 'meeting_someone',
  'first_date', 'quick_grab', 'killing_time', 'late_night', 'just_the_coffee'
);
create type public.group_session_status as enum ('open', 'resolved', 'cancelled');
create type public.vote_direction as enum ('up', 'down');

-- ── Schools (single-row seed for OSU; see guardrail #10 — no multi-tenant
-- abstraction beyond this FK, expand only when campus one is boring) ───────

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null
);

alter table public.schools enable row level security;
create policy "Schools are public" on public.schools for select using (true);

insert into public.schools (slug, name) values ('osu', 'Ohio State University');

-- ── Profiles ─────────────────────────────────────────────────────────────
-- Backs the public share-link header. Treated as first-class, not bolted
-- onto auth.users — see MIGRATION_NOTES.md (profiles/follows were never
-- real tables in Sip; this is greenfield, not a data migration).

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text,
  school_id uuid references public.schools(id),
  avatar_url text,
  one_line_taste_summary text,
  created_at timestamptz not null default now()
);

create unique index profiles_username_lower_idx on public.profiles (lower(username));

alter table public.profiles enable row level security;
create policy "Profiles are public" on public.profiles for select using (true);
create policy "Users manage own profile" on public.profiles
  for insert with check (auth.uid() = id);
create policy "Users update own profile" on public.profiles
  for update using (auth.uid() = id);

-- `avatars` bucket: referenced by Sip's useProfile.tsx but never actually
-- created by any migration (see MIGRATION_NOTES.md) — creating it for real
-- here, alongside the profiles table it belongs with.
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);

create policy "Anyone can view avatars" on storage.objects
  for select using (bucket_id = 'avatars');
create policy "Users upload own avatar" on storage.objects
  for insert with check (bucket_id = 'avatars' and auth.uid() is not null);

-- ── Shops ────────────────────────────────────────────────────────────────
-- Core identity is admin/seeding-tool controlled (no public write policy —
-- only the service role, used server-side by the Phase 8 admin form, can
-- insert/update). Amenities/snapshots below are crowd-correctable.

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  lat double precision not null,
  lng double precision not null,
  school_id uuid not null references public.schools(id),
  hours_json jsonb,
  price_drip numeric(6,2),
  price_latte numeric(6,2),
  has_student_discount boolean not null default false,
  last_verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index shops_school_idx on public.shops (school_id);

alter table public.shops enable row level security;
create policy "Shops are public" on public.shops for select using (true);

-- Any authenticated user can bump last_verified_at via the freshness
-- re-verify prompt (Phase 5) — scoped through this function rather than a
-- blanket UPDATE policy so the rest of a shop's identity stays locked down.
create function public.confirm_shop_freshness(p_shop_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.shops set last_verified_at = now() where id = p_shop_id;
$$;

-- ── Shop snapshots (time-of-day is first-class, not a shared static blob) ─
-- Append-only: each re-verification is a new row, not a mutation, so the
-- shop's profile page can aggregate across time without losing history.

create table public.shop_snapshots (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  time_bucket public.time_bucket not null,
  noise_level smallint check (noise_level between 1 and 3),
  crowding smallint check (crowding between 1 and 3),
  camp_ability boolean,
  camp_ability_note text,
  -- The "structured tags + one optional short line" the brief allows in
  -- place of a free-text vibes field (§7) — one honest line per snapshot,
  -- not a required field.
  honest_note text,
  recorded_by uuid references auth.users(id),
  recorded_at timestamptz not null default now()
);

create index shop_snapshots_shop_idx on public.shop_snapshots (shop_id, time_bucket);

alter table public.shop_snapshots enable row level security;
create policy "Shop snapshots are public" on public.shop_snapshots for select using (true);
create policy "Authenticated users record snapshots" on public.shop_snapshots
  for insert with check (auth.uid() = recorded_by);

-- ── Shop amenities ───────────────────────────────────────────────────────
-- One row per shop (current known state), crowd-correctable — any
-- authenticated user can update as part of the freshness mechanic, unlike
-- shops' core identity fields.

create table public.shop_amenities (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  outlet_count integer,
  outlet_location_note text,
  seat_count integer,
  laptop_viable_seats integer,
  table_size public.table_size,
  wifi_speed_mbps integer,
  wifi_has_password boolean,
  wifi_password_location_note text,
  bathroom_access public.bathroom_access,
  has_natural_light boolean,
  updated_at timestamptz not null default now()
);

alter table public.shop_amenities enable row level security;
create policy "Shop amenities are public" on public.shop_amenities for select using (true);
create policy "Authenticated users maintain amenities" on public.shop_amenities
  for insert with check (auth.uid() is not null);
create policy "Authenticated users update amenities" on public.shop_amenities
  for update using (auth.uid() is not null);

-- ── Shop photos ──────────────────────────────────────────────────────────

create table public.shop_photos (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  url text not null,
  type public.shop_photo_type not null,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index shop_photos_shop_idx on public.shop_photos (shop_id);

alter table public.shop_photos enable row level security;
create policy "Shop photos are public" on public.shop_photos for select using (true);
create policy "Authenticated users upload photos" on public.shop_photos
  for insert with check (auth.uid() = uploaded_by);
create policy "Uploaders delete own photos" on public.shop_photos
  for delete using (auth.uid() = uploaded_by);

-- ── Intent tags ──────────────────────────────────────────────────────────
-- Fixed enum (public.intent_tag above), not user-generated. Tallies are
-- derived from raw votes, not a mutable counter — same "log is truth, not
-- a cached column" principle the brief requires for Elo below.

create table public.shop_intent_tag_votes (
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  intent_tag public.intent_tag not null,
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id, intent_tag)
);

alter table public.shop_intent_tag_votes enable row level security;
create policy "Intent tag votes are public" on public.shop_intent_tag_votes for select using (true);
create policy "Authenticated users tag shops" on public.shop_intent_tag_votes
  for insert with check (auth.uid() = user_id);
create policy "Users remove own tags" on public.shop_intent_tag_votes
  for delete using (auth.uid() = user_id);

create view public.shop_intent_tag_tallies as
  select shop_id, intent_tag, count(*) as tally
  from public.shop_intent_tag_votes
  group by shop_id, intent_tag;

-- ── Rankings ─────────────────────────────────────────────────────────────
-- Replaces star ratings entirely. Raw pairwise comparisons only — Elo is
-- derived below, never stored, so re-ranking stays reproducible/auditable.

create table public.rankings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shop_a_id uuid not null references public.shops(id),
  shop_b_id uuid not null references public.shops(id),
  winner_id uuid not null references public.shops(id),
  created_at timestamptz not null default now(),
  constraint rankings_distinct_shops check (shop_a_id <> shop_b_id),
  constraint rankings_winner_is_a_or_b check (winner_id in (shop_a_id, shop_b_id))
);

create index rankings_user_created_idx on public.rankings (user_id, created_at);

-- ── Friendships ──────────────────────────────────────────────────────────
-- Directed request rows; status flips to accepted on the recipient's
-- action. Normalized unique index blocks duplicate/reverse-direction
-- requests between the same pair.

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  status public.friendship_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friendships_no_self check (user_id <> friend_id)
);

create unique index friendships_pair_idx on public.friendships (
  least(user_id, friend_id), greatest(user_id, friend_id)
);

alter table public.friendships enable row level security;
create policy "Users see own friendships" on public.friendships
  for select using (auth.uid() in (user_id, friend_id));
create policy "Users send friend requests" on public.friendships
  for insert with check (auth.uid() = user_id);
create policy "Recipients respond to friend requests" on public.friendships
  for update using (auth.uid() = friend_id);
create policy "Either party removes a friendship" on public.friendships
  for delete using (auth.uid() in (user_id, friend_id));

create function public.is_friend(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((user_id = a and friend_id = b) or (user_id = b and friend_id = a))
  );
$$;

-- Rankings RLS depends on is_friend(), so it's declared after that function.
alter table public.rankings enable row level security;
create policy "Users see own and friends' rankings" on public.rankings
  for select using (auth.uid() = user_id or public.is_friend(auth.uid(), user_id));
create policy "Users record own rankings" on public.rankings
  for insert with check (auth.uid() = user_id);
create policy "Users delete own rankings" on public.rankings
  for delete using (auth.uid() = user_id);

-- ── Elo derivation ───────────────────────────────────────────────────────
-- Replays one user's rankings log in chronological order. Pure function of
-- the log — no stored score column, so re-running this after edits to the
-- log always reproduces the correct ordering.

create function public.compute_user_elo(p_user_id uuid)
returns table (shop_id uuid, elo_score numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  k_factor constant numeric := 32;
  starting_rating constant numeric := 1200;
  r record;
  ratings jsonb := '{}'::jsonb;
  rating_a numeric;
  rating_b numeric;
  expected_a numeric;
  score_a numeric;
begin
  for r in
    select shop_a_id, shop_b_id, winner_id
    from public.rankings
    where user_id = p_user_id
    order by created_at asc
  loop
    rating_a := coalesce((ratings ->> r.shop_a_id::text)::numeric, starting_rating);
    rating_b := coalesce((ratings ->> r.shop_b_id::text)::numeric, starting_rating);

    expected_a := 1 / (1 + power(10, (rating_b - rating_a) / 400));
    score_a := case when r.winner_id = r.shop_a_id then 1 else 0 end;

    ratings := jsonb_set(ratings, array[r.shop_a_id::text], to_jsonb(rating_a + k_factor * (score_a - expected_a)));
    ratings := jsonb_set(ratings, array[r.shop_b_id::text], to_jsonb(rating_b + k_factor * ((1 - score_a) - (1 - expected_a))));
  end loop;

  return query
    select key::uuid, value::text::numeric
    from jsonb_each(ratings);
end;
$$;

-- Friend-weighted rankings (Phase 4.3): a shop's shown rank to a viewer is
-- the average of their friends' (+ own) derived Elo scores for that shop,
-- not a global average. Scaffolded here since it's a thin wrapper over
-- compute_user_elo(); exercised for real once Phase 4's UI calls it.
create function public.compute_friend_weighted_rankings(p_viewer_id uuid)
returns table (shop_id uuid, weighted_score numeric, sample_size integer)
language sql
stable
security definer
set search_path = public
as $$
  with peers as (
    select p_viewer_id as peer_id
    union
    select friend_id from public.friendships where user_id = p_viewer_id and status = 'accepted'
    union
    select user_id from public.friendships where friend_id = p_viewer_id and status = 'accepted'
  ),
  peer_elo as (
    select e.shop_id, e.elo_score
    from peers, public.compute_user_elo(peers.peer_id) e
  )
  select shop_id, avg(elo_score) as weighted_score, count(*)::int as sample_size
  from peer_elo
  group by shop_id;
$$;

-- ── Lists (collaborative, the retention driver) ─────────────────────────

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  is_collaborative boolean not null default false,
  school_id uuid references public.schools(id),
  created_at timestamptz not null default now()
);

create table public.list_editors (
  list_id uuid not null references public.lists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (list_id, user_id)
);

create table public.list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists(id) on delete cascade,
  shop_id uuid not null references public.shops(id),
  added_by uuid not null references auth.users(id),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create function public.can_edit_list(p_list_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.lists
    where id = p_list_id and owner_id = p_user_id
  ) or exists (
    select 1 from public.list_editors
    where list_id = p_list_id and user_id = p_user_id
  );
$$;

alter table public.lists enable row level security;
create policy "Lists are public" on public.lists for select using (true);
create policy "Users create own lists" on public.lists
  for insert with check (auth.uid() = owner_id);
create policy "Owners update own lists" on public.lists
  for update using (auth.uid() = owner_id);

alter table public.list_editors enable row level security;
create policy "List editors are public" on public.list_editors for select using (true);
create policy "Owners add editors" on public.list_editors
  for insert with check (exists (
    select 1 from public.lists where id = list_id and owner_id = auth.uid()
  ));

alter table public.list_items enable row level security;
create policy "List items are public" on public.list_items for select using (true);
create policy "Editors add list items" on public.list_items
  for insert with check (public.can_edit_list(list_id, auth.uid()));
create policy "Owners and adders remove list items" on public.list_items
  for delete using (
    added_by = auth.uid()
    or exists (select 1 from public.lists where id = list_id and owner_id = auth.uid())
  );

-- ── Group decision sessions ──────────────────────────────────────────────
-- Voting is explicitly no-login-wall (brief §4.1), so votes carry a
-- client-generated participant_token instead of an auth identity. This is
-- a soft-trust model (anyone who has the link and a token can vote once
-- per candidate) — acceptable for a low-stakes "which coffee shop" poll,
-- not a security boundary. Resolution is server-enforced via trigger
-- rather than trusted from the client.

create table public.group_sessions (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  shop_candidates uuid[] not null,
  quorum integer,
  status public.group_session_status not null default 'open',
  resolved_shop_id uuid references public.shops(id),
  created_at timestamptz not null default now()
);

create table public.group_session_votes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.group_sessions(id) on delete cascade,
  participant_token uuid not null,
  shop_id uuid not null,
  vote public.vote_direction not null,
  created_at timestamptz not null default now(),
  unique (session_id, participant_token, shop_id)
);

alter table public.group_sessions enable row level security;
create policy "Group sessions are public" on public.group_sessions for select using (true);
create policy "Users create group sessions" on public.group_sessions
  for insert with check (auth.uid() = created_by);
create policy "Creators close their sessions" on public.group_sessions
  for update using (auth.uid() = created_by);

alter table public.group_session_votes enable row level security;
create policy "Group session votes are public" on public.group_session_votes for select using (true);
create policy "Anyone with the link can vote while open" on public.group_session_votes
  for insert with check (
    exists (select 1 from public.group_sessions where id = session_id and status = 'open')
  );
-- Separate UPDATE policy so a participant can change their vote (the
-- client upserts on the (session_id, participant_token, shop_id) unique
-- constraint) — same open-session condition as the insert policy above.
create policy "Anyone with the link can change their vote while open" on public.group_session_votes
  for update using (
    exists (select 1 from public.group_sessions where id = session_id and status = 'open')
  );

create function public.resolve_group_session_if_quorum_met()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  top_shop uuid;
  top_votes integer;
begin
  select * into s from public.group_sessions where id = new.session_id;
  if s.status <> 'open' or s.quorum is null then
    return new;
  end if;

  select shop_id, count(*) into top_shop, top_votes
  from public.group_session_votes
  where session_id = new.session_id and vote = 'up'
  group by shop_id
  order by count(*) desc
  limit 1;

  if top_votes >= s.quorum then
    update public.group_sessions
      set status = 'resolved', resolved_shop_id = top_shop
      where id = new.session_id;
  end if;

  return new;
end;
$$;

create trigger group_session_votes_check_quorum
  after insert on public.group_session_votes
  for each row execute function public.resolve_group_session_if_quorum_met();

-- ── Notifications ────────────────────────────────────────────────────────
-- Table only, in this pass — no INSERT policy for authenticated/anon on
-- purpose. Per the brief, notifications must only ever be created by a
-- real human action (friend accepted, added to a shared list, group
-- ping), never a re-engagement cron. Enforcing that means creating them
-- via triggers on the actions themselves, wired up alongside those
-- actions' own UI in Phase 3/4 — not here, to avoid building Phase 4
-- features ahead of schedule.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id),
  type text not null,
  payload jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
create policy "Users see own notifications" on public.notifications
  for select using (auth.uid() = user_id);
create policy "Users mark own notifications read" on public.notifications
  for update using (auth.uid() = user_id);

-- ── Analytics events ─────────────────────────────────────────────────────
-- Phase 5.4: "weekly returning users who logged nothing" is named in the
-- brief as the metric that actually signals whether the retention loop
-- works — this table exists so that can be computed from day one, even
-- with no dashboard yet. Write-only from the client (no select policy for
-- authenticated/anon — reading is a service-role/dashboard concern).

create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  event text not null,
  props jsonb,
  created_at timestamptz not null default now()
);

create index analytics_events_event_idx on public.analytics_events (event, created_at);

alter table public.analytics_events enable row level security;
create policy "Users record their own events" on public.analytics_events
  for insert with check (auth.uid() = user_id or user_id is null);
