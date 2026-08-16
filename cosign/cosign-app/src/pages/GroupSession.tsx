import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type GroupView } from "@/lib/api";
import { getParticipantToken } from "@/lib/participantToken";
import { paletteOf, paletteStyle } from "@/lib/palette";
import { readPosition } from "@/lib/geo";
import { track } from "@/lib/analytics";
import { useTitle } from "@/lib/title";
import { INTENT_TAGS, INTENT_TAG_LABELS_SHORT, type IntentTag, type NoiseLevel } from "@/types/cosign";
import { useAuth } from "@/hooks/useAuth";
import PlacePlate from "@/components/log/PlacePlate";
import Nothing from "@/components/Nothing";

/**
 * Group decision mode (brief #8): four people, one table that works for all
 * of them.
 *
 * Nobody votes. Each person says what they need; the needs union into
 * constraints every candidate has to satisfy; and the survivors are ordered
 * by what the group's own ranked lists already say. The arithmetic is printed
 * on the page, because an answer nobody chose is only trustworthy if you can
 * see how it was reached.
 *
 * No login wall and no shelf. A seat needs no account — signing in only adds
 * your own ordered list to the arithmetic — and a session is a journey with
 * one way out, so the only navigation on it is the word LEAVE.
 */

type Draft = {
  intent: IntentTag | null;
  outlets: boolean;
  open_now: boolean;
  wifi: boolean;
  max_noise: NoiseLevel | null;
  name: string;
};

const CONSTRAINTS: Array<{ key: keyof Draft; label: string; gloss: string }> = [
  { key: "outlets", label: "An outlet", gloss: "Battery is a lie by about four o'clock" },
  { key: "wifi", label: "Wifi that holds", gloss: "A tab open is not the same as a call" },
  { key: "open_now", label: "Open right now", gloss: "Not somewhere that shuts before you sit down" },
];

const NOISE: Array<{ value: NoiseLevel; label: string; gloss: string }> = [
  { value: "quiet", label: "Quiet, or I can't work", gloss: "You could hear people typing" },
  { value: "conversational", label: "A normal café hum is fine", gloss: "Talking, music, fine with one earbud" },
  { value: "loud", label: "Loud is fine", gloss: "You would have had to raise your voice" },
];

/** A table is small enough to say out loud. */
const NUMBER_WORDS: Record<number, string> = { 1: "one", 2: "two", 3: "three", 4: "four" };

const NEED_WORDS: Record<string, string> = {
  open_now: "open now",
  outlets: "an outlet",
  wifi: "wifi that holds",
  noise: "how loud it gets",
  table: "somewhere to sit",
};

const GroupSession = () => {
  const { sessionId } = useParams();
  const { user } = useAuth();
  const [view, setView] = useState<GroupView | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "gone">("loading");
  const [answering, setAnswering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<Draft>({
    intent: null,
    outlets: false,
    // Nothing is pre-answered: a need somebody did not tap is a need
    // somebody did not have, and pre-selecting one puts a word in their mouth
    // that the ledger then charges to their name.
    open_now: false,
    wifi: false,
    max_noise: null,
    name: "",
  });
  const token = useMemo(() => getParticipantToken(), []);
  // A dead link names itself too — a tab that still says "Cosign" is the tab
  // that made every route indistinguishable before Phase 5A's title fix.
  useTitle(state === "loading" ? null : view ? "A table for four" : "Nothing at this address");

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      // The position is read momentarily for the walking times on this one
      // response and is stored nowhere (decision 12).
      const at = await readPosition();
      setView(await api.group(sessionId, { at, participantToken: token }));
      setState("ok");
    } catch {
      setView(null);
      setState("gone");
    }
  }, [sessionId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = view?.answers.find((a) => a.is_you) ?? null;

  useEffect(() => {
    if (!mine) return;
    setDraft((d) => ({
      ...d,
      intent: mine.intent_tag,
      outlets: mine.outlets,
      open_now: mine.open_now,
      wifi: mine.wifi,
      max_noise: mine.max_noise,
    }));
  }, [mine]);

  const submit = async () => {
    if (!sessionId || busy) return;
    setBusy(true);
    try {
      await api.submitGroupNeeds(sessionId, {
        participant_token: token,
        display_name: draft.name.trim() || null,
        intent_tag: draft.intent,
        outlets: draft.outlets,
        open_now: draft.open_now,
        wifi: draft.wifi,
        max_noise: draft.max_noise,
      });
      track("group_answered", { session_id: sessionId });
      setAnswering(false);
      setSaid(null);
      await load();
    } catch {
      setSaid("That didn't send. Nothing was answered — tap it again.");
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (state === "loading") {
    return (
      <main data-group data-state="loading" className="cs-wrap flex min-h-dvh items-center justify-center">
        <p className="cs-display text-muted">Looking.</p>
      </main>
    );
  }

  if (!view) {
    return (
      <main data-group data-state="gone" className="cs-wrap flex min-h-dvh flex-col justify-center pb-10">
        <Nothing
          kicker="Nothing here"
          standalone
          title="That link doesn't open anything."
          body="A table in Cosign is four people and one evening. If this one was ever real, it has ended — and nothing about it was kept: not where any of them were, not what any of them needed."
          action={
            <Link to="/" className="cs-pill-ghost">
              Back home
            </Link>
          }
        />
      </main>
    );
  }

  const best = view.picks[0] ?? null;
  const bestPlace = best ? view.places[best.shop_id] : null;
  const full = view.answers.length >= 4 && !mine;
  const showForm = answering || (!mine && !full);
  const starter = view.starter?.display_name.split(" ")[0] ?? "Somebody";
  const settled = view.session.status !== "open";
  // Whoever was asked, or whoever turned up — a link can be forwarded, so
  // the table is as big as the larger of the two.
  const party = Math.max(view.invited, view.answers.length);

  return (
    <main data-group data-session={view.session.id} data-state={view.state} className="cs-wrap pb-16 pt-[max(var(--space-4),env(safe-area-inset-top))]">
      <div className="flex items-baseline justify-between gap-4">
        <Link to="/" className="cs-word cs-caps text-muted">
          Leave
        </Link>
        <p className="cs-caps text-right text-gold">Cosign · a table for four</p>
      </div>

      <h1 className="cs-display mt-4 text-balance text-xl text-line">
        {party === 1
          ? "Somewhere you can work tonight."
          : `Somewhere all ${NUMBER_WORDS[party] ?? party} of you can work tonight.`}
      </h1>
      <div className="mt-4 h-px bg-ember" />
      <p data-state-line className="cs-caps mt-4 text-muted">
        {starter} asked ·{" "}
        {view.state === "complete"
          ? "everybody answered"
          : `${view.answers.length} of ${view.invited} have answered`}{" "}
        · nobody voted
      </p>

      {/* The roster, at the top in every state: the page is composed of the
          seats it has to satisfy. Names only — no avatar, no monogram; a
          column of monograms is an avatar row by another name. */}
      {/* A seat is two lines, not a ledger row: what somebody needs is prose
          and prose in a figure column is what makes a page scroll sideways. */}
      <section data-roster className="mt-7">
        <h2 className="cs-caps text-gold">Who is at the table</h2>
        <ul className="mt-3">
          {view.answers.map((a) => (
            <li key={a.participant} data-seat className="border-t border-rule py-3 first:border-t-0">
              <p className="cs-caps text-line">
                {a.display_name ?? "The fourth"}
                {a.is_you && " (you)"}
              </p>
              <p className="cs-caps mt-1 text-muted">
                {[
                  a.intent_tag && INTENT_TAG_LABELS_SHORT[a.intent_tag],
                  a.outlets && "an outlet",
                  a.wifi && "wifi that holds",
                  a.open_now && "open now",
                  a.max_noise && (a.max_noise === "quiet" ? "quiet only" : `no louder than ${a.max_noise}`),
                ]
                  .filter(Boolean)
                  .join(" · ") || "nothing in particular"}
              </p>
            </li>
          ))}
          {Array.from({ length: Math.max(0, view.invited - view.answers.length) }).map((_, i) => (
            <li key={`empty-${i}`} data-seat="empty" className="border-t border-rule py-3">
              <p className="cs-caps text-muted">Still to answer</p>
              {/* An empty seat is a hairline where the needs would be. */}
              <span className="mt-2 block h-px w-36 bg-rule-strong" />
            </li>
          ))}
        </ul>
      </section>

      {showForm ? (
        <NeedsForm
          draft={draft}
          setDraft={setDraft}
          onSubmit={submit}
          busy={busy}
          signedIn={!!user}
          editing={!!mine}
          onCancel={mine ? () => setAnswering(false) : undefined}
        />
      ) : full ? (
        <div className="mt-8">
          <Nothing
            kicker="Four seats"
            title="Four seats, and all four are taken."
            body={`A table in Cosign is four people. Ask ${starter} to start another one.`}
          />
        </div>
      ) : (
        <>
          {view.state === "alone" ? (
            <section data-alone className="mt-9 border-t border-rule-strong pt-5">
              <h2 className="cs-caps text-gold">Waiting on the others</h2>
              <p className="cs-display mt-3 text-balance text-2xl text-ink">
                One answer is not a table.
              </p>
              <p className="mt-3 text-sm text-line">
                Nothing is worked out until two of you have said what you need. Send the link on and this
                page starts answering — and it can only ever get shorter from there.
              </p>
              <LinkBlock onCopy={copyLink} copied={copied} />
            </section>
          ) : best && bestPlace ? (
            <>
              <section data-answer className="mt-9 border-t border-rule-strong pt-5">
                <h2 className="cs-caps text-gold">
                  {view.state === "complete" ? "The one that clears everything" : "Clears everything so far"}
                </h2>
                <p className="cs-display mt-2 text-balance text-4xl text-ink">{bestPlace.name}</p>
                {/* The PLACE's facts, not a restatement of what was asked. */}
                <p className="cs-caps cs-figures mt-3 text-muted">
                  {[
                    `${bestPlace.walk_min} min walk`,
                    bestPlace.closes_in_min !== null && closesIn(bestPlace.closes_in_min),
                    bestPlace.outlet_count ? `${bestPlace.outlet_count} outlets` : null,
                    bestPlace.wifi_mbps ? `${bestPlace.wifi_mbps} Mbps` : "no wifi",
                    bestPlace.noise && `${bestPlace.noise} in ${bestPlace.noise_samples} logs at this hour`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {bestPlace.photo && (
                  <img
                    src={bestPlace.photo}
                    alt=""
                    width={640}
                    height={480}
                    className="cs-shot mt-5 aspect-[4/3] w-full"
                  />
                )}
                <p className="cs-display mt-5 text-lg text-ink">{leadFor(view, best)}</p>
                <p className="mt-2 text-sm text-line">
                  {view.funnel.left === 1
                    ? "It is the only place open tonight that meets everything "
                    : `It is the best of the ${view.funnel.left} places open tonight that meet everything `}
                  {view.answers.length === 2 ? "both" : "all"} of you said you needed. The place none of you
                  would have named first is the place none of you has to give something up for.
                </p>
                {view.state !== "complete" && (
                  <p className="mt-3 text-xs text-muted">
                    Two people can only take places off this list. Nothing anybody says next can add one —
                    that is what an intersection is, which is why this page shows the running answer instead
                    of a spinner.
                  </p>
                )}
              </section>

              {view.seated && best.positions.length + best.never_been.length > 0 && (
                <section data-whose className="mt-8">
                  <h3 className="cs-caps text-gold">Whose lists it is on</h3>
                  <dl className="cs-ledger mt-3 text-sm">
                    {best.positions.map((p) => (
                      <Fragment key={p.user_id}>
                        <dt className="text-line">{view.members[p.user_id] ?? "Somebody"}</dt>
                        <dd className="cs-caps cs-figures text-muted">has it {p.position}</dd>
                      </Fragment>
                    ))}
                    {best.never_been.map((n) => (
                      <Fragment key={n}>
                        <dt className="text-line">{n}</dt>
                        <dd className="cs-caps text-muted">never been</dd>
                      </Fragment>
                    ))}
                  </dl>
                  <p className="mt-3 text-xs text-muted">
                    Never been is not a vote against it. It is the difference between somebody having no
                    opinion and somebody having a low one, and this page keeps them apart.
                  </p>
                </section>
              )}

              {!view.seated && (
                <p className="mt-6 text-xs text-muted">
                  On {best.coverage} of the {view.answers.length} lists at this table. Which lists, and where,
                  is not something a link can read — everybody's ranking is friends-only, and sitting at a
                  table is not a friendship.
                </p>
              )}

              <Ledger view={view} />

              {view.one_need_away.length > 0 && (
                <section data-one-away className="mt-9 border-t border-rule pt-5">
                  <h3 className="cs-caps text-gold">One need away</h3>
                  <p className="mt-3 text-sm text-line">
                    Each of these fails exactly one thing somebody asked for, and it says which, and whose.
                  </p>
                  <ul className="mt-4">
                    {view.one_need_away.map((n) => {
                      const p = view.places[n.shop_id];
                      const who = n.askedBy
                        .map((t) => view.answers.find((a) => a.participant === t)?.display_name ?? "somebody")
                        .join(" and ");
                      return (
                        <li key={n.shop_id} style={paletteStyle(paletteOf(p.palette))}>
                          <Link to={`/shop/${p.slug}`} className="cs-row block py-4">
                            <span className="cs-caps block text-gold">
                              Out on {who}
                              {"'s "}
                              {NEED_WORDS[n.key] ?? n.detail}
                            </span>
                            <span className="cs-display mt-1 block text-lg text-ink">{p.name}</span>
                            <span className="cs-caps cs-figures mt-1 block text-muted">
                              {p.walk_min} min walk
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              <section className="mt-9 border-t border-rule pt-5">
                <h3 className="cs-caps text-gold">How this was picked</h3>
                <p className="mt-3 text-sm text-muted">
                  Everything open. Then everything that meets every need at this table — a need is never
                  traded against another one and nobody's counts for more, so more needs can only ever make
                  the list shorter. Then, between whatever survives, the order of the people sitting here:
                  whether anybody has it low first, how many of these lists it is on second.
                </p>
                <p className="mt-3 text-sm text-muted">
                  Nobody voted. A vote is a rating with extra steps, and it would have handed this table to
                  whoever brought the most friends.
                </p>
              </section>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link to={`/shop/${bestPlace.slug}`} className="cs-pill-ghost">
                  {bestPlace.name} · {bestPlace.walk_min} min
                </Link>
                <button
                  type="button"
                  data-change
                  onClick={() => setAnswering(true)}
                  className="cs-word text-sm text-muted underline underline-offset-4"
                >
                  change what you need
                </button>
              </div>
            </>
          ) : view.unknown_to_all.length > 0 ? (
            // Everything the group asked for is met — by places none of them
            // has ever put in order. That is a different answer from "nothing
            // clears it", and saying the wrong one would be the page's worst
            // failure: it would send four people home over a full campus.
            <>
              <section data-none-been className="mt-9 border-t border-rule-strong pt-5">
                <h2 className="cs-caps text-gold">Clears everything, and nobody here has been</h2>
                <p className="cs-display mt-2 text-balance text-3xl text-ink">
                  {view.places[view.unknown_to_all[0]].name}
                </p>
                <p className="mt-3 text-sm text-line">
                  {view.funnel.left === 1
                    ? "One place meets everything asked for at this table"
                    : `${view.funnel.left} places meet everything asked for at this table`}
                  , and none of you has put any of them in order. So there is nothing here to say which is
                  better — only that each one clears what you said you needed
                  {view.funnel.left > view.unknown_to_all.length
                    ? `. The ${view.unknown_to_all.length} nearest are below.`
                    : "."}
                </p>
                <ul className="mt-5">
                  {view.unknown_to_all.map((id) => {
                    const p = view.places[id];
                    return (
                      <li key={id} style={paletteStyle(paletteOf(p.palette))}>
                        <Link to={`/shop/${p.slug}`} className="cs-row block py-4">
                          <span className="cs-display block text-lg text-ink">{p.name}</span>
                          <span className="cs-caps cs-figures mt-1 block text-muted">
                            {p.walk_min} min walk
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-4 text-xs text-muted">
                  Cosign will not put them in an order it has no reason to believe. Log one and it starts
                  having a reason.
                </p>
              </section>
              <Ledger view={view} />
            </>
          ) : (
            <>
              <section data-empty className="mt-9 border-t border-rule-strong pt-5">
                <h2 className="cs-caps text-gold">Nothing clears all of it</h2>
                <p className="cs-display mt-2 text-balance text-3xl text-ink">
                  {view.costliest
                    ? `Nowhere open meets ${view.answers.length === 2 ? "both" : "all"} of these at once.`
                    : "Nothing on this campus clears it tonight."}
                </p>
                <p className="mt-3 text-sm text-line">
                  {view.answers.length} of you asked for things that can't all be true at the same hour.
                  Cosign will not quietly relax one to have something to show you — needs that can't all
                  hold is a real answer, and it beats a fifth-best table nobody asked for.
                </p>
              </section>

              <Ledger view={view} />

              <section data-costs className="mt-9 border-t border-rule pt-5">
                <h3 className="cs-caps text-gold">What each need costs</h3>
                <p className="mt-3 text-sm text-line">
                  One of these is somebody's evening. Cosign can say what each one is worth; it can't pick.
                </p>
                <ul className="mt-4">
                  {view.costs.map((c) => {
                    const who = c.askedBy
                      .map((t) => view.answers.find((a) => a.participant === t)?.display_name ?? "somebody")
                      .join(" and ");
                    const example = c.example ? view.places[c.example] : null;
                    const isMine = mine ? c.askedBy.includes(mine.participant) : false;
                    return (
                      <li key={c.key} className="border-t border-rule py-4 first:border-t-0">
                        <p className="cs-caps text-gold">
                          Drop {who}
                          {"'s "}
                          {c.detail}
                        </p>
                        {c.unlocks === 0 ? (
                          <>
                            <p className="cs-display mt-1 text-lg text-ink">Nothing changes.</p>
                            <p className="mt-1 text-xs text-muted">
                              Still nowhere. That is not what is costing you tonight, and giving it up would
                              buy this table exactly nothing.
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="cs-display mt-1 text-lg text-ink">
                              {example?.name ?? `${c.unlocks} places`}
                            </p>
                            <p className="cs-caps cs-figures mt-1 text-muted">
                              {c.unlocks} {c.unlocks === 1 ? "place" : "places"} open up
                            </p>
                          </>
                        )}
                        {isMine && c.unlocks > 0 && (
                          <button
                            type="button"
                            data-drop-mine
                            onClick={() => setAnswering(true)}
                            className="cs-word mt-2 text-xs text-ember-ink underline underline-offset-4"
                          >
                            drop mine
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-4 text-xs text-muted">
                  You can only drop your own. Whoever asked for a thing is the one who gets to give it up, so
                  this page tells everybody what each one is worth and then stays out of it.
                </p>
              </section>

              <div className="mt-8">
                <button type="button" data-change onClick={() => setAnswering(true)} className="cs-pill-ghost">
                  Change what you need
                </button>
              </div>
            </>
          )}

          {view.unvouched.length > 0 && (
            <section data-unvouched className="mt-9 border-t border-rule pt-5">
              <h3 className="cs-caps text-gold">Nobody has logged these at this hour</h3>
              <p className="mt-3 text-sm text-line">
                {view.unvouched.map((id) => view.places[id].name).join(", ")} would clear everything else,
                but how loud a room is comes from what people wrote down while they were sitting in it — and
                nobody has, at this time of day. An unknown is not a yes, and Cosign will not fill one in.
              </p>
            </section>
          )}

          {settled && view.resolved_shop_id && (
            <p data-resolved className="cs-caps mt-8 text-ember-ink">
              {view.places[view.resolved_shop_id]?.name ?? "Somewhere"} it is.
            </p>
          )}
        </>
      )}

      {said && <p data-said className="cs-caps mt-6 text-ember-ink">{said}</p>}

      <p className="mt-10 border-t border-rule pt-5 text-xs text-muted">
        This table lives in this browser and in nobody's history. Nothing about it is kept — not where any
        of you were, not what any of you needed. Cosign will not nudge anybody about it: there is no timer on
        this page and it sends nothing on its own.
      </p>
      <p className="cs-caps mt-4 text-muted">Nothing here is scored, and nothing here was paid for.</p>
    </main>
  );
};

/** "open till 2" / "shuts in 40 min" — a fact, in the words a person uses. */
function closesIn(minutes: number): string {
  if (minutes >= 240) return `open for ${Math.floor(minutes / 60)} more hours`;
  if (minutes >= 90) return `open for another ${Math.floor(minutes / 60)} hours`;
  return `shuts in ${minutes} min`;
}

/**
 * The one sentence above the answer, and it has to be true of THIS answer
 * rather than of the idea of one. Five rules, first that qualifies wins — the
 * shape Phase 5A's `computeFinding` established.
 */
function leadFor(view: GroupView, best: GroupView["picks"][number]): string {
  if (!view.seated) return "The one place that clears everything.";
  if (best.coverage === 0) return "Nobody here has been.";
  const firsts = best.positions.filter((p) => p.position === 1);
  const names = best.positions.map((p) => view.members[p.user_id] ?? "Somebody");
  if (best.coverage === view.answers.length) return "Everybody here has been, and nobody has it low.";
  if (firsts.length > 0) {
    return `${view.members[firsts[0].user_id] ?? "Somebody"}'s first, and nobody else objects.`;
  }
  if (best.coverage === 1) return `Only ${names[0]} has been.`;
  return "Nobody's favourite.";
}

/** The subtraction, printed. */
const Ledger = ({ view }: { view: GroupView }) => (
  <section data-ledger className="mt-9 border-t border-rule pt-5">
    <h3 className="cs-caps text-gold">
      How {view.funnel.total} became {view.funnel.left}
    </h3>
    <dl className="cs-ledger mt-3 text-sm">
      <Fragment>
        <dt className="text-line">Places on campus</dt>
        <dd className="cs-figures text-line">{view.funnel.total}</dd>
      </Fragment>
      {view.funnel.steps.map((s) => {
        const who = s.askedBy
          .map((t) => view.answers.find((a) => a.participant === t)?.display_name ?? "somebody")
          .join(" and ");
        return (
          <Fragment key={s.key}>
            <dt className="text-line">
              Without {NEED_WORDS[s.key] ?? s.detail}
              {who && <span className="cs-caps ml-2 text-muted">{who} asked</span>}
            </dt>
            <dd className="cs-figures text-muted">&minus;{s.removed}</dd>
          </Fragment>
        );
      })}
      {view.funnel.held > 0 && (
        <Fragment>
          <dt className="text-line">
            Nobody has logged them at this hour
            <span className="cs-caps ml-2 text-gold">held, not ruled out</span>
          </dt>
          <dd className="cs-figures text-muted">{view.funnel.held}</dd>
        </Fragment>
      )}
      <Fragment>
        <dt className="text-ink">Clears everything asked for</dt>
        <dd className="cs-display cs-figures text-2xl text-ink">{view.funnel.left}</dd>
      </Fragment>
    </dl>
    {view.funnel.steps.some((s) => s.removed === 0) && (
      <p className="mt-3 text-xs text-muted">
        {view.funnel.steps
          .filter((s) => s.removed === 0)
          .map((s) => NEED_WORDS[s.key] ?? s.detail)
          .join(" and ")}{" "}
        cost nothing tonight — everywhere still standing already has it.
      </p>
    )}
  </section>
);

const LinkBlock = ({ onCopy, copied }: { onCopy: () => void; copied: boolean }) => (
  <div className="mt-6">
    <p className="cs-caps text-muted">Getting the others in</p>
    <p className="mt-2 break-all text-sm text-line">{window.location.href}</p>
    <button type="button" data-copy-link onClick={onCopy} className="cs-pill-ghost mt-4">
      {copied ? "Copied" : "Copy the link again"}
    </button>
    <p className="mt-3 text-xs text-muted">
      The link works with no account and no password. Anyone who opens it can say what they need. Nobody who
      opens it can see anybody's ranked list.
    </p>
  </div>
);

/**
 * One screen, three questions, one commit. The intent is single-select, so it
 * is the one field allowed a filled ember chip; the constraints and the noise
 * cap are multi-select statement rows carrying the 2 px ember margin mark,
 * because four filled lozenges in one viewport turn the active-chip signal
 * into wallpaper.
 */
const NeedsForm = ({
  draft,
  setDraft,
  onSubmit,
  busy,
  signedIn,
  editing,
  onCancel,
}: {
  draft: Draft;
  setDraft: (f: (d: Draft) => Draft) => void;
  onSubmit: () => void;
  busy: boolean;
  signedIn: boolean;
  editing: boolean;
  onCancel?: () => void;
}) => (
  <section data-needs-form className="mt-9 border-t border-rule-strong pt-5">
    <h2 className="cs-caps text-gold">Why are you going?</h2>
    <p className="mt-2 text-xs text-muted">One thing. Yours doesn't have to match theirs.</p>
    <div className="mt-4 flex flex-wrap gap-2">
      {INTENT_TAGS.map((tag) => (
        <button
          key={tag}
          type="button"
          data-intent={tag}
          aria-pressed={draft.intent === tag}
          onClick={() => setDraft((d) => ({ ...d, intent: d.intent === tag ? null : tag }))}
          className="cs-chip"
        >
          {INTENT_TAG_LABELS_SHORT[tag]}
        </button>
      ))}
    </div>

    <h2 className="cs-caps mt-8 text-gold">What can't you do without?</h2>
    <p className="mt-2 text-xs text-muted">
      Tap any that are true. Every one you tap can only make the answer shorter, never longer.
    </p>
    <div className="mt-3">
      {CONSTRAINTS.map((c) => (
        <button
          key={String(c.key)}
          type="button"
          data-need={String(c.key)}
          aria-pressed={Boolean(draft[c.key])}
          onClick={() => setDraft((d) => ({ ...d, [c.key]: !d[c.key] }))}
          className="cs-row py-4"
        >
          <span className="cs-display block text-lg text-ink">{c.label}</span>
          <span className="mt-1 block text-xs text-muted">{c.gloss}</span>
        </button>
      ))}
    </div>

    <h2 className="cs-caps mt-8 text-gold">How loud is too loud?</h2>
    <p className="mt-2 text-xs text-muted">
      From what people wrote down while they were sitting in there, at this hour. Three named rooms, not a
      dial.
    </p>
    <div className="mt-3">
      {NOISE.map((n) => (
        <button
          key={n.value}
          type="button"
          data-noise={n.value}
          aria-pressed={draft.max_noise === n.value}
          onClick={() => setDraft((d) => ({ ...d, max_noise: d.max_noise === n.value ? null : n.value }))}
          className="cs-row py-4"
        >
          <span className="cs-display block text-lg text-ink">{n.label}</span>
          <span className="mt-1 block text-xs text-muted">{n.gloss}</span>
        </button>
      ))}
    </div>

    {!signedIn && (
      <>
        <h2 className="cs-caps mt-8 text-gold">Who should they see?</h2>
        <p className="mt-2 text-xs text-muted">
          A first name, and only if you want one. Leave it and you go in as “the fourth”.
        </p>
        <input
          data-display-name
          type="text"
          value={draft.name}
          maxLength={24}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          aria-label="A first name, if you want one"
          className="mt-3 w-full border-b border-rule-strong bg-transparent py-3 text-lg text-ink outline-none focus-visible:border-ember"
        />
        <p className="mt-4 text-xs text-muted">
          You are not signed in, and nothing here is going to ask you to be. What you need counts exactly as
          much as what any of them need. What you have ranked can't count, because Cosign has never met you —
          that is the only difference, and it changes nothing about the answer you will see.
        </p>
      </>
    )}

    <div className="mt-8 flex flex-wrap items-center gap-4">
      <button type="button" data-take-seat disabled={busy} onClick={onSubmit} className="cs-pill">
        {busy ? "Sending…" : editing ? "That's my answer" : "Take the seat"}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} className="cs-word text-sm text-muted underline underline-offset-4">
          never mind
        </button>
      )}
    </div>
    <p className="mt-4 text-xs text-muted">
      What you tapped goes on the page under your name, exactly the way everybody else's is on it already — a
      table where you cannot see what the others need is just a poll.
    </p>
  </section>
);

export default GroupSession;
