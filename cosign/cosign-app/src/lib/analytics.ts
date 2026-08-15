// Local analytics: fire-and-forget into the server's events table. Data
// never leaves this machine (decision 11). Event names live here so the
// north-star query and the UI agree on spelling.

export type AnalyticsEvent =
  | "app_open"
  | "log_created"
  | "share_viewed"
  | "share_created"
  | "shop_viewed"
  | "freshness_confirmed"
  | "ranking_inserted";

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
