# Cosign design tokens — rationale

`tokens.css` is the canonical file. This is why it says what it says. Settled in
Phase 2; later phases consume it and do not re-decide aesthetics ad hoc.

Three consumers read the same file: `tailwind.config.ts` (the SPA),
`src/index.css` (the SPA), and `server/pages/tokens.ts`, which inlines it into
the SSR share page. `tokens.test.ts` fails the build if a documented
foreground/background pair drops below its WCAG threshold, or if the copies
`server/pages/og.ts` needs (satori has no CSS variables) drift from the source.

## How the direction was chosen

`frontend-design` and `ui-ux-pro-max` were invoked first, as PLAN.md requires.
Then four independent design directions were generated for the share page —
letterpress broadside, photo-essay, field ledger, and a free-choice fourth
(a pigment deck) — each rendered as a full working mockup against the real
seeded data and screenshotted at 390×844 and 1280, then audited for brief
compliance and contrast. What shipped is a synthesis, and three findings from
that panel drove it:

- All four directions independently picked **Young Serif** for display. Taking
  the hint.
- Three of four picked **Karla** for body over the neutral grotesques. Side by
  side at 14.5 px on a 390 px column, Karla sounds like a person; Instrument
  Sans and Schibsted Grotesk sound like a product.
- Every mockup spent 680–790 px of the first screen on masthead before the
  first entry. The brief says *ranked list first*. Ours reaches entry #1 at
  501 px, so the lead photograph is on screen before any scrolling.

Note: only `SKILL.md` of `ui-ux-pro-max` is installed on this machine — its
`data/` and `scripts/` directories are empty, so the CSV search tool could not
be run. The rule tables in `SKILL.md` were applied directly instead.

## Colour

A warm near-black, not a blue-grey one. The seeded imagery
(`seed/images/generate.mjs`) paints on six grounds between `#131518` and
`#181410`; a page at `#14100E` lets those photographs dissolve into it instead
of floating on a slab. Ink is paper-warm `#F3E9DC` — pure white on warm black
reads as a screen.

Two accents, with strictly separate jobs, so neither becomes wallpaper:

| token | job |
|---|---|
| `--ember` `#E0633C` | the **ranking** voice: rank numerals, the active chip, the CTA |
| `--gold` `#C8A96E` | the **label** voice: small-caps eyebrows, intent tags, kickers |

Ember rather than the reflexive coffee-gold-on-brown, which is the first thing
anyone reaches for and reads as stock.

### The place palettes

`--pal-*` and `--plate-*` mirror the six treatments the imagery generator uses.
A place's rank numeral and its no-photo plate take the same hue its photograph
was painted from, so scrolling the list produces a colour rhythm drawn from the
places themselves rather than applied on top of them. It is also what makes the
no-photo state first-class: entry 11 is not a missing picture, it is
`C&V` set in the display face on Cardinal & Vine's own clay.

### Contrast (measured, on `--bg`)

| pair | ratio | needs |
|---|---|---|
| `--ink` on `--bg` | 15.76 : 1 | 4.5 |
| `--line` on `--bg` (the honest line) | 10.14 : 1 | 4.5 |
| `--gold` on `--bg` (labels) | 8.43 : 1 | 4.5 |
| `--ember-ink` on `--bg` (CTA) | 7.67 : 1 | 4.5 |
| `--muted` on `--bg` (metadata) | 5.60 : 1 | 4.5 |
| `--ember` on `--bg` (numerals) | 5.42 : 1 | 3.0 |
| `--bg` on `--ember` (active chip) | 5.42 : 1 | 4.5 |
| dimmest place palette (`clay`) on `--bg` | 5.21 : 1 | 3.0 |
| dimmest palette on its own plate | 4.37 : 1 | 3.0 |

Everything clears AA for its size, and every body-text pair clears AA for
normal text regardless of size.

## Type

**Young Serif 400** (display) + **Karla 400/700** (body). Two families, three
files, 53 kB total, both SIL OFL, both self-hosted in `public/fonts/` with the
licences beside them. No CDN — the brief forbids external services, and that
includes fonts.

Young Serif has one weight, which is a feature: hierarchy has to come from
scale, colour and space rather than weight, and its heavy lining figures make
the rank numerals read as pressed type rather than as badges. Karla is
slightly condensed with flared stems and an idiosyncratic `a`, so it survives
a 390 px column and does the tracked-out small-caps work without a third file.

`font-display: swap` everywhere and no `preload`: the share page's LCP budget
is 1.0 s on simulated Slow-4G against a ~0.9 s document floor, so nothing may
compete with the document for that window. Text paints in the fallback stack
and swaps.

Scale is a 1.22 ratio rounded to whole pixels (11 / 13 / 14.5 / 16 / 19 / 23 /
28 / 34 / 44) so hairlines and small caps stay crisp. Body never drops below
16 px on mobile; 11 px is reserved for tracked uppercase labels, which read
larger than their size.

## Space, radius, motion

4 px rhythm. `--gutter` 18 px on mobile, `--measure` 34 rem so the reading
column stays 35–75 characters. `--tap` 44 px is the floor for anything
interactive, enforced by the e2e suite rather than by good intentions.

Radii are deliberately small (2–6 px). This is print, not a card deck: there
is no elevation scale and no drop shadow anywhere on the share page, because
the moment a rounded card with a soft shadow appears the page starts to look
like every other framework's default.

One motion rhythm — 120 / 200 / 320 ms on a single ease — and
`prefers-reduced-motion: reduce` zeroes all three at the token level, so a
component cannot forget to honour it.

## Fonts as committed files, not as a dependency

The `.woff2`/`.woff` files in `public/fonts/` and `server/assets/fonts/` were
extracted once from the `@fontsource/*` packages and committed. Those packages
are **not** dependencies — nothing at build or run time fetches a font. The
`.woff` duplicates exist only because satori (the OG renderer) cannot parse
`woff2`.
