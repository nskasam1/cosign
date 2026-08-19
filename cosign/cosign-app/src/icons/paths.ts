// The icon set: path data as string literals, compiled into the bundle.
//
// Cosign has never had an icon. `lucide-react` was one of the 40 dependencies
// Phase 7 deleted, and rule 7 (zero external services) forbids an icon font
// from a CDN — so an icon set here has to be vendored, and a vendored set that
// is a dependency is just a dependency with extra steps.
//
// So these are hand-authored on a 24×24 grid, stroke-only, 1.75 units wide,
// round caps and joins. Authored rather than copied for two reasons: path data
// misremembered from a library renders as convincing garbage that nobody
// notices until it is on screen, and a set drawn to one grid with one stroke
// weight is the "consistent icon family" the design rules ask for rather than
// a pile of glyphs that happen to be nearby.
//
// Every path is designed to sit inside a 2..22 box so that a 24px icon has 2px
// of optical padding on every side and lines up with text without nudging.
//
// **These are drawn, so they must be LOOKED AT.** `scripts/icon-sheet.mjs`
// renders the whole set at three sizes onto one page; a path with a typo in it
// is obvious there and invisible in a diff.

export type IconName = keyof typeof PATHS;

export const PATHS = {
  // ── navigation ──────────────────────────────────────────────────────────
  /** Home. A roof over a doorway — not a compass, which reads as "explore". */
  home: "M3 11.2 12 3.5l9 7.7M5.5 9.6V20a.9.9 0 0 0 .9.9h11.2a.9.9 0 0 0 .9-.9V9.6M9.6 20.9v-5.6a.9.9 0 0 1 .9-.9h3a.9.9 0 0 1 .9.9v5.6",
  /** Search. */
  search: "M10.8 18.1a7.3 7.3 0 1 0 0-14.6 7.3 7.3 0 0 0 0 14.6ZM16.2 16.2 20.9 20.9",
  /** The ranked list — three rows with an ordering mark down the left. */
  list: "M9 6.4h11.4M9 12h11.4M9 17.6h11.4M4.2 6.4h.01M4.2 12h.01M4.2 17.6h.01",
  /** People. Two figures, the second half-behind. */
  people:
    "M15.2 20.4v-1.7a3.4 3.4 0 0 0-3.4-3.4H6.9a3.4 3.4 0 0 0-3.4 3.4v1.7M9.35 11.9a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8M20.5 20.4v-1.7a3.4 3.4 0 0 0-2.6-3.3M15.9 5.2a3.4 3.4 0 0 1 0 6.6",
  /** One person. */
  user: "M18.6 20.4v-1.9a3.6 3.6 0 0 0-3.6-3.6H9a3.6 3.6 0 0 0-3.6 3.6v1.9M12 11.4a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2",

  // ── the act ─────────────────────────────────────────────────────────────
  /** Plus. The FAB — logging a visit. */
  plus: "M12 4.6v14.8M4.6 12h14.8",

  // ── place facts ─────────────────────────────────────────────────────────
  /** A pin. */
  pin: "M19.2 10.4c0 5.1-7.2 10.6-7.2 10.6s-7.2-5.5-7.2-10.6a7.2 7.2 0 1 1 14.4 0Z M12 12.6a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z",
  /** An outlet — the fact the hero query is built on. */
  outlet:
    "M5.4 9.2h13.2a1 1 0 0 1 1 1v3.1a5.6 5.6 0 0 1-5.6 5.6h-4a5.6 5.6 0 0 1-5.6-5.6v-3.1a1 1 0 0 1 1-1Z M8.6 9.2V4.8M15.4 9.2V4.8",
  /** A cup. Coffee, and the log flow's subject. */
  cup: "M4.6 8h11.6v5.4a5.8 5.8 0 0 1-11.6 0V8Z M16.2 9.4h1.6a2.6 2.6 0 0 1 0 5.2h-1.6M4.6 20.4h11.6",
  /** A clock — hours, freshness, "open till". */
  clock: "M12 20.6a8.6 8.6 0 1 0 0-17.2 8.6 8.6 0 0 0 0 17.2Z M12 7.2V12l3.2 1.9",
  /** Wifi. */
  wifi: "M3.4 9.3a13 13 0 0 1 17.2 0M6.6 12.7a8.4 8.4 0 0 1 10.8 0M9.8 16.1a3.9 3.9 0 0 1 4.4 0M12 19.6h.01",
  /** Volume / noise level. */
  noise: "M11.4 5.1 7.2 8.6H4a.8.8 0 0 0-.8.8v5.2a.8.8 0 0 0 .8.8h3.2l4.2 3.5a.6.6 0 0 0 1-.5V5.6a.6.6 0 0 0-1-.5Z M15.8 9.4a3.7 3.7 0 0 1 0 5.2M18.6 6.6a7.6 7.6 0 0 1 0 10.8",

  // ── state and action ────────────────────────────────────────────────────
  check: "M4.8 12.6 9.6 17.4 19.2 6.6",
  x: "M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8",
  chevronRight: "M9.4 5.2 16.2 12l-6.8 6.8",
  chevronLeft: "M14.6 5.2 7.8 12l6.8 6.8",
  chevronDown: "M5.2 9.4 12 16.2l6.8-6.8",
  /** Share — the hero act of this product. */
  share:
    "M12 3.6v11.2M8.2 7.4 12 3.6l3.8 3.8M5.4 13.4v5.6a1.4 1.4 0 0 0 1.4 1.4h10.4a1.4 1.4 0 0 0 1.4-1.4v-5.6",
  /** A bell — notifications, which here only ever come from a person. */
  bell: "M18 9.2a6 6 0 1 0-12 0c0 5-2.2 6.4-2.2 6.4h16.4S18 14.2 18 9.2Z M13.7 19.4a1.9 1.9 0 0 1-3.4 0",
  /** A key — passkeys. */
  key: "M15.6 3.6a4.8 4.8 0 1 0-4.4 6.7L4 17.5v2.9h3.4v-2.2h2.2v-2.2h2.2l2.1-2.1a4.8 4.8 0 0 0 1.7-9.3Z M16.6 7.4h.01",
  /** Import / bring in from elsewhere — the Maps import. */
  download: "M12 4.2v10.4M8 10.6 12 14.6l4-4M4.6 17.4v1.9a1.2 1.2 0 0 0 1.2 1.2h12.4a1.2 1.2 0 0 0 1.2-1.2v-1.9",
  /**
   * Two arrows passing — the head-to-head, "this one or that one".
   * The first attempt drew four disconnected strokes that rendered as
   * scattered zigzags; this is one line and one head per direction.
   */
  versus: "M4 9h16M16.5 5.5 20 9l-3.5 3.5M20 15H4M7.5 11.5 4 15l3.5 3.5",
  /**
   * Three people around one decision — a group session.
   *
   * A full circle in path data needs TWO arcs. The first attempt used one
   * (`a2.3 2.3 0 1 0 0-4.6`) for the two side heads, which is degenerate and
   * rendered them as curls — the icon read as one person with confetti. Every
   * head here is the two-arc form, the same as `people` and `pin`.
   */
  group:
    "M12 5.2a3.1 3.1 0 1 0 0 6.2 3.1 3.1 0 1 0 0-6.2M6.4 20.4a5.6 5.6 0 0 1 11.2 0M4.9 7.6a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 1 0 0-4.2M2 18.6a4 4 0 0 1 2.6-3.4M19.1 7.6a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 1 0 0-4.2M22 18.6a4 4 0 0 0-2.6-3.4",
} as const;

/** Drawn on a 24×24 grid; every consumer uses this viewBox. */
export const VIEW_BOX = "0 0 24 24";
/** One stroke weight for the whole family. */
export const STROKE = 1.75;
