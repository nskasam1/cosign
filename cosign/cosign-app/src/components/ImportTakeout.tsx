import { useMemo, useRef, useState } from "react";
import { api, ApiError, type TakeoutMatch } from "@/lib/api";
import { track } from "@/lib/analytics";
import type { List } from "@/types/cosign";
import PlacePlate from "@/components/log/PlacePlate";

// "Google Maps saved-places import at signup" (brief #9), offered wherever
// this product would otherwise be asking somebody to start from nothing.
//
// Three things this screen refuses to do, all of them for the same reason —
// there is no undo further down this flow, so a wrong guess here becomes a
// place in somebody's list that they have never been to:
//   * it never matches on a coordinate alone (see server/import/takeout.ts —
//     the fixtures carry a bakery 48 m from Bramble and a bar 24 m from
//     Juniper Coffee Club, and both stay unmatched);
//   * a near-miss is OFFERED, not assumed: it arrives unpressed, with the
//     reason spelled out, and does nothing until somebody taps it;
//   * the ones we do not have are named on screen rather than quietly
//     dropped, because "we took 10 of your 15" is only honest if you can see
//     which five.
//
// And what it makes is a LIST, never a ranking. An order comes from the
// head-to-head and from nowhere else (decision 3); a saved place is a place
// somebody meant to try, which is not the same statement at all.

interface ImportTakeoutProps {
  /** The list this import creates. Named by the caller, since the sentence
   *  around it differs between onboarding and an empty ranking. */
  title: string;
  onImported?: (list: List, places: number) => void;
}

type Stage = "idle" | "reading" | "review" | "saving" | "done";

const ACCEPT = ".json,.csv,application/json,application/geo+json,text/csv";

/** "a, b and c" — the same conjunction rule the share page's cosign line uses. */
function sentenceList(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const ImportTakeout = ({ title, onImported }: ImportTakeoutProps) => {
  const [stage, setStage] = useState<Stage>("idle");
  const [matches, setMatches] = useState<TakeoutMatch[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ list: List; places: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const known = useMemo(() => matches.filter((m) => m.shop), [matches]);
  const unknown = useMemo(() => matches.filter((m) => !m.shop), [matches]);
  const certain = known.filter((m) => m.kind === "certain");
  const likely = known.filter((m) => m.kind === "likely");

  const read = async (files: FileList | null) => {
    if (!files?.length) return;
    setStage("reading");
    setError(null);
    try {
      const texts = await Promise.all([...files].map((f) => f.text()));
      const report = await api.importTakeout(texts);
      setMatches(report.matches);
      // Only the certain ones arrive already chosen. Everything else is an
      // offer, and an offer that starts accepted is not an offer.
      setChosen(new Set(report.matches.filter((m) => m.kind === "certain" && m.shop).map((m) => m.shop!.id)));
      setStage("review");
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "That file couldn't be read here. Nothing was saved.",
      );
      setStage("idle");
    } finally {
      // Picking the same file twice in a row fires no change event unless the
      // input is cleared — which looks exactly like the app ignoring you.
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const toggle = (shopId: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(shopId)) next.delete(shopId);
      else next.add(shopId);
      return next;
    });

  const save = async () => {
    setStage("saving");
    setError(null);
    try {
      const items = known
        .filter((m) => chosen.has(m.shop!.id))
        .map((m) => ({ shop_id: m.shop!.id, note: m.note }));
      // One request. Eleven would mean a dropped connection could leave a
      // list holding some of what was asked for, with nothing to say which.
      const { list } = await api.createList({ title, items });
      track("import_committed", { places: items.length });
      setMade({ list, places: items.length });
      setStage("done");
      onImported?.(list, items.length);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't save. Nothing was written.");
      setStage("review");
    }
  };

  if (stage === "done" && made) {
    return (
      <div data-import data-stage="done" className="border-t border-rule-strong pt-5">
        <p className="cs-caps text-gold">That's in</p>
        <p className="cs-display mt-3 text-balance text-xl text-ink">
          {made.places} {made.places === 1 ? "place" : "places"} you'd already saved, now somewhere you can
          use them.
        </p>
        <p className="mt-2 text-sm text-line">
          They're a list, not an order. Log a visit to one and the head-to-head starts putting them in
          order — which is the only thing on Cosign that ever does.
        </p>
      </div>
    );
  }

  return (
    <div data-import data-stage={stage} className="border-t border-rule-strong pt-5">
      <p className="cs-caps text-gold">From Google Maps</p>

      {stage === "idle" || stage === "reading" ? (
        <>
          <p className="cs-display mt-3 text-balance text-xl text-ink">
            You've already saved places. Bring them.
          </p>
          <p className="mt-2 max-w-[34rem] text-sm text-line">
            Google Takeout gives you your saved places as a file. Hand it over and we'll say which ones
            we know. It's read here, on this machine, and thrown away — the file never leaves, and
            nothing about where you've been is written down.
          </p>
          <input
            ref={fileRef}
            id="takeout-files"
            data-import-input
            type="file"
            multiple
            accept={ACCEPT}
            onChange={(e) => read(e.target.files)}
            className="peer sr-only"
          />
          <label
            htmlFor="takeout-files"
            className="cs-pill-ghost mt-5 cursor-pointer peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[3px] peer-focus-visible:outline-[hsl(var(--ember))]"
          >
            {stage === "reading" ? "Reading…" : "Choose the file"}
          </label>
          <p className="cs-caps mt-4 text-muted">
            Saved Places.json, or a saved-list CSV. Both together is best — one has the map pins, the
            other has your notes.
          </p>
          {error && (
            <p role="alert" className="mt-4 text-sm text-line">
              {error}
            </p>
          )}
        </>
      ) : (
        <>
          {/* An export can parse perfectly and still contain no places — an
              empty FeatureCollection, or a CSV with only a header. That read
              "We know 0 of the 0 places you saved." above nothing at all,
              which blames the reader for a file that was simply empty. Brief
              #9 asks for every empty state to be designed as carefully as
              home; this is one of them. */}
          {matches.length === 0 ? (
            <p data-import-empty className="cs-display mt-3 text-balance text-xl text-ink">
              That file parsed, but there were no places in it. Google splits its export by product — the one
              you want is Saved Places, and it comes out of the Maps folder.
            </p>
          ) : (
            <p className="cs-display mt-3 text-balance text-xl text-ink">
              We know {known.length} of the {matches.length} places you saved.
            </p>
          )}

          {certain.length > 0 && (
            <ul data-import-group="certain" className="mt-5">
              {certain.map((m) => (
                <li key={m.shop!.id}>
                  <button
                    type="button"
                    data-import-row
                    data-shop-id={m.shop!.id}
                    onClick={() => toggle(m.shop!.id)}
                    aria-pressed={chosen.has(m.shop!.id)}
                    className="cs-row grid grid-cols-[3rem_1fr] items-center gap-x-4 py-4"
                  >
                    <PlacePlate name={m.shop!.name} photo={m.shop!.photo} palette={m.shop!.palette} size={48} />
                    <span className="min-w-0">
                      <span className="cs-display block truncate text-lg text-ink">{m.shop!.name}</span>
                      <span className="mt-1 block truncate text-xs text-muted">
                        {m.note ? `“${m.note}”` : m.because}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {likely.length > 0 && (
            <div data-import-group="likely" className="mt-7">
              <p className="cs-caps text-gold">
                {likely.length === 1 ? "One we'd rather ask about" : "A few we'd rather ask about"}
              </p>
              <ul className="mt-2">
                {likely.map((m) => (
                  <li key={m.shop!.id}>
                    <button
                      type="button"
                      data-import-row
                      data-import-likely
                      data-shop-id={m.shop!.id}
                      onClick={() => toggle(m.shop!.id)}
                      aria-pressed={chosen.has(m.shop!.id)}
                      className="cs-row grid grid-cols-[3rem_1fr] items-center gap-x-4 py-4"
                    >
                      <PlacePlate
                        name={m.shop!.name}
                        photo={m.shop!.photo}
                        palette={m.shop!.palette}
                        size={48}
                      />
                      <span className="min-w-0">
                        <span className="cs-display block truncate text-lg text-line">{m.shop!.name}?</span>
                        <span className="mt-1 block text-xs text-muted">{m.because}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {unknown.length > 0 && (
            <p data-import-unknown className="mt-7 border-t border-rule pt-4 text-sm text-muted">
              Not these: <span className="text-line">{sentenceList(unknown.map((m) => m.saved))}</span>.
              Cosign only knows places somebody has actually been to and written down, and only near
              campus — so far.
            </p>
          )}

          {error && (
            <p role="alert" className="mt-5 text-sm text-line">
              {error}
            </p>
          )}

          <div className="mt-8 border-t border-rule-strong pt-6">
            <button
              type="button"
              data-import-save
              onClick={save}
              disabled={stage === "saving" || chosen.size === 0}
              className="cs-pill"
            >
              {stage === "saving"
                ? "Saving…"
                : chosen.size === 0
                  ? "Nothing chosen"
                  : `Start a list with ${chosen.size}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default ImportTakeout;
