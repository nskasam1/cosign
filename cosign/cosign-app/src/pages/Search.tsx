import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type DiscoverEntry } from "@/lib/api";
import { readPosition } from "@/lib/geo";
import PlaceRow from "@/components/discover/PlaceRow";
import Nothing from "@/components/Nothing";

// Search: the same column, narrowed. Every filter is a FACT about a place —
// open, outlets, walk, whether you can stay, whether the discount is real.
// There is nothing to filter by quality, because nothing here has a quality
// score to filter by; the order already carries that, and it belongs to your
// friends rather than to a number.

interface Facet {
  key: string;
  label: string;
  match: (p: DiscoverEntry) => boolean;
}

const FACETS: Facet[] = [
  { key: "open", label: "Open now", match: (p) => p.open_now },
  { key: "outlets", label: "Has outlets", match: (p) => (p.amenities?.outlet_count ?? 0) > 0 },
  { key: "close", label: "Ten minutes or less", match: (p) => p.walk_min <= 10 },
  { key: "stay", label: "Fine to stay four hours", match: (p) => p.camp_ok },
  { key: "discount", label: "Student discount", match: (p) => p.student_discount },
];

const Search = () => {
  const [text, setText] = useState("");
  const [on, setOn] = useState<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ["discover"],
    queryFn: async () => api.discover(await readPosition()),
    staleTime: 60_000,
  });

  // Pinned to when the data arrived, not to when the page mounted.
  // `closes_in_min` is relative to the server's clock at fetch time, and the
  // rows render `now + closes_in_min` — so a tab left open for four hours and
  // refetched on focus would print a closing time in the past.
  const now = useMemo(() => new Date(query.dataUpdatedAt || Date.now()), [query.dataUpdatedAt]);
  // A fresh `?? []` every render would give the filter below a new identity
  // each time and re-run it on every keystroke of an unrelated state change.
  const entries = useMemo(() => query.data?.entries ?? [], [query.data]);

  const results = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return entries.filter((p) => {
      if (needle && !`${p.name} ${p.address}`.toLowerCase().includes(needle)) return false;
      for (const facet of FACETS) if (on.has(facet.key) && !facet.match(p)) return false;
      return true;
    });
  }, [entries, text, on]);

  const unreachable = !query.isLoading && !query.data;

  const toggle = (key: string) =>
    setOn((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <main
      data-search
      data-state={unreachable ? "unreachable" : query.isLoading ? "loading" : undefined}
      className="cs-wrap pt-[max(var(--space-5),env(safe-area-inset-top))]"
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-rule pb-4">
        <p className="cs-caps text-gold">Cosign · looking</p>
        <Link to="/" className="cs-word cs-caps text-muted">
          Home
        </Link>
      </div>

      <h1 className="cs-display mt-5 text-3xl text-ink">What are you after?</h1>

      <label htmlFor="place-search" className="sr-only">
        Search places by name or street
      </label>
      <input
        id="place-search"
        data-search-input
        type="text"
        autoComplete="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="A name, or a street"
        className="mt-4 w-full rounded-[var(--radius-md)] border border-rule-strong bg-surface p-3 text-base text-ink placeholder:text-muted"
      />

      <div
        role="group"
        aria-label="Narrow it down"
        className="no-scrollbar -mx-[var(--gutter)] mt-4 flex gap-2 overflow-x-auto px-[var(--gutter)] pb-1"
      >
        {FACETS.map((facet) => (
          <button
            key={facet.key}
            type="button"
            data-facet={facet.key}
            aria-pressed={on.has(facet.key)}
            onClick={() => toggle(facet.key)}
            className="cs-chip"
          >
            {facet.label}
          </button>
        ))}
      </div>

      {/* Gate on ABSENT DATA, not on `isError`: a query paused because the
          browser went offline is neither loading nor errored, and an unread
          campus is indistinguishable from an empty one — which would render
          "nowhere on this campus is all of those at once" as the designed
          answer to a dropped connection. Same rule as PlaceFlow's, which is
          where Phase 3 learned it: never infer from an absence. */}
      {unreachable ? (
        <div className="mt-6">
          <Nothing
            kicker="Couldn't look"
            title="The list didn't load, so there's nothing to search yet."
            body="That's this screen, not the campus. Nothing you've logged or ranked is affected."
            action={
              <button type="button" data-retry onClick={() => void query.refetch()} className="cs-pill-ghost">
                Try again
              </button>
            }
          />
        </div>
      ) : (
        <>
          <p data-search-count role="status" className="cs-caps mt-5 text-muted">
            {query.isLoading
              ? "Looking…"
              : results.length === entries.length
                ? `All ${entries.length}, in the order of who'd send you there`
                : `${results.length} of ${entries.length}`}
          </p>

          {!query.isLoading && results.length === 0 && (
            <div className="mt-6">
              <Nothing
                kicker="Nothing matches"
                title="Nowhere on this campus is all of those at once."
                body="Drop the hardest one — usually that's the walk, or the hours. Cosign only knows the places around campus somebody has actually been to, and it would rather say so than invent one."
                action={
                  <button
                    type="button"
                    data-clear
                    onClick={() => {
                      setOn(new Set());
                      setText("");
                    }}
                    className="cs-pill-ghost"
                  >
                    Start over
                  </button>
                }
              />
            </div>
          )}

          <div className="mt-4">
            {results.map((p) => (
              <PlaceRow key={p.id} place={p} now={now} />
            ))}
          </div>
        </>
      )}
    </main>
  );
};

export default Search;
