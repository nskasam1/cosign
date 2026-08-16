// Local analytics: fire-and-forget into the server's events table. Data
// never leaves this machine (decision 11). Event names live here so the
// north-star query and the UI agree on spelling.

/**
 * Every event this product records, as a value rather than only a type, so
 * `src/design/no-bait.test.ts` can read the list and check that none of them
 * is named after something the app did on its own. Everything here is a
 * thing a person did.
 */
export const ANALYTICS_EVENTS = [
  "app_open",
  "log_created",
  "share_viewed",
  "share_created",
  "shop_viewed",
  "freshness_confirmed",
  "ranking_inserted",
  // The Takeout import writes two: `import_previewed` from the server, when a
  // file is read and matched, and this one when a list actually comes of it.
  // The gap between them is the only honest measure of whether the import is
  // worth its screen.
  "import_committed",
  // Phase 5B. `group_started` is written by the server when somebody asks
  // their friends; the other three are the acts on the surfaces this phase
  // adds — asking, answering, and putting a shared list in order.
  "group_started",
  "group_answered",
  "friend_asked",
  "list_reranked",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

export function track(event: AnalyticsEvent, props: Record<string, unknown> = {}): void {
  void fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ event, props }),
  }).catch(() => {
    // analytics must never break the app
  });
}
