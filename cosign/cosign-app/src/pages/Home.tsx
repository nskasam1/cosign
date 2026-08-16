import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type DiscoverEntry, type DiscoverView } from "@/lib/api";
import { readPosition } from "@/lib/geo";
import { NEAR_ME_MAX_WALK_MIN, crowdOrder, movedBetween, stillOpenIn } from "@/lib/discover";
import { track } from "@/lib/analytics";
import PlaceRow from "@/components/discover/PlaceRow";
import Dateline from "@/components/discover/Dateline";
import Nothing from "@/components/Nothing";

// Home (Phase 4). One column, and the question is its headline.
//
// The hero query is not a chip you go and find: it is the largest thing on
// the page and it has already been answered by the time you arrive. Tapping
// it re-reads where you are and asks again — which is also the only place in
// the product that reads your position, and it says so underneath.
//
// Two orders live here and each one says which it is:
//   the ANSWER is chosen by the query (nearest, or in finals week the one
//   you can sit in longest);
//   the COLUMN is chosen by your people (server/repo/scores.ts — a friend's
//   list outranks the crowd's, at any crowd size).
// Mixing them would let "near me" quietly outrank a friend's number one.

const Home = () => {
  const [asked, setAsked] = useState(() => Date.now());
  const [showCrowd, setShowCrowd] = useState(false);

  const query = useQuery({
    queryKey: ["discover"],
    queryFn: async () => api.discover(await readPosition()),
    staleTime: 60_000,
  });

  useEffect(() => {
    track("app_open");
  }, []);

  const askAgain = useCallback(() => {
    setAsked(Date.now());
    void query.refetch();
  }, [query]);

  const view = query.data;
  // The clock the rows render against is when this data was fetched, not
  // when the page mounted: `closes_in_min` is measured from the server's
  // clock at fetch time, so a stale `now` prints "open till 6 pm" at 8 pm.
  // `asked` still forces a fresh render when the question is re-asked.
  const now = useMemo(
    () => new Date(query.dataUpdatedAt || asked),
    [query.dataUpdatedAt, asked],
  );

  const { answer, alsoMatching, elsewhere } = useMemo(() => split(view), [view]);
  const crowdElsewhere = useMemo(() => crowdOrder(elsewhere), [elsewhere]);
  const moved = useMemo(() => movedBetween(elsewhere, crowdElsewhere), [elsewhere, crowdElsewhere]);
  // Somebody ELSE — `friend_count` includes the viewer's own list, and an
  // account of one is not "in the order of who'd send you there".
  const hasFriends = Boolean(view?.entries.some((e) => e.friends.length > 0));
  // Excludes the answer: it is already the lead, and split()'s promise that
  // nothing appears twice has to hold for this section too.
  const lastCall = useMemo(
    () =>
      view?.hero.mode === "finals"
        ? stillOpenIn(view.entries, 4 * 60)
            .filter((e) => e.id !== view.hero.shop_id)
            .slice(0, 4)
        : [],
    [view],
  );

  if (query.isLoading) {
    // Marked as its own state: `[data-home]` alone would let a test read
    // this screen and conclude the column was empty.
    return (
      <main data-home data-state="loading" className="cs-wrap flex min-h-[60vh] items-center justify-center">
        <p className="cs-caps text-muted">Looking around…</p>
      </main>
    );
  }

  if (!view) {
    return (
      <main data-home data-state="unreachable" className="cs-wrap pt-6">
        <Nothing
          kicker="Cosign"
          standalone
          title="Couldn't see the street from here."
          body="That's this screen, not your list. Nothing you've logged is affected."
          action={
            <button type="button" onClick={() => void query.refetch()} className="cs-pill-ghost">
              Try again
            </button>
          }
        />
      </main>
    );
  }

  const finals = view.hero.mode === "finals";

  return (
    <main data-home data-phase={view.phase} data-hero-mode={view.hero.mode} className="cs-wrap pt-[max(var(--space-5),env(safe-area-inset-top))]">
      <Dateline now={now} phase={view.phase} semester={view.semester} />

      {/* The question, then the answer — and the answer is the bigger of
          the two. You already know what you asked; the place name is the
          thing you came for, so the question is set at 23px and the lead
          below it at 44px. The button sits inside the heading rather than
          around it: a heading is flow content and a button may only contain
          phrasing. */}
      <h1 className="cs-display text-balance text-xl text-line sm:text-2xl">
        <button type="button" data-hero-query onClick={askAgain} className="block w-full pb-3 pt-5 text-left">
          Near me, open now, has outlets.
        </button>
      </h1>
      <div className="h-px w-full bg-ember" aria-hidden="true" />

      {/* The label voice says what the query found; the body voice says what
          it did to find it. Two lines, two jobs — running the promise about
          the position read into the same tracked small caps made a wall of
          them in finals week, which is four lines of shouting. */}
      <p data-hero-summary className="cs-caps mt-3 text-muted">
        {view.hero.matches === 0
          ? `Nothing inside ${NEAR_ME_MAX_WALK_MIN} minutes`
          : `${view.hero.matches} ${view.hero.matches === 1 ? "place" : "places"} inside ${NEAR_ME_MAX_WALK_MIN} minutes`}
        {finals && <span className="text-gold"> · finals week, so somewhere you can stay comes first</span>}
      </p>
      <p data-ask-again className="mt-2 text-xs text-muted">
        Read where you are once, just now, and <span className="text-line">not kept</span>. Tap the question
        to ask again.
      </p>

      {answer ? (
        <section data-answer className="mt-6">
          <PlaceRow place={answer} lead now={now} />
          {alsoMatching.length > 0 && (
            <>
              {/* The heading says exactly what the filter did — these are the
                  other answers to the same query, not a second promise. In
                  finals week the ANSWER is chosen for somewhere you can stay;
                  the rest of the matches are just the rest of the matches, and
                  saying "and you can stay" over a place whose camp_ok is false
                  would be the app inventing a fact. */}
              <p className="cs-caps mt-8 text-gold">Also open now, near you, with an outlet</p>
              <div className="mt-2">
                {alsoMatching.map((p) => (
                  <PlaceRow key={p.id} place={p} now={now} />
                ))}
              </div>
            </>
          )}
        </section>
      ) : (
        <section data-answer="none" className="mt-6">
          <Nothing
            kicker="No answer right now"
            title="Nothing near you is open with an outlet."
            body={
              view.entries.some((e) => e.open_now)
                ? "Somewhere is open — just not somewhere with a plug within a walk. The column below is still the column."
                : "The whole street is shut. This is the honest answer, and it will be a different one in the morning."
            }
          />
        </section>
      )}

      {/* Finals week adds a section that exists in no other week: who is
          still going to be open in four hours, straight off shop_hours.
          The rest of the year this is a question nobody asks. */}
      {finals && (
        <section data-last-call className="mt-10 border-t border-rule-strong pt-6">
          <h2 className="cs-caps text-gold">Still open in four hours</h2>
          <p className="mt-2 text-xs text-muted">
            Straight off their hours, longest first. Whether they will let you sit that long is on
            each of their pages — this only knows the clock.
          </p>
          {lastCall.length === 0 ? (
            <p className="mt-4 text-sm text-line">
              Nothing is. The library it is — and that is a real answer, not a missing one.
            </p>
          ) : (
            <div className="mt-4">
              {lastCall.map((p) => (
                <PlaceRow key={p.id} place={p} now={now} />
              ))}
            </div>
          )}
        </section>
      )}

      <section data-elsewhere data-order={showCrowd ? "crowd" : "friends"} className="mt-10 border-t border-rule-strong pt-6">
        <h2 className="cs-caps text-gold">
          {answer ? "Everywhere else on campus" : "Everywhere on campus"}
        </h2>
        <p className="mt-2 text-xs text-muted">
          {hasFriends
            ? "In the order of who'd send you there, not of how far it is. Where your friends have an opinion, theirs decides — no number of strangers can outvote it. Everywhere they haven't been is ordered by everyone who has, and only your friends are ever named."
            : "In the order of everyone who's put them in order. Add a friend and this becomes their order instead — that is the whole idea."}
        </p>

        {/* You can look at the order you are NOT being given. A claim that
            your friends outrank the crowd is worth nothing if the crowd's
            answer is invisible — and how many places move is the size of
            the claim, printed. */}
        {hasFriends && moved > 0 && (
          <div className="mt-3">
            <p data-moved className="text-xs text-muted">
              {moved} of {elsewhere.length} move when your friends count for more.
            </p>
            {/* On its own line: the word is a 44px target, so sharing a line
                with the sentence gives the whole paragraph a 44px line box
                and strands the wrapped half of it. */}
            <button
              type="button"
              data-crowd-toggle
              aria-pressed={showCrowd}
              onClick={() => setShowCrowd((v) => !v)}
              className="cs-word text-xs text-ember-ink underline underline-offset-4"
            >
              {showCrowd ? "Back to your people's order" : "Show the crowd's order instead"}
            </button>
          </div>
        )}

        <div className="mt-4">
          {(showCrowd ? crowdElsewhere : elsewhere).map((p) => (
            <PlaceRow key={p.id} place={p} now={now} />
          ))}
        </div>
      </section>

      {/* The one line that has to be on the page somewhere, and this is
          where it belongs: at the bottom of the order, under everything it
          is a claim about. Search is a tab; it does not need a link here. */}
      <p className="cs-caps mt-10 text-muted">
        Nothing here is scored, and nothing here was paid for.
      </p>
    </main>
  );
};

/**
 * The answer, the other places that match the same query, and the rest of
 * the campus — in that order, with nothing appearing twice. `entries` is
 * already the friend-weighted column, so `elsewhere` inherits that order for
 * free while the two match lists keep the query's own.
 */
function split(view: DiscoverView | undefined): {
  answer: DiscoverEntry | null;
  alsoMatching: DiscoverEntry[];
  elsewhere: DiscoverEntry[];
} {
  if (!view) return { answer: null, alsoMatching: [], elsewhere: [] };
  const matches = view.entries.filter(
    (e) => e.open_now && (e.amenities?.outlet_count ?? 0) > 0 && e.walk_min <= NEAR_ME_MAX_WALK_MIN,
  );
  const answer = view.entries.find((e) => e.id === view.hero.shop_id) ?? null;
  const matched = new Set(matches.map((e) => e.id));
  return {
    answer,
    alsoMatching: matches
      .filter((e) => e.id !== answer?.id)
      .sort((a, b) => a.walk_min - b.walk_min || a.name.localeCompare(b.name)),
    elsewhere: view.entries.filter((e) => !matched.has(e.id)),
  };
}

export default Home;
