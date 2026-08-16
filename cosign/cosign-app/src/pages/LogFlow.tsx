import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type ShopSummary } from "@/lib/api";
import { currentTimeBucket } from "@/lib/timeBucket";
import {
  confirmationsFor,
  emptyDraft,
  firstIncompleteStep,
  stepAllowed,
  type LogDraft,
  type LogStep,
} from "@/lib/logFlow";
import {
  CROWD_LABELS,
  INTENT_TAGS,
  INTENT_TAG_LABELS,
  INTENT_TAG_LABELS_SHORT,
  NOISE_LABELS,
  type CrowdLevel,
  type LogTapKey,
  type NoiseLevel,
  type Shop,
} from "@/types/cosign";
import PlacePlate from "@/components/log/PlacePlate";
import Receipt, { type ReceiptItem } from "@/components/log/Receipt";
import StatementRow from "@/components/log/StatementRow";

// The log: six taps from cold, no keyboard, one decision per screen, and the
// ranking insertion deliberately on the far side of the save (brief decision
// 4). Steps 1-4 auto-advance on the answer, so no tap in the flow is ever
// spent on navigation — that is what buys room for the two optional
// confirmations inside the eight-tap cap.
//
// Ember appears nowhere until the commit screen. Nothing before it writes.

const BUCKET_LABELS: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  late_night: "Late night",
};

const NOISE_STATEMENTS: Array<{ value: NoiseLevel; label: string; gloss: string }> = [
  { value: "quiet", label: "Dead quiet", gloss: "You could hear people typing" },
  { value: "conversational", label: "Normal café hum", gloss: "Talking, music, fine with one earbud" },
  { value: "loud", label: "Properly loud", gloss: "You'd have had to raise your voice" },
];

const CROWD_STATEMENTS: Array<{ value: CrowdLevel; label: string; gloss: string }> = [
  { value: "empty", label: "Nearly empty", gloss: "You had your pick of seats" },
  { value: "comfortable", label: "Busy, but fine", gloss: "Full-ish, seats still going" },
  { value: "packed", label: "Packed", gloss: "People were circling for a table" },
];

const CONFIRMATION_LABELS: Record<LogTapKey, string> = {
  found_outlet: "There was an outlet",
  wifi_held_up: "The wifi actually held up",
  got_a_table: "Got a table, no fight",
  would_camp: "I'd camp here four hours",
};

/** '2026-autumn' -> 'Autumn 2026'; 'break' -> 'Between terms'. */
function semesterLabel(semester: string | undefined): string | null {
  if (!semester) return null;
  if (semester === "break") return "Between terms";
  const [year, term] = semester.split("-");
  return term ? `${term[0].toUpperCase()}${term.slice(1)} ${year}` : semester;
}

const LogFlow = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const step = (params.get("step") ?? "where") as LogStep;
  const shopParam = params.get("shop");

  const shopsQuery = useQuery({ queryKey: ["shops"], queryFn: api.shops, staleTime: 5 * 60_000 });
  const metaQuery = useQuery({ queryKey: ["meta"], queryFn: api.meta, staleTime: 5 * 60_000 });
  const rankingQuery = useQuery({ queryKey: ["ranking", "me"], queryFn: api.myRanking, staleTime: 5 * 60_000 });

  const shops = useMemo(() => shopsQuery.data?.shops ?? [], [shopsQuery.data]);
  const [draft, setDraft] = useState<LogDraft>(() => emptyDraft());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Shop[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const savedRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const shop = useMemo(
    () => shops.find((s) => s.id === draft.shopId) ?? null,
    [shops, draft.shopId],
  );

  const rankedPosition = useMemo(() => {
    const entries = rankingQuery.data?.entries ?? [];
    const byShop = new Map(entries.map((e) => [e.shop_id, e.position]));
    return (id: string) => byShop.get(id) ?? null;
  }, [rankingQuery.data]);

  // A /log?shop=<slug> entry pre-picks the place and opens at the next
  // question; an unknown slug is not the user's problem, so it just falls
  // through to the picker.
  useEffect(() => {
    if (!shopParam || draft.shopId || shops.length === 0) return;
    const match = shops.find((s) => s.slug === shopParam || s.id === shopParam);
    if (!match) return;
    setDraft((d) => ({ ...d, shopId: match.id }));
    if (!params.get("step")) setParams({ shop: shopParam, step: "why" }, { replace: true });
  }, [shopParam, shops, draft.shopId, params, setParams]);

  // A deep link (or a refresh) to a step whose answers do not exist yet is
  // never a broken screen — it lands on the first question still unanswered.
  //
  // It has to wait for the effect above, though: both run in the same commit
  // with the same `draft`, so on a cold load of /log?shop=x&step=why this
  // would see a null shopId and bounce a perfectly good deep link back to
  // the picker one render before the shop lands.
  const resolvingShop =
    Boolean(shopParam) && !draft.shopId && shops.some((s) => s.slug === shopParam || s.id === shopParam);

  useEffect(() => {
    if (shopsQuery.isLoading || resolvingShop) return;
    if (!stepAllowed(step, draft)) {
      setParams(
        shopParam ? { shop: shopParam, step: firstIncompleteStep(draft) } : { step: firstIncompleteStep(draft) },
        { replace: true },
      );
    }
  }, [step, draft, shopsQuery.isLoading, resolvingShop, shopParam, setParams]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setMatches([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      api
        .searchPlaces(query.trim())
        .then(({ results }) => live && setMatches(results))
        .catch(() => live && setMatches([]));
    }, 180);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  const go = (next: LogStep) => {
    const qs: Record<string, string> = { step: next };
    if (shopParam) qs.shop = shopParam;
    setParams(qs);
  };

  const pickShop = (id: string) => {
    setDraft((d) => ({ ...d, shopId: id }));
    go("why");
  };

  const confirmations = confirmationsFor(draft.intent, draft.crowd, shop?.amenities ?? null);

  const receipt: ReceiptItem[] = [];
  const bucket = currentTimeBucket();
  receipt.push({ kind: "known", text: BUCKET_LABELS[bucket] });
  const term = semesterLabel(metaQuery.data?.semester);
  if (term) receipt.push({ kind: "known", text: term });
  if (shop) receipt.push({ kind: "known", text: `${shop.walk_min} min walk` });
  if (shop) receipt.push({ kind: "said", text: shop.name });
  if (draft.intent) receipt.push({ kind: "said", text: INTENT_TAG_LABELS_SHORT[draft.intent] });
  if (draft.noiseAnswered && draft.noise) receipt.push({ kind: "said", text: NOISE_LABELS[draft.noise] });
  if (draft.crowdAnswered && draft.crowd) receipt.push({ kind: "said", text: CROWD_LABELS[draft.crowd] });

  const save = async () => {
    if (savedRef.current || !draft.shopId || !draft.intent) return;
    savedRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      // Only the confirmations this screen is currently offering: going back
      // and changing the crowd answer can retire a row that was already
      // tapped, and a log should never carry a claim the user can no longer
      // see.
      const offered = new Set(confirmations);
      const taps = Object.fromEntries(
        (Object.keys(draft.taps) as LogTapKey[])
          .filter((k) => draft.taps[k] && offered.has(k))
          .map((k) => [k, true]),
      );
      const { log } = await api.createLog({
        shop_id: draft.shopId,
        intent_tag: draft.intent,
        noise: draft.noise,
        crowd: draft.crowd,
        taps,
        line: draft.line.trim() || null,
        photo: draft.photo,
      });
      navigate(`/log/rank/${draft.shopId}`, { replace: true, state: { log } });
    } catch {
      savedRef.current = false;
      setSaveError("Couldn't save that just now. Nothing's lost — try again.");
    } finally {
      setSaving(false);
    }
  };

  // The optional photo is a real one: read locally, downscaled in a canvas,
  // and posted to the local upload route. No pixel leaves this machine.
  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const dataUrl = await downscale(file);
      const { path } = await api.uploadPhoto(dataUrl);
      setDraft((d) => ({ ...d, photo: path }));
    } catch {
      setPhotoError("That picture wouldn't load. The log is fine without it.");
    } finally {
      setPhotoBusy(false);
    }
  };

  if (shopsQuery.isLoading) {
    return (
      <main className="cs-wrap flex min-h-dvh items-center justify-center">
        <p className="cs-caps text-muted">Loading…</p>
      </main>
    );
  }

  const kicker = shop ? `Cosign · logging · ${shop.name}` : "Cosign · logging";

  return (
    <main
      data-logflow
      data-step={step}
      className="cs-wrap flex min-h-dvh flex-col pb-10 pt-[max(var(--space-6),env(safe-area-inset-top))]"
    >
      <div className="flex items-center justify-between gap-4 border-b border-rule pb-4">
        {step === "where" ? (
          <button type="button" data-cancel onClick={() => navigate("/")} className="cs-word cs-caps text-muted">
            Cancel
          </button>
        ) : (
          <button type="button" data-back onClick={() => navigate(-1)} className="cs-word cs-caps text-muted">
            Back
          </button>
        )}
        <p className="cs-caps truncate text-right text-gold">{kicker}</p>
      </div>

      <Receipt items={receipt} />

      <div key={step} className="cs-step flex flex-1 flex-col">
        {step === "where" && (
          <>
            <StepTitle>Where'd you end up?</StepTitle>
            <p className="mt-1 text-xs text-muted">Closest first.</p>
            <div className="mt-5">
              {shops
                .slice()
                .sort((a, b) => a.distance_m - b.distance_m)
                .map((s) => (
                  <PlaceRow key={s.id} shop={s} position={rankedPosition(s.id)} onSelect={() => pickShop(s.id)} />
                ))}
            </div>

            <div className="mt-6 border-t border-rule-strong pt-4">
              {searchOpen ? (
                <>
                  <label htmlFor="place-search" className="cs-caps block text-gold">
                    Somewhere else
                  </label>
                  <input
                    id="place-search"
                    data-search-input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Start typing a name"
                    className="mt-2 w-full rounded-[var(--radius-md)] border border-rule-strong bg-surface p-3 text-base text-ink placeholder:text-muted"
                  />
                  <div className="mt-2">
                    {matches.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        data-place-row
                        data-shop-id={m.id}
                        data-shop-slug={m.slug}
                        onClick={() => pickShop(m.id)}
                        className="cs-row py-3"
                      >
                        <span className="cs-display block text-lg text-line">{m.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  data-search-open
                  onClick={() => setSearchOpen(true)}
                  className="cs-word text-xs text-muted underline underline-offset-4"
                >
                  Type a name instead
                </button>
              )}
            </div>
          </>
        )}

        {step === "why" && (
          <>
            <StepTitle>Why'd you go?</StepTitle>
            <div className="mt-5">
              {INTENT_TAGS.map((tag) => (
                <StatementRow
                  key={tag}
                  data-option=""
                  data-value={tag}
                  label={INTENT_TAG_LABELS[tag]}
                  onSelect={() => {
                    setDraft((d) => ({ ...d, intent: tag }));
                    go("noise");
                  }}
                />
              ))}
            </div>
          </>
        )}

        {step === "noise" && (
          <>
            <StepTitle>How loud was it?</StepTitle>
            <div className="mt-5">
              {NOISE_STATEMENTS.map((s) => (
                <StatementRow
                  key={s.value}
                  data-option=""
                  data-value={s.value}
                  label={s.label}
                  gloss={s.gloss}
                  onSelect={() => {
                    setDraft((d) => ({ ...d, noise: s.value, noiseAnswered: true }));
                    go("crowd");
                  }}
                />
              ))}
            </div>
            <button
              type="button"
              data-skip
              data-value="none"
              onClick={() => {
                setDraft((d) => ({ ...d, noise: null, noiseAnswered: true }));
                go("crowd");
              }}
              className="cs-word mt-auto pt-8 text-xs text-muted underline underline-offset-4"
            >
              Didn't notice
            </button>
          </>
        )}

        {step === "crowd" && (
          <>
            <StepTitle>How full was it?</StepTitle>
            <div className="mt-5">
              {CROWD_STATEMENTS.map((s) => (
                <StatementRow
                  key={s.value}
                  data-option=""
                  data-value={s.value}
                  label={s.label}
                  gloss={s.gloss}
                  onSelect={() => {
                    setDraft((d) => ({ ...d, crowd: s.value, crowdAnswered: true }));
                    go("review");
                  }}
                />
              ))}
            </div>
            <button
              type="button"
              data-skip
              data-value="none"
              onClick={() => {
                setDraft((d) => ({ ...d, crowd: null, crowdAnswered: true }));
                go("review");
              }}
              className="cs-word mt-auto pt-8 text-xs text-muted underline underline-offset-4"
            >
              Didn't notice
            </button>
          </>
        )}

        {step === "review" && (
          <>
            <StepTitle>That's the visit.</StepTitle>
            {confirmations.length > 0 && (
              <>
                <p className="cs-caps mt-6 text-gold">Tap any that applied</p>
                <div className="mt-2">
                  {confirmations.map((key) => (
                    <StatementRow
                      key={key}
                      data-confirm=""
                      data-tap-key={key}
                      label={CONFIRMATION_LABELS[key]}
                      pressed={Boolean(draft.taps[key])}
                      onSelect={() =>
                        setDraft((d) => ({ ...d, taps: { ...d.taps, [key]: !d.taps[key] } }))
                      }
                    />
                  ))}
                </div>
              </>
            )}
            <CommitBlock
              saving={saving}
              photoBusy={photoBusy}
              error={saveError}
              onSave={save}
              onExtras={() => go("extras")}
              draft={draft}
            />
          </>
        )}

        {step === "extras" && (
          <>
            <StepTitle>Want to say something?</StepTitle>

            <label htmlFor="log-line" className="cs-caps mt-6 block text-gold">
              One line, if you want
            </label>
            <textarea
              id="log-line"
              data-line-input
              rows={3}
              maxLength={140}
              value={draft.line}
              onChange={(e) => setDraft((d) => ({ ...d, line: e.target.value }))}
              className="mt-2 w-full rounded-[var(--radius-md)] border border-rule-strong bg-surface p-3 text-base text-ink placeholder:text-muted"
              placeholder="The window seat is the whole point."
            />
            <p className="mt-1 text-xs text-muted">
              Friends only, like everything else. <span data-line-count className="cs-figures">{140 - draft.line.length}</span> left.
            </p>

            <p className="cs-caps mt-6 text-gold">A picture from the visit</p>
            <div className="mt-2 flex items-center gap-4">
              {draft.photo ? (
                <img src={draft.photo} alt="" width={84} height={84} className="cs-shot h-[84px] w-[84px]" />
              ) : (
                <span className="grid h-[84px] w-[84px] place-items-center rounded-[var(--radius-sm)] border border-rule-strong bg-raise text-center text-2xs uppercase tracking-caps text-muted">
                  No photo
                </span>
              )}
              <div>
                <label className="cs-pill-ghost cursor-pointer">
                  {photoBusy ? "Reading…" : draft.photo ? "Different one" : "Take one"}
                  <input
                    ref={fileRef}
                    data-photo-input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    className="sr-only"
                    onChange={(e) => {
                      void pickPhoto(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                {draft.photo && (
                  <button
                    type="button"
                    data-photo-clear
                    onClick={() => setDraft((d) => ({ ...d, photo: null }))}
                    className="cs-word ml-3 text-xs text-muted underline underline-offset-4"
                  >
                    Drop it
                  </button>
                )}
                <p className="mt-2 text-xs text-muted">Stays on this machine.</p>
              </div>
            </div>
            {photoError && (
              <p role="alert" className="mt-3 text-xs text-line">
                {photoError}
              </p>
            )}

            <CommitBlock
              saving={saving}
              photoBusy={photoBusy}
              error={saveError}
              onSave={save}
              onBack={() => go("review")}
              draft={draft}
            />
          </>
        )}
      </div>
    </main>
  );
};

/**
 * The step's question, focused on mount. Each step auto-advances on the
 * answer, and without this the focus ring lands on <body>: a keyboard user
 * loses their place and a screen reader announces nothing. tabIndex={-1}
 * makes it programmatically focusable without adding a tab stop.
 */
const StepTitle = ({ children }: { children: ReactNode }) => {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <h1
      ref={ref}
      tabIndex={-1}
      className="cs-display mt-5 text-balance text-3xl text-ink outline-none sm:text-4xl"
    >
      {children}
    </h1>
  );
};

/** The one screen that writes, and the only ember in the flow. */
const CommitBlock = ({
  saving,
  photoBusy,
  error,
  onSave,
  onExtras,
  onBack,
  draft,
}: {
  saving: boolean;
  photoBusy: boolean;
  error: string | null;
  onSave: () => void;
  onExtras?: () => void;
  onBack?: () => void;
  draft: LogDraft;
}) => (
  <div className="mt-auto border-t border-rule-strong pt-6">
    {error && (
      <p role="alert" data-save-error className="mb-4 text-sm text-line">
        {error}
      </p>
    )}
    {/* A photo still being read is the one thing worth waiting for: saving
        through it would drop it silently. */}
    <button
      type="button"
      data-save
      data-saving={saving ? "" : undefined}
      disabled={saving || photoBusy}
      onClick={onSave}
      className="cs-pill"
    >
      {saving ? "Saving…" : photoBusy ? "One second…" : "Save it"}
    </button>
    {onExtras && (
      <button
        type="button"
        data-extras-open
        onClick={onExtras}
        className="cs-word ml-4 text-xs text-muted underline underline-offset-4"
      >
        {draft.line || draft.photo ? "edit the photo or line" : "add a photo or a line"}
      </button>
    )}
    {onBack && (
      <button
        type="button"
        data-extras-close
        onClick={onBack}
        className="cs-word ml-4 text-xs text-muted underline underline-offset-4"
      >
        back to the rest
      </button>
    )}
  </div>
);

const PlaceRow = ({
  shop,
  position,
  onSelect,
}: {
  shop: ShopSummary;
  position: number | null;
  onSelect: () => void;
}) => (
  <button
    type="button"
    data-place-row
    data-shop-id={shop.id}
    data-shop-slug={shop.slug}
    data-already-ranked={position ? String(position) : undefined}
    onClick={onSelect}
    className="cs-row grid grid-cols-[3.5rem_1fr] items-center gap-x-4 py-3"
  >
    <PlacePlate name={shop.name} photo={shop.photo} palette={shop.palette} size={56} />
    <span className="min-w-0">
      <span className="cs-display block truncate text-lg text-line">{shop.name}</span>
      <span className="cs-caps mt-1 block text-muted">
        {shop.walk_min} min · {shop.open_now ? "open now" : "closed now"}
        {position && (
          <span className="text-[hsl(var(--pal))] cs-figures" style={{ ["--pal" as string]: `var(--pal-${shop.palette ?? "warm"})` }}>
            {" "}· your #{position}
          </span>
        )}
      </span>
    </span>
  </button>
);

/**
 * Downscale in a canvas before upload: a modern phone photo is 4 MB and the
 * upload route caps at 2 MB, and nothing in this product ever displays one
 * larger than a few hundred pixels.
 */
async function downscale(file: File, max = 1280, quality = 0.72): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", quality);
}

export default LogFlow;
