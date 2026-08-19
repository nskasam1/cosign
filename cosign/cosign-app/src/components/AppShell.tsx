import { useCallback, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { readPosition } from "@/lib/geo";
import Icon, { type IconName } from "@/icons/Icon";

/**
 * The shelf: four destinations and one act, on a blurred bar.
 *
 * It was four WORDS — Home / Search / Log / You — and that was most of what
 * the founder meant by "navigatability is subpar" and "not enough features".
 * Cosign already had friends, friend requests, group decision sessions,
 * collaborative lists, an activity feed, place re-verification and the Google
 * Maps import; `/rank`, `/lists/:id` and `/group/new` had NO navigation entry
 * at all and were reachable only by deep link. The app was far more capable
 * than it looked, which is the worst combination there is.
 *
 * So: Home · Search · (+) · Crew · You.
 *   - CREW is the new hub, and it is where the buried social layer finally
 *     gets a door.
 *   - The centre slot is the compose FAB, not a destination — which is how the
 *     brief's "at most four primary destinations" still holds exactly.
 *
 * ONE number, on You, and it counts only the people waiting on an answer from
 * you. Unchanged from Phase 5B, and the reasoning with it: what makes a badge
 * bait is that the product can raise it on its own. This one can be raised
 * only by a friend request or a friend asking where to sit, is never raised by
 * news, is never raised by elapsed time, and is lowered only by answering —
 * where "not now" is an answer.
 *
 * The `data-tab` values home/search/log/you are load-bearing: the e2e suite
 * keys on them. `crew` is added; nothing is renamed.
 */

interface Tab {
  key: string;
  label: string;
  icon: IconName;
  to: string;
  active: (pathname: string, username: string | null) => boolean;
}

const LEFT: Tab[] = [
  { key: "home", label: "Home", icon: "home", to: "/", active: (p) => p === "/" },
  {
    key: "search",
    label: "Search",
    icon: "search",
    to: "/search",
    active: (p) => p.startsWith("/search"),
  },
];

const RIGHT: Tab[] = [
  { key: "crew", label: "Crew", icon: "people", to: "/crew", active: (p) => p.startsWith("/crew") },
  {
    key: "you",
    label: "You",
    icon: "user",
    to: "/onboarding",
    active: (p, username) => Boolean(username) && p === `/${username}`,
  },
];

const AppShell = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-dvh flex-col">
    <div className="flex-1 pb-6">{children}</div>
    <Shelf />
  </div>
);

const Shelf = () => {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const qc = useQueryClient();

  // Only the asks. A logged-out reader has none, and neither does anybody
  // whose feed is only news.
  const waiting = useQuery({
    queryKey: ["notifications", user?.id ?? "-"],
    queryFn: api.notifications,
    enabled: !!user,
    staleTime: 30_000,
  });
  const asks = waiting.data?.entries.filter((e) => e.needs_answer).length ?? 0;

  // The log flow's taps only hold if none of them waits on the network, so the
  // three queries it opens with are warmed on the press that starts it.
  const warm = useCallback(() => {
    const opts = { staleTime: 5 * 60_000 };
    void qc.prefetchQuery({ queryKey: ["shops"], queryFn: api.shops, ...opts });
    void qc.prefetchQuery({ queryKey: ["meta"], queryFn: api.meta, ...opts });
    void qc.prefetchQuery({ queryKey: ["ranking", "me"], queryFn: api.myRanking, ...opts });
  }, [qc]);

  const warmDiscover = useCallback(() => {
    void qc.prefetchQuery({
      queryKey: ["discover"],
      queryFn: async () => api.discover(await readPosition()),
      staleTime: 60_000,
    });
  }, [qc]);

  const item = (tab: Tab) => {
    const to = tab.key === "you" && user ? `/${user.username}` : tab.to;
    const current = tab.active(pathname, user?.username ?? null);
    return (
      <Link
        key={tab.key}
        to={to}
        data-tab={tab.key}
        aria-current={current ? "page" : undefined}
        onPointerDown={tab.key === "home" ? warmDiscover : undefined}
        className="cs-tabitem"
      >
        <Icon name={tab.icon} size={23} />
        <span>{tab.label}</span>
        {tab.key === "you" && asks > 0 && (
          <span
            data-waiting={asks}
            className="absolute right-[24%] top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-gold px-1 text-[10px] font-bold leading-none text-[hsl(var(--bg))]"
          >
            {asks}
            <span className="sr-only">
              {asks === 1
                ? " person waiting on an answer from you"
                : " people waiting on an answer from you"}
            </span>
          </span>
        )}
      </Link>
    );
  };

  return (
    <nav data-shell className="cs-tabbar" aria-label="Cosign">
      {LEFT.map(item)}
      {/* The act, not a destination. `data-tab="log"` and `data-log-entry` are
          both kept: the first is asserted across the suite, the second is what
          the prefetch hangs off. Its accessible name is on the link, because
          the FAB carries no visible label — an icon-only control without one
          is unusable and `a11y-probe.mjs` fails the build on it. */}
      <Link
        to="/log"
        data-tab="log"
        data-log-entry=""
        aria-label="Log a visit"
        onPointerDown={warm}
        className="cs-fab"
      >
        <Icon name="plus" size={26} />
      </Link>
      {RIGHT.map(item)}
    </nav>
  );
};

export default AppShell;
