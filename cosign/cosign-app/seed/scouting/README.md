# The High Street worksheet

`high-street-worksheet.csv` is a **scouting list, not data.** It exists so the
seeding weekend starts from a route and a set of rows rather than from a blank
spreadsheet. Nothing in it has been verified by anybody, and none of it is
loaded by `npm run seed` — the app still runs on `seed/shops.json` until you
import over it.

## What is in it, and how much to trust each part

| Column | Where it came from | Trust |
|---|---|---|
| `name` | Web search for coffee shops near the OSU campus | These places exist. Spelling may not match the sign. |
| `address` | Two Columbus round-up articles, Aug 2026 | **Unverified.** Six rows have one; five do not. Check it against the door. |
| everything else | Nothing. It is blank. | — |

The eleven rows are a starting route, not a target. Add what you find, delete
what has closed, and do not feel bound by a list assembled from articles.

## It will not import until you have walked it

That is deliberate. Try it now:

```
npm run import:shops -- seed/scouting/high-street-worksheet.csv --dry-run
```

```
shops.csv row 2: natural_light must be true or false (got "")
```

`natural_light` and `camp_ok` are the two columns that refuse to be blank, so
the importer walks you down the file one unanswered question at a time. When it
stops complaining, every row has been answered by somebody who was there. Run
it without `--dry-run` and it merges into `seed/shops.json` by `id`; a second
weekend adds to the first rather than replacing it.

## The eight things only being in the room can tell you

The full column list is in `../IMPORT_FORMAT.md`. These are the ones that
cannot be looked up, and they are most of the product's value:

1. **`outlet_count`** — outlets you can actually see and reach from a seat.
   Count them. The one under the counter that staff use does not count.
2. **`outlet_note`** — where they are. "strips down the centre of every
   communal table" is worth more than the number on its own.
3. **`seat_count`** and **`table_size`** — `laptop`, `laptop_plus_friend`, or
   `mug_only`. A table that fits a laptop and a friend is a different product
   from one that fits a mug.
4. **`wifi_mbps`** — run a speed test on their wifi, on your phone, at a busy
   hour. A number from their website is a number about their router, not about
   sitting there at 2pm on a Tuesday.
5. **`bathroom_access`** — `open`, `code`, or `customer_only`. And
   `bathroom_code` **only if they are happy for it to be published.** See below.
6. **`camp_ok`** — can you sit for four hours. Ask; do not infer it from the
   seating.
7. **`hours`** — off the door, not off the internet. The compact syntax is in
   `IMPORT_FORMAT.md`. Campus hours change in the summer and nobody updates
   their listing.
8. **`one_liner`** — the honest sentence. This is the one column that is
   writing rather than measuring, and it is the thing people will actually
   read. "Never the best at anything, never once a wrong answer" is the voice.

`lat` / `lng`: long-press the spot in Google Maps and copy the pair. Do it at
the door, not from the search result — the pin for a business is sometimes the
centre of the building it is inside.

## Before you publish a bathroom code

The app renders `bathroom_code` on the shop page. Six codes are in the current
seed data and that data is invented; the moment they are real, publishing one
is a decision about somebody's business, not a data-entry choice. Ask the
owner. If the answer is no, set `bathroom_access` to `code` and leave
`bathroom_code` blank — the product handles that, and "there is a code, ask at
the counter" is still useful and costs nobody anything.

The same goes for `wifi_mbps` and prices: they are claims about a real business
that will be read by their customers. Being wrong about them is worse than not
having them.

## What happens to the invented data

`seed/shops.json` currently holds 22 authored shops with real Columbus
addresses and entirely invented facts. It is what every screenshot in
`evidence/` was taken against. Once real rows land, decide deliberately whether
to delete the invented ones — a mixed database where some rows have been walked
and some have not is the one state the freshness system cannot describe,
because `last_verified_at` will look the same for both.
