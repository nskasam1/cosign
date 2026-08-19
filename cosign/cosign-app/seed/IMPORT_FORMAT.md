# Cosign seed & import formats

Everything the app knows lives in this `seed/` folder. You edit plain files here,
run one command, and the database rebuilds itself. No dashboards, no cloud, nothing
to break at 2am. This doc is the whole contract.

## 1. Bulk-adding shops: `shops.csv`

When you're walking High Street adding real shops, fill out a CSV (Google Sheets →
File → Download → CSV is fine). One row per shop, this exact header:

```
id,slug,name,address,lat,lng,price_drip,price_latte,student_discount,hours,outlet_count,outlet_note,seat_count,table_size,wifi_mbps,bathroom_access,bathroom_code,natural_light,camp_ok,one_liner
```

Column by column:

| Column | What goes in it |
|---|---|
| `id` | Stable internal id, `s_` + slug, e.g. `s_wheelhouse`. Never change it once it's out there. |
| `slug` | Lowercase, hyphens, no spaces: `cricket-and-crow`. Becomes the URL. |
| `name` | The name on the sign: `Cricket & Crow`. |
| `address` | Street address, `2044 N High St, Columbus, OH 43201`. Quote it (it has commas). |
| `lat`, `lng` | Decimal degrees. Long-press the spot in Google Maps to get them. |
| `price_drip`, `price_latte` | Dollars as a plain number: `2.75`, `4.50`. No `$`. |
| `student_discount` | Free text like `10% with BuckID`. Leave blank if none. |
| `hours` | Compact hours syntax — see below. |
| `outlet_count` | Outlets you can actually see and reach. Count them, don't guess. |
| `outlet_note` | Where they hide: `most along the back wall`. Blank is fine. |
| `seat_count` | Rough seat count. |
| `table_size` | One of: `laptop`, `laptop_plus_friend`, `mug_only`. What the *typical* table fits. |
| `wifi_mbps` | Run a speed test on their wifi, put the download number. Blank if no wifi. |
| `bathroom_access` | One of: `open`, `code`, `customer_only`. |
| `bathroom_code` | The code if `bathroom_access` is `code`, e.g. `1889#`. Otherwise blank. |
| `natural_light` | `true` or `false` — are there real windows where people sit? |
| `camp_ok` | `true` or `false` — can you sit **four hours** on one coffee without side-eye? (Four, not three: it is the brief's number and it is what every screen in the app says.) |
| `one_liner` | Your one-sentence take. This is the personality of the app; make it count. |

The enum columns (`table_size`, `bathroom_access`) must use those exact strings —
the seeder rejects anything else and tells you the row number.

### Hours syntax

Day ranges + 24-hour times, segments separated by `;`:

```
Mo-Fr 07:00-21:00; Sa-Su 08:00-22:00
```

Rules:
- Days are `Mo Tu We Th Fr Sa Su`. A range like `Mo-Fr` is inclusive. A single day is fine: `Su 09:00-15:00`.
- Times are 24-hour `HH:MM`, local (Columbus) time.
- Closed all day: `Su closed`.
- Split day (closes mid-afternoon): comma-separate windows: `Mo-Fr 07:00-11:30, 15:00-21:00`.
- Open past midnight: just write it — `Fr-Sa 08:00-02:00` means closes 2am the next morning.
- Open 24 hours: `00:00-24:00`.

### Example row

```
s_wheelhouse,wheelhouse,Wheelhouse Coffee,"2044 N High St, Columbus, OH 43201",40.0002,-83.0091,2.75,4.50,10% with BuckID,Mo-Fr 07:00-21:00; Sa-Su 08:00-22:00,14,most along the back wall,38,laptop,180,code,1889#,true,true,"The back room is the best free coworking space on campus, and the drip is $2.75."
```

### Loading the CSV

```
npm run import:shops -- path/to/shops.csv --dry-run   # see what would change
npm run import:shops -- path/to/shops.csv             # merge into shops.json
npm run seed                                          # rebuild the database
```

Merging is by `id`: a row whose id already exists updates that shop in place,
a new id is appended, and a shop **missing** from the CSV is left alone — so
deleting a row never quietly removes a place that is already out there. Fields
the CSV doesn't carry (photos, palette) survive the merge.

Going the other way, `npm run export:shops -- path/to/shops.csv` writes the
current shops back out as a spreadsheet, so you can edit in Sheets and reimport
without losing anything.

## 2. The JSON files

The CSV is only for bulk shop entry. The database seeds from the JSON files in
this folder — the CSV importer just converts rows into `shops.json` entries.
`npm run seed` reads all of these, and fails loudly if any is missing or
inconsistent rather than seeding half a database:

| File | What it holds |
|---|---|
| `shops.json` | the places (below) |
| `users.json` | seeded people |
| `friendships.json` | who is friends with whom |
| `logs.json` | visits — the input mechanic |
| `rankings.json` | each person's ordered list |
| `lists.json` | thematic and collaborative lists |
| `share-tokens.json` | the unlisted share links |
| `academic-calendar.json` | term dates and finals week |
| `group-sessions.json` | the seeded table of four, and what each of them asked for |

- **`shops.json`** — array of shop objects: `id`, `slug`, `name`, `address`,
  `lat`, `lng`, `school`, `price_drip`, `price_latte`, `student_discount`,
  `last_verified_at`, `hours` (array of `{days, open, close}` — `days` uses
  0=Sunday; `close` at or before `open` means past midnight), `amenities`
  (`outlet_count`, `outlet_note`, `seat_count`, `table_size`, `wifi_mbps`,
  `wifi_note`, `bathroom_access`, `bathroom_code`, `natural_light`, `camp_ok`,
  `camp_note`), `one_liner`, `palette`, `photos` (subset of
  `room`/`best_seat`/`counter`; files live at
  `seed/images/shops/<slug>-<kind>.svg`).
- **`users.json`** — array of user objects: `id`, `username`, `display_name`,
  `school`, `taste_line`, `signature_order`, `avatar`, `created_at`.
  Friendships live separately in `friendships.json`
  (`user_id`, `friend_id`, `status`, `created_at`, `responded_at`).
- **`logs.json`** — array of visit logs: `id`, `user_id`, `shop_id`,
  `intent_tag`, `time_bucket`, `created_at` (ISO 8601 with offset, e.g.
  `2026-04-03T14:20:00-04:00`; the hour must match the bucket), `noise`,
  `crowd`, `taps` (`found_outlet`, `wifi_held_up`, `got_a_table`,
  `would_camp` booleans), optional `photo` (`/img/logs/log-NNN.svg`), optional
  `line` (≤140 chars), and `visibility`. The `semester` field is not written
  by hand — the seeder derives it from `created_at` and
  `academic-calendar.json`.
- **`rankings.json`** — object keyed by user id: `final` (shop ids, best to
  worst) and `arrival` (the same ids in the order the user first ranked
  them). Comparisons are never hand-written — the seeder replays
  binary-search insertion over `arrival` and generates them.

The exact allowed values, everywhere they appear:

- `intent_tag` (exactly these 9): `deep_work`, `group_project`, `reading`,
  `meeting_someone`, `first_date`, `quick_grab`, `killing_time`, `late_night`,
  `just_the_coffee`
- `time_bucket`: `morning`, `afternoon`, `evening`, `late_night`
- `noise`: `quiet`, `conversational`, `loud`
- `crowd`: `empty`, `comfortable`, `packed`
- `table_size`: `laptop`, `laptop_plus_friend`, `mug_only`
- `bathroom_access`: `open`, `code`, `customer_only`
- `visibility`: `friends`, `public`

Copy-paste these. Don't improvise ("busy", "cozy", "med") — the seeder will bounce
the file and point at the bad value.

Also in this folder: `academic-calendar.json` (OSU term dates — the app uses it to
know it's finals week).

## 3. Google Maps saved places: `takeout/`

This one isn't yours to fill in — it's what a *student* hands the app when they
sign up. Google Takeout (takeout.google.com → Maps (your places)) gives them two
kinds of file, and Cosign reads both:

| File | What it carries | What it doesn't |
|---|---|---|
| `Saved Places.json` | GeoJSON: name, street address, a map pin, the Maps URL | their notes |
| a saved-list CSV | `Title,Note,URL` — **their own words** about each place | any coordinate |

Neither is a superset of the other, so hand over both if you have both: one file
supplies the pin, the other supplies the note, and they're joined on the name.

`takeout/saved-places.geojson` and `takeout/saved-places.csv` are committed
fixtures of exactly that shape, and they are deliberately not tidy. Between them
they hold fifteen saved places: ten Cosign recognises outright, one saved under a
short name (`Hackberry` for Hackberry Roasters) that it asks about instead of
assuming, and four it doesn't have — two of which sit **within fifty metres of a
place it does** (a bakery beside Bramble; a bar beside Juniper Coffee Club).

Those two exist to hold down the one rule this import has:

> **A coordinate is never, on its own, a reason to say two records are the same
> place.** The name is the identity. The pin can corroborate it, or veto it when
> the name matches something a mile away. Nothing else.

Match a saved place by proximity and you write a bakery somebody has never been
to into their list, under a coffee shop's name, with no undo anywhere in the
flow. `server/import/takeout.test.ts` runs the real fixtures through the real
matcher and fails if either trap is ever taken.

**What is kept.** The shop ids that matched, and the notes they wrote. **What is
not:** every coordinate and address in the file. They're read in memory to tell
two places apart and dropped — decision 12, no persistent location history — and
the API response doesn't carry them either, so there is nothing to leak later.

**What it makes.** A *list*, never a ranking. An order on Cosign comes from
head-to-head comparisons and from nowhere else; a place you once saved a pin on
is a place you meant to try, which is a different sentence entirely.

## 4. How to run it

```
npm run seed
```

That's it. It reads everything in `seed/` and rebuilds `server/data/cosign.db`
from scratch. It's idempotent: running it twice gives you the exact same database,
so run it as often as you like. Fixed a typo in a one-liner? Run it again. It
never *merges* — the seed files are the source of truth and the db is disposable.

(Corollary: never hand-edit the db. Edit the files, re-seed.)

## 5. The round-trip guarantee

Import → export → import is lossless. If you seed the db from these files, export
it back out, and seed again from the export, you get byte-for-byte the same data.
No fields dropped, no timestamps mangled, no enums "normalized" into something
else. This is what makes the weekend safe: you can always get your data back out
exactly as you put it in, so the worst case of any experiment is re-running
`npm run seed`.

The same holds for the **spreadsheet** round trip (`npm run export:shops` then
`npm run import:shops`), with one thing worth knowing about how it is kept true.
The sheet has twenty columns and a shop has more, so re-importing cannot be a
straight overwrite: `wifi_note`, `camp_note`, `palette`, `school` and the photos
have no column to come back in through, and a sheet can therefore never *mean*
"clear the wifi note". Those fields are taken from the row already on file and
the sheet's columns are laid over the top. Two harmless normalisations remain:
`Sa-Su` reads back as Saturday-then-Sunday where the file wrote Sunday-first
(same days, same window), and a discount with no terms written for it is
exported as `yes` and read back as a discount with no terms — not as a note
reading "yes".

This is checked, not asserted: `server/import/roundtrip.test.ts` runs the trip
against `seed/shops.json` itself, so a field added later is covered the day it
lands rather than the day somebody remembers to extend a fixture.

If you ever see a round-trip change something, that's a bug in the app, not your
data. File it.
