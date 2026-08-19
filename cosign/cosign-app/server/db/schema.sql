-- Cosign local schema (SQLite via node:sqlite).
-- Replaces the abandoned Supabase/Postgres migration entirely. RLS policies
-- from that design become explicit checks in server/repo/*. Canonical enums
-- live in src/types/cosign.ts; CHECK constraints here mirror them.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schools (
  id   TEXT PRIMARY KEY,          -- 'osu'
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,           -- 'u_maya'
  username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name    TEXT NOT NULL,
  school_id       TEXT NOT NULL REFERENCES schools(id),
  avatar          TEXT,                       -- '/img/avatars/maya.svg'
  taste_line      TEXT,
  signature_order TEXT,                       -- their usual drink (5A)
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shops (
  id               TEXT PRIMARY KEY,          -- 's_wheelhouse'
  slug             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  address          TEXT NOT NULL,
  lat              REAL NOT NULL,
  lng              REAL NOT NULL,
  school_id        TEXT NOT NULL REFERENCES schools(id),
  price_drip       REAL,
  price_latte      REAL,
  student_discount INTEGER NOT NULL DEFAULT 0,
  student_discount_note TEXT,          -- the founder's free text, e.g. '10% with BuckID'
  one_liner        TEXT,
  palette          TEXT,                      -- imagery treatment key
  last_verified_at TEXT,                      -- freshness (decision 10)
  created_at       TEXT NOT NULL
);

-- Hours in minutes since local midnight; close_min may exceed 1440 for
-- past-midnight closes ("open till 2am" => 1560). 24h = 0..1440.
CREATE TABLE IF NOT EXISTS shop_hours (
  shop_id   TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  day       INTEGER NOT NULL CHECK (day BETWEEN 0 AND 6),  -- 0 = Sunday
  open_min  INTEGER NOT NULL CHECK (open_min BETWEEN 0 AND 1440),
  close_min INTEGER NOT NULL CHECK (close_min BETWEEN 0 AND 2880),
  PRIMARY KEY (shop_id, day, open_min)
);

-- Decision-6 functional data. Facts and measurements only — never ratings.
CREATE TABLE IF NOT EXISTS shop_amenities (
  shop_id         TEXT PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  outlet_count    INTEGER,
  outlet_note     TEXT,
  seat_count      INTEGER,
  table_size      TEXT CHECK (table_size IN ('laptop','laptop_plus_friend','mug_only')),
  wifi_mbps       INTEGER,                    -- NULL = no wifi
  wifi_note       TEXT,
  bathroom_access TEXT CHECK (bathroom_access IN ('open','code','customer_only')),
  bathroom_code   TEXT,
  natural_light   INTEGER NOT NULL DEFAULT 0,
  camp_ok         INTEGER NOT NULL DEFAULT 0, -- fine to stay 4 hours
  camp_note       TEXT,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shop_photos (
  id      TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  path    TEXT NOT NULL,                      -- '/img/shops/wheelhouse-room.svg'
  kind    TEXT NOT NULL CHECK (kind IN ('room','best_seat','counter')),
  sort    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS shop_photos_shop ON shop_photos(shop_id, sort);

-- The Log: one visit, ≤10s to record (decision 4). Structured taps only;
-- noise/crowd are labeled enums (never numeric scales); the single optional
-- line is capped at 140 chars. time_bucket + semester are auto-captured.
CREATE TABLE IF NOT EXISTS logs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id     TEXT NOT NULL REFERENCES shops(id),
  intent_tag  TEXT NOT NULL CHECK (intent_tag IN
    ('deep_work','group_project','reading','meeting_someone','first_date',
     'quick_grab','killing_time','late_night','just_the_coffee')),
  time_bucket TEXT NOT NULL CHECK (time_bucket IN ('morning','afternoon','evening','late_night')),
  semester    TEXT NOT NULL,                  -- '2026-spring' | 'break'
  noise       TEXT CHECK (noise IN ('quiet','conversational','loud')),
  crowd       TEXT CHECK (crowd IN ('empty','comfortable','packed')),
  taps_json   TEXT NOT NULL DEFAULT '{}',     -- {found_outlet,wifi_held_up,got_a_table,would_camp}
  photo       TEXT,
  line        TEXT CHECK (line IS NULL OR length(line) <= 140),
  visibility  TEXT NOT NULL DEFAULT 'friends' CHECK (visibility IN ('friends','public')),
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS logs_user    ON logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS logs_shop    ON logs(shop_id, time_bucket);

-- Every better/worse tap from binary-search insertion (decision 3). The
-- audit log behind each user's ordered list, and the raw material for the
-- crowd baseline (aggregated rank — never averaged ratings).
CREATE TABLE IF NOT EXISTS comparisons (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  winner_shop_id TEXT NOT NULL REFERENCES shops(id),
  loser_shop_id  TEXT NOT NULL REFERENCES shops(id),
  context        TEXT NOT NULL DEFAULT 'insertion' CHECK (context IN ('insertion','reorder')),
  created_at     TEXT NOT NULL,
  CHECK (winner_shop_id <> loser_shop_id)
);
CREATE INDEX IF NOT EXISTS comparisons_user ON comparisons(user_id, created_at);

-- Each user's one canonical ranking. Exists as its own row so the list can
-- carry visibility (decision 9: friends by default, like lists and logs);
-- a share token is the only way it goes public without flipping this.
CREATE TABLE IF NOT EXISTS rankings (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT,
  visibility TEXT NOT NULL DEFAULT 'friends' CHECK (visibility IN ('friends','public')),
  updated_at TEXT NOT NULL
);

-- The ordered entries of that ranking — the shareable object.
-- position is 1-based, contiguous, unique per user.
CREATE TABLE IF NOT EXISTS ranking_entries (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id     TEXT NOT NULL REFERENCES shops(id),
  position    INTEGER NOT NULL CHECK (position >= 1),
  inserted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, shop_id),
  UNIQUE (user_id, position)
);

-- Thematic / collaborative lists (distinct from the canonical ranking).
CREATE TABLE IF NOT EXISTS lists (
  id               TEXT PRIMARY KEY,
  owner_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  is_collaborative INTEGER NOT NULL DEFAULT 0,
  visibility       TEXT NOT NULL DEFAULT 'friends' CHECK (visibility IN ('friends','public')),
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS list_items (
  list_id  TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  shop_id  TEXT NOT NULL REFERENCES shops(id),
  position INTEGER NOT NULL,
  added_by TEXT NOT NULL REFERENCES users(id),
  note     TEXT,
  added_at TEXT NOT NULL,
  PRIMARY KEY (list_id, shop_id)
);

CREATE TABLE IF NOT EXISTS list_editors (
  list_id  TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (list_id, user_id)
);

-- One editor putting a collaborative list into the order its contributors'
-- own rankings imply (Phase 5B). It is a row rather than a timestamp on the
-- list because it is the ACTION RECORD a list_reranked notification points
-- at: every notification in this schema references the thing somebody did,
-- and a re-rank happening twice is two things. `moved` is how many places
-- changed position — a re-rank that moves nothing is never written.
CREATE TABLE IF NOT EXISTS list_reranks (
  id         TEXT PRIMARY KEY,
  list_id    TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  actor_id   TEXT NOT NULL REFERENCES users(id),
  moved      INTEGER NOT NULL CHECK (moved > 0),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS list_reranks_list ON list_reranks(list_id, created_at DESC);

CREATE TABLE IF NOT EXISTS friendships (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted')),
  created_at   TEXT NOT NULL,
  responded_at TEXT,
  CHECK (user_id <> friend_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair ON friendships(
  min(user_id, friend_id), max(user_id, friend_id)
);

-- The per-list/profile opt-in (decision 12): an unlisted tokenized public
-- URL. Revoking re-closes the surface. kind 'ranking' and 'profile' scope
-- to the owning user; 'list' scopes to list_id.
CREATE TABLE IF NOT EXISTS share_tokens (
  token      TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('ranking','list','profile')),
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_id    TEXT REFERENCES lists(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  -- scope is exactly one surface: a list token names its list, and the
  -- user-scoped kinds must not carry one
  CHECK ((kind = 'list') = (list_id IS NOT NULL))
);

-- Group decision mode (decision 8): intersection of up to 4 people's needs.
-- No voting, no thumbs. Participants are anonymous browser tokens (no login).
CREATE TABLE IF NOT EXISTS group_sessions (
  id               TEXT PRIMARY KEY,
  created_by       TEXT NOT NULL REFERENCES users(id),
  school_id        TEXT NOT NULL REFERENCES schools(id),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','cancelled')),
  resolved_shop_id TEXT REFERENCES shops(id),
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_needs (
  session_id        TEXT NOT NULL REFERENCES group_sessions(id) ON DELETE CASCADE,
  participant_token TEXT NOT NULL,
  -- Set when the person answering is signed in: their ranked list is what
  -- orders the survivors. Null for somebody who joined by link, who brings
  -- needs and no list — the no-login-wall case, which must keep working.
  user_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
  display_name      TEXT,
  intent_tag        TEXT CHECK (intent_tag IS NULL OR intent_tag IN
    ('deep_work','group_project','reading','meeting_someone','first_date',
     'quick_grab','killing_time','late_night','just_the_coffee')),
  need_outlets      INTEGER NOT NULL DEFAULT 0,
  need_open_now     INTEGER NOT NULL DEFAULT 0,
  need_wifi         INTEGER NOT NULL DEFAULT 0,
  max_noise         TEXT CHECK (max_noise IS NULL OR max_noise IN ('quiet','conversational','loud')),
  created_at        TEXT NOT NULL,
  PRIMARY KEY (session_id, participant_token)
);
-- One person answers once per session however many tabs they open.
CREATE UNIQUE INDEX IF NOT EXISTS group_needs_user ON group_needs(session_id, user_id)
  WHERE user_id IS NOT NULL;

-- Human actions only (brief #11). Every row references the persisted action
-- record that caused it, by (ref_kind, ref_id), and the feed is rendered from
-- that record rather than from a copy — so a notification cannot outlive the
-- thing it is about. There are exactly five ways a row gets here and all five
-- are somebody doing something to somebody:
--
--   friend_request      a friendship row, still pending
--   friend_accepted     the same friendship row, answered
--   list_editor_added   a list_editors row — ref_id is the LIST, and the
--                       recipient is the added editor, which together are
--                       that table's whole primary key
--   list_reranked       a list_reranks row (its own record: two re-ranks are
--                       two events, so the list itself cannot be the referent)
--   group_invite        a group_sessions row
--
-- `friend_logged` was in this CHECK and is deliberately gone. It is the one
-- of the six that fires without anybody choosing to tell you anything — a
-- feed of other people's activity, which is the shape the brief bans. PLAN's
-- Phase 5B line names the five above and says "exactly".
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- recipient
  actor_id   TEXT NOT NULL REFERENCES users(id),
  type       TEXT NOT NULL CHECK (type IN
    ('friend_request','friend_accepted','list_editor_added','list_reranked','group_invite')),
  ref_kind   TEXT NOT NULL CHECK (ref_kind IN ('friendship','list_editor','list_rerank','group_session')),
  ref_id     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at    TEXT,
  -- Nobody is told the same thing twice. One action record, one notification.
  CHECK (user_id <> actor_id)
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_once
  ON notifications(user_id, type, ref_kind, ref_id);

-- Local analytics (decision 11 / north star). Never leaves this machine.
CREATE TABLE IF NOT EXISTS analytics_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT,
  event      TEXT NOT NULL,   -- 'app_open' | 'log_created' | 'share_viewed' | ...
  props_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS analytics_event_time ON analytics_events(event, created_at);

-- ── passkeys (Phase 9) ──────────────────────────────────────────────────────
-- The product's real credential. A person is their device, not a password:
-- nothing here is a secret, so a stolen copy of this table cannot sign in as
-- anybody. `public_key` is the COSE key exactly as the authenticator sent it;
-- `credential_id` is base64url and is what the browser hands back at login.
--
-- A user may have several — a phone, a laptop, a hardware key — and losing all
-- of them is the account-recovery problem this schema deliberately does NOT
-- solve, because every recovery channel worth having (email, SMS) is an
-- external service. See PLAN.md Phase 9.
CREATE TABLE IF NOT EXISTS credentials (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key    TEXT NOT NULL,
  alg           INTEGER NOT NULL,
  sign_count    INTEGER NOT NULL DEFAULT 0,
  -- What the person will recognise it by when they come to revoke one.
  label         TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT
);
CREATE INDEX IF NOT EXISTS credentials_user ON credentials(user_id);

-- A challenge is single-use and short-lived, and it lives in the database
-- rather than in memory so that it is single-use across restarts too, and so
-- that "was this challenge already spent" is a question with one answer rather
-- than one per process. Deleted on use; swept by age on every issue.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  challenge  TEXT PRIMARY KEY,
  purpose    TEXT NOT NULL CHECK (purpose IN ('register','authenticate')),
  -- Set only for a registration, which is bound to the account making it.
  user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
