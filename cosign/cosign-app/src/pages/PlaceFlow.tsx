import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ShopSummary } from "@/lib/api";
import {
  applyComparison,
  finalIndex,
  isDone,
  nextOpponent,
  startInsertion,
  type InsertionState,
} from "@/lib/insertion";
import { comparisonBound } from "@/lib/logFlow";
import { paletteOf, paletteStyle } from "@/lib/palette";
import { useTitle } from "@/lib/title";
import { CROWD_LABELS, INTENT_TAG_LABELS_SHORT, NOISE_LABELS, type Log, type Shop } from "@/types/cosign";
import PlacePlate from "@/components/log/PlacePlate";

// Where the log becomes a cosign. Ranking a place into your list *is* the
// endorsement (decision 13), so this screen is the only place a cosign can
// happen — and it runs entirely after POST /api/logs has returned, outside
// the ten-second budget. Nothing here can lose the log: the row is already
// on disk, and a partial binary search is not a partial ranking, so leaving
// discards the taps and never the visit.

type Phase = "compare" | "done";
type DoneKind = "placed" | "first" | "already" | "unranked" | "error";

interface Side {
  id: string;
  name: string;
  photo: string | null;
  palette: string | null;
  line: string | null;
}

const BUCKET_WORDS: Record<string, string> = {
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
  late_night: "late night",
};

const PlaceFlow = () => {
  useTitle("Putting it in order");
  const { shopId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const savedLog = (location.state as { log?: Log } | null)?.log ?? null;

  const shopsQuery = useQuery({ queryKey: ["shops"], queryFn: api.shops, staleTime: 5 * 60_000 });
  const rankingQuery = useQuery({ queryKey: ["ranking", "me"], queryFn: api.myRanking, staleTime: 5 * 60_000 });

  const shops = useMemo(() => shopsQuery.data?.shops ?? [], [shopsQuery.data]);
  const entries = useMemo(() => rankingQuery.data?.entries ?? [], [rankingQuery.data]);
  // Gate on data, never on isLoading: a failed or offline-paused ranking
  // query is not loading either, and an unread list is indistinguishable
  // from an empty one — which would auto-commit this place at #1 with no
  // comparisons behind it. The one thing this screen must never do is
  // invent a rank.
  const ready = shopsQuery.isSuccess && rankingQuery.isSuccess;
  const unreachable = shopsQuery.isError || rankingQuery.isError;

  const candidate: ShopSummary | null = shops.find((s) => s.id === shopId) ?? null;
  const order = useMemo(() => entries.map((e) => e.shop_id), [entries]);
  const sideOf = useMemo(() => {
    const fromRanking = new Map<string, Side>();
    for (const e of entries) {
      const s = e.shop as Shop & { photo?: string | null };
      fromRanking.set(e.shop_id, {
        id: e.shop_id,
        name: s?.name ?? e.shop_id,
        photo: s?.photo ?? null,
        palette: s?.palette ?? null,
        line: s?.one_liner ?? null,
      });
    }
    return (id: string): Side | null => {
      const known = fromRanking.get(id);
      if (known) return known;
      const s = shops.find((x) => x.id === id);
      return s ? { id, name: s.name, photo: s.photo, palette: s.palette, line: s.one_liner } : null;
    };
  }, [entries, shops]);

  const [phase, setPhase] = useState<Phase>("compare");
  const [done, setDone] = useState<DoneKind | null>(null);
  const [state, setState] = useState<InsertionState | null>(null);
  const [history, setHistory] = useState<InsertionState[]>([]);
  const [comparisons, setComparisons] = useState<Array<{ winner_shop_id: string; loser_shop_id: string }>>([]);
  const [placedAt, setPlacedAt] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const alreadyRanked = order.includes(shopId ?? "");
  const existingPosition = alreadyRanked ? order.indexOf(shopId!) + 1 : null;

  const commit = useCallback(
    async (position: number, taps: Array<{ winner_shop_id: string; loser_shop_id: string }>) => {
      if (!shopId) return;
      setBusy(true);
      setPlacedAt(position);
      try {
        await api.insertRanking({ shop_id: shopId, position, comparisons: taps });
        await qc.invalidateQueries({ queryKey: ["ranking", "me"] });
        setDone(order.length === 0 ? "first" : "placed");
        setPhase("done");
      } catch (e) {
        // The list moved in another tab: re-read it and ask again rather than
        // writing a position that no longer means anything.
        if (e instanceof Error && /bad position/i.test(e.message)) {
          const fresh = await api.myRanking();
          qc.setQueryData(["ranking", "me"], fresh);
          const freshOrder = fresh.entries.map((x) => x.shop_id);
          setComparisons([]);
          setHistory([]);
          setPlacedAt(null);
          if (freshOrder.includes(shopId)) {
            // Someone (another tab) already placed it. Nothing left to ask.
            setDone("already");
            setPhase("done");
          } else {
            setState(startInsertion(shopId, freshOrder));
            setPhase("compare");
            setNote("Your list moved — a couple more taps.");
          }
        } else {
          setDone("error");
          setPhase("done");
        }
      } finally {
        setBusy(false);
      }
    },
    [shopId, order, qc],
  );

  // Branch before startInsertion is ever called: it throws when the candidate
  // is already in the list, and that throw would land after the log row is
  // already on disk.
  useEffect(() => {
    if (!ready || !shopId || state || done || started.current) return;
    started.current = true;
    if (alreadyRanked) {
      setDone("already");
      setPhase("done");
      return;
    }
    if (order.length === 0) {
      void commit(1, []);
      return;
    }
    setState(startInsertion(shopId, order));
  }, [ready, shopId, order, alreadyRanked, state, done, commit]);

  const answer = (candidateWon: boolean) => {
    if (!state || busy) return;
    const opponent = nextOpponent(state)!;
    const next = applyComparison(state, candidateWon);
    const taps = [
      ...comparisons,
      candidateWon
        ? { winner_shop_id: shopId!, loser_shop_id: opponent }
        : { winner_shop_id: opponent, loser_shop_id: shopId! },
    ];
    setHistory((h) => [...h, state]);
    setComparisons(taps);
    setState(next);
    if (isDone(next)) void commit(finalIndex(next) + 1, taps);
  };

  const unTap = () => {
    const prev = history.at(-1);
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setComparisons((c) => c.slice(0, -1));
    setState(prev);
  };

  const moveIt = () => {
    if (!shopId) return;
    const without = order.filter((id) => id !== shopId);
    setDone(null);
    setPlacedAt(null);
    setComparisons([]);
    setHistory([]);
    if (without.length === 0) void commit(1, []);
    else {
      setState(startInsertion(shopId, without));
      setPhase("compare");
    }
  };

  if (!ready || !candidate) {
    // The log is already on disk in every one of these branches, so the copy
    // says so: what failed is the ranking, which costs two taps to redo.
    const message = unreachable
      ? "Your list didn't load, so there's nothing to hold this against yet. The visit is logged either way."
      : ready
        ? "That place isn't here."
        : null;
    return (
      <main data-placeflow data-phase="waiting" className="cs-wrap flex min-h-dvh flex-col justify-center pb-10">
        <p className="cs-caps text-gold">Cosign · logged</p>
        {message ? (
          <>
            <h1 className="cs-display mt-4 text-balance text-3xl text-ink">{message}</h1>
            <div className="mt-8">
              {unreachable && (
                <button
                  type="button"
                  data-retry
                  onClick={() => {
                    void shopsQuery.refetch();
                    void rankingQuery.refetch();
                  }}
                  className="cs-pill-ghost mr-4"
                >
                  Try again
                </button>
              )}
              <Link to="/" className="cs-word text-xs text-muted underline underline-offset-4">
                back home
              </Link>
            </div>
          </>
        ) : (
          <p className="cs-caps mt-4 text-muted">Loading…</p>
        )}
      </main>
    );
  }

  const opponentId = state && !isDone(state) ? nextOpponent(state) : null;
  const opponent = opponentId ? sideOf(opponentId) : null;
  // Everything about the search reads the insertion's OWN list, not the live
  // ranking: re-ranking a place already in the list searches the list minus
  // that place, so `order`'s indices are off by one past its old slot.
  const searchList = state?.list ?? order;
  const opponentPosition = opponentId ? searchList.indexOf(opponentId) + 1 : null;
  const bound = comparisonBound(searchList.length);
  const slotWindow = state ? state.list.slice(state.lo, state.hi) : [];
  const slotOffset = state ? state.lo : 0;

  const receiptLine = savedLog
    ? [
        INTENT_TAG_LABELS_SHORT[savedLog.intent_tag],
        savedLog.noise ? NOISE_LABELS[savedLog.noise] : null,
        savedLog.crowd ? CROWD_LABELS[savedLog.crowd] : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <main
      data-placeflow
      data-phase={phase}
      className="cs-wrap flex min-h-dvh flex-col pb-10 pt-[max(var(--space-6),env(safe-area-inset-top))]"
    >
      <div className="flex items-center justify-between gap-4 pb-4">
        {phase === "compare" ? (
          <button
            type="button"
            data-later
            onClick={() => {
              setDone("unranked");
              setPhase("done");
            }}
            aria-label="Stop ranking — your log is already saved"
            className="cs-word cs-caps text-muted"
          >
            Later
          </button>
        ) : (
          <Link to="/" className="cs-word cs-caps text-muted">
            Home
          </Link>
        )}
        <p className="cs-caps truncate text-right text-gold">
          Cosign · {done === "placed" || done === "first" ? "cosigned" : "logged"} · {candidate.name}
        </p>
      </div>

      {/* The save stamp: it draws once and then stays, above every question,
          as wordless proof that the visit is already written down. */}
      <div data-stamp className="cs-stamp" />

      <p
        data-receipt
        data-time-bucket={savedLog?.time_bucket}
        data-semester={savedLog?.semester}
        className="cs-caps mt-4 text-muted"
      >
        {savedLog
          ? `Logged · ${BUCKET_WORDS[savedLog.time_bucket] ?? savedLog.time_bucket}${receiptLine ? ` · ${receiptLine}` : ""}`
          : "Logged"}
      </p>

      {phase === "compare" && state && opponent && (
        <div className="cs-step flex flex-1 flex-col">
          <p role="status" aria-live="polite" className="cs-caps mt-5 text-muted">
            Tap {comparisons.length + 1} of at most {bound}
            {note ? ` · ${note}` : ""}
          </p>

          {searchList.length >= 3 && (
            <div aria-hidden="true" className="mt-3">
              <p className="cs-caps text-muted">Still in question</p>
              <div className="mt-1">
                {slotWindow.slice(0, 6).map((id, i) => {
                  const s = sideOf(id);
                  const pos = slotOffset + i + 1;
                  return (
                    <div
                      key={id}
                      data-slot-row
                      style={paletteStyle(paletteOf(s?.palette))}
                      className="cs-fade grid grid-cols-[1.75rem_1fr] items-baseline gap-x-3 py-0.5"
                    >
                      <span className="cs-display cs-figures text-right text-xs text-[hsl(var(--pal))]">{pos}</span>
                      <span className="truncate text-xs text-line">{s?.name}</span>
                    </div>
                  );
                })}
                {slotWindow.length > 6 && (
                  <p className="mt-1 text-xs text-muted">+ {slotWindow.length - 6} more</p>
                )}
              </div>
            </div>
          )}

          <h1 className="cs-display mt-6 text-balance text-3xl text-ink sm:text-4xl">
            {comparisons.length === 0 ? "Which would you send a friend to?" : `Better than ${opponent.name}?`}
          </h1>
          <p className="mt-2 text-xs text-muted">Tap the one you'd send them to.</p>

          <div className="mt-5">
            <ComparisonSide
              side={opponent}
              position={opponentPosition}
              onSelect={() => answer(false)}
              testid="opponent"
            />
            <ComparisonSide
              side={{
                id: candidate.id,
                name: candidate.name,
                photo: candidate.photo,
                palette: candidate.palette,
                line: candidate.one_liner,
              }}
              eyebrow="The one you just logged"
              onSelect={() => answer(true)}
              testid="candidate"
            />
          </div>

          {history.length > 0 && (
            <button
              type="button"
              data-untap
              onClick={unTap}
              className="cs-word mt-auto pt-8 text-xs text-muted underline underline-offset-4"
            >
              Undo that tap
            </button>
          )}
        </div>
      )}

      {phase === "done" && (
        <Done
          kind={done ?? "placed"}
          candidate={candidate}
          position={placedAt ?? existingPosition}
          order={order}
          sideOf={sideOf}
          onMove={moveIt}
          // Retry the position the taps actually produced — never a
          // fallback, which would be the app choosing a rank for you.
          onRetry={placedAt ? () => void commit(placedAt, comparisons) : undefined}
          busy={busy}
          navigate={navigate}
        />
      )}
    </main>
  );
};

const ComparisonSide = ({
  side,
  position,
  eyebrow,
  onSelect,
  testid,
}: {
  side: Side;
  position?: number | null;
  eyebrow?: string;
  onSelect: () => void;
  testid: string;
}) => (
  <button
    type="button"
    data-side={testid}
    data-shop-id={side.id}
    onClick={onSelect}
    style={paletteStyle(paletteOf(side.palette))}
    className="cs-row grid grid-cols-[5.25rem_1fr] gap-x-4 py-5"
  >
    <span className="grid justify-items-center gap-2">
      <PlacePlate name={side.name} photo={side.photo} palette={side.palette} size={84} />
      {position ? (
        <span className="cs-display cs-figures text-2xl text-[hsl(var(--pal))]">{position}</span>
      ) : null}
    </span>
    <span className="min-w-0">
      {eyebrow && <span className="cs-caps block text-gold">{eyebrow}</span>}
      <span className="cs-display mt-1 block text-lg text-line">{side.name}</span>
      {side.line && <span className="mt-1 block text-xs text-muted">{side.line}</span>}
    </span>
  </button>
);

const Done = ({
  kind,
  candidate,
  position,
  order,
  sideOf,
  onMove,
  onRetry,
  busy,
  navigate,
}: {
  kind: DoneKind;
  candidate: ShopSummary;
  position: number | null;
  order: string[];
  sideOf: (id: string) => Side | null;
  onMove: () => void;
  onRetry?: () => void;
  busy: boolean;
  navigate: ReturnType<typeof useNavigate>;
}) => {
  const headline =
    kind === "placed"
      ? `${candidate.name} lands at ${position}.`
      : kind === "first"
        ? `${candidate.name} starts your list.`
        : kind === "already"
          ? `${candidate.name} is already your #${position}.`
          : kind === "unranked"
            ? "Saved, not ranked."
            : "The log is fine. The order isn't.";

  const body =
    kind === "placed"
      ? "Nobody scored anything. You just said which one you'd send someone to."
      : kind === "first"
        ? "Everything you log next gets held up against it, one question at a time."
        : kind === "already"
          ? "The visit is logged either way. Move it only if it actually moved."
          : kind === "unranked"
            ? "Your visit is written down. You can put it in order whenever — it's two or three taps."
            : "Couldn't save the order just now. Nothing about the visit was lost.";

  // The list as it now stands. The ranking query is refetching in the
  // background, so the placement is folded in locally rather than waiting
  // for a round trip to tell us what we just decided.
  const finalOrder =
    !position || order.includes(candidate.id)
      ? order
      : [...order.slice(0, position - 1), candidate.id, ...order.slice(position - 1)];

  // The last thing you see is the artifact you'd send: the new entry in its
  // own neighbourhood, set exactly as the share page sets it.
  const around =
    kind === "placed" && position
      ? finalOrder.slice(Math.max(0, position - 2), position + 1)
      : [];

  return (
    <div data-done={kind} className="cs-step flex flex-1 flex-col">
      <h1 className="cs-display mt-5 text-balance text-3xl text-ink sm:text-4xl">
        {kind === "placed" && position ? (
          <>
            {candidate.name} lands at{" "}
            <span
              data-final-position
              className="cs-figures text-[hsl(var(--pal))]"
              style={paletteStyle(paletteOf(candidate.palette))}
            >
              {position}
            </span>
            .
          </>
        ) : (
          headline
        )}
      </h1>

      {around.length > 0 && (
        <div className="mt-6">
          {around.map((id) => {
            const s = sideOf(id);
            const pos = finalOrder.indexOf(id) + 1;
            const isNew = id === candidate.id;
            return (
              <div
                key={id}
                data-neighbour={isNew ? "new" : ""}
                style={paletteStyle(paletteOf(s?.palette))}
                className={`cs-row grid grid-cols-[2.1rem_1fr] gap-x-3 py-4 ${isNew ? "bg-surface" : ""}`}
              >
                {isNew && <span aria-hidden="true" className="absolute bottom-0 left-0 top-0 w-[2px] bg-ember" />}
                <span className="cs-display cs-figures text-right text-2xl text-[hsl(var(--pal))]">{pos}</span>
                <span className="min-w-0">
                  <span className="cs-display block truncate text-lg text-line">{s?.name}</span>
                  {s?.line && <span className="mt-1 block truncate text-xs text-muted">{s.line}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-sm text-line">{body}</p>

      <div className="mt-auto border-t border-rule-strong pt-6">
        {kind === "already" && (
          <button type="button" data-move onClick={onMove} className="cs-pill-ghost mr-4">
            Move it
          </button>
        )}
        {kind === "error" && onRetry && (
          <button type="button" data-retry disabled={busy} onClick={onRetry} className="cs-pill-ghost mr-4">
            {busy ? "Trying…" : "Try again"}
          </button>
        )}
        <Link to="/rank" data-see-list className="cs-pill-ghost">
          See your list
        </Link>
        <button
          type="button"
          data-log-another
          onClick={() => navigate("/log")}
          className="cs-word ml-4 text-xs text-muted underline underline-offset-4"
        >
          log another
        </button>
      </div>
    </div>
  );
};

export default PlaceFlow;
