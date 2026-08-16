import { useCallback, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { readPosition } from "@/lib/geo";

/**
 * The shelf: four words on a hairline (brief — at most four primary
 * destinations, thumb zone, no hamburger mazes). No icons, because no other
 * surface in this product has one.
 *
 * ONE number, on You, and it counts only the people waiting on an answer
 * from you. Phase 4 wrote "no badges, because nothing here notifies you
 * without a person behind it"; that sentence was aimed at bait, and Phase 5B
 * supersedes it rather than contradicting it. What makes a badge bait is that
 * the product can raise it on its own. This one can be raised only by a
 * friend request or a friend asking where to sit, is never raised by news, is
 * never raised by elapsed time, and is lowered only by answering — where
 * "not now" is an answer. Gold, because a count is a label; never ember,
 * which has two jobs and this is neither of them; and nothing at all at zero.
 *
 * It wraps the destinations only. The log flow, the head-to-head, a group
 * session and onboarding are journeys with their own way out, and a shelf on
 * them would offer a fifth thing to do while you are three taps into a fourth.
 */

interface Tab {
  key: string;
  label: string;
  to: string;
  /** Matches the current pathname to light the ember rule. */
  active: (pathname: string, username: string | null) => boolean;
}

const TABS: Tab[] = [
  { key: "home", label: "Home", to: "/", active: (p) => p === "/" },
  { key: "search", label: "Search", to: "/search", active: (p) => p.startsWith("/search") },
  { key: "log", label: "Log", to: "/log", active: (p) => p.startsWith("/log") },
  {
    key: "you",
    label: "You",
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

  // The log flow's six taps only hold if none of them waits on the network,
  // so the three queries it opens with are warmed on the press that starts
  // it — the same trick Home's entry pill used before the shelf owned it.
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

  return (
    <nav data-shell className="cs-shelf" aria-label="Cosign">
      {TABS.map((tab) => {
        const to = tab.key === "you" && user ? `/${user.username}` : tab.to;
        const current = tab.active(pathname, user?.username ?? null);
        const isLog = tab.key === "log";
        return (
          <Link
            key={tab.key}
            to={to}
            data-tab={tab.key}
            data-log-entry={isLog ? "" : undefined}
            aria-current={current ? "page" : undefined}
            onPointerDown={isLog ? warm : tab.key === "home" ? warmDiscover : undefined}
            className={`cs-tab${isLog ? " cs-tab-log" : ""}`}
          >
            {tab.label}
            {tab.key === "you" && asks > 0 && (
              <span data-waiting={asks} className="cs-figures ml-2 text-gold">
                {asks}
                <span className="sr-only"> people waiting on an answer from you</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
};

export default AppShell;
