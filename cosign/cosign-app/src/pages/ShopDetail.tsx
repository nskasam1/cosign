import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { api, type ShopDetail as ShopDetailData } from "@/lib/api";
import { currentTimeBucket } from "@/lib/timeBucket";
import { dataAge } from "@/lib/freshness";
import { paletteOf, paletteStyle, initialsOf } from "@/lib/palette";
import { isLastThroughTheDoor, todaysWindow } from "@/lib/placeCopy";
import { track } from "@/lib/analytics";
import {
  CROWD_LABELS,
  INTENT_TAG_LABELS_SHORT,
  NOISE_LABELS,
  type TimeBucket,
} from "@/types/cosign";
import Nothing from "@/components/Nothing";

// A place (Phase 4). The Phase-1 holding shape was an amenity grid of
// rounded cards with a lucide icon in each; this is the same ten facts
// (decision 6) set as a column of hairline rows, in the language the log
// flow and the share page already speak.
//
// Two things are new here and both come from brief #10: the data's age is
// stated in words on every fact block, and coming back to a place you have
// been to, whose facts have gone stale, asks you — specifically — whether
// they are still true. That prompt is HERE rather than on Home because a
// revisit is arriving somewhere again, and because asking twenty-two
// questions of somebody who opened the app to be told one thing is how you
// train people to ignore you.

const BUCKETS: TimeBucket[] = ["morning", "afternoon", "evening", "late_night"];
const BUCKET_WORDS: Record<TimeBucket, string> = {
  morning: "Mornings",
  afternoon: "Afternoons",
  evening: "Evenings",
  late_night: "Late night",
};

const TABLE_WORDS: Record<string, string> = {
  laptop: "room for a laptop",
  laptop_plus_friend: "room for a laptop and a friend",
  mug_only: "room for a mug, and that is the point",
};

const BATHROOM_WORDS: Record<string, string> = {
  open: "open to anyone",
  code: "you need the code",
  customer_only: "customers only",
};

const ShopDetail = () => {
  const { shopId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["shop", shopId],
    queryFn: () => api.shop(shopId!),
    enabled: Boolean(shopId),
    staleTime: 30_000,
  });
  const data = query.data;

  useEffect(() => {
    if (data) track("shop_viewed", { shop_id: data.shop.id });
  }, [data]);

  const confirmFresh = useCallback(async () => {
    if (!data) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      await api.verifyShop(data.shop.id);
      track("freshness_confirmed", { shop_id: data.shop.id });
      setConfirmed(true);
      await query.refetch();
    } catch {
      // A `finally` with no `catch` here would flip the button back to
      // "Still right" and say nothing at all, and the one person who can
      // answer this would reasonably believe they had.
      setConfirmError("That didn't save. The date on file is unchanged — try again in a moment.");
    } finally {
      setConfirming(false);
    }
  }, [data, query]);

  // "Revisit" is not a page view — it is having been there. The server sends
  // the viewer's own last visit as its own field rather than leaving it to be
  // dug out of `logs`, which is capped at thirty rows: on a busy shop the
  // viewer's own log falls outside that window and the one person who can
  // answer the freshness question would stop being asked.
  const myLastVisit = data?.your_last_visit ?? null;

  // ...and the ask is loudest for exactly one person: whoever has been in
  // since the facts were last confirmed. Anyone else is being asked to
  // vouch for something they did not see.
  const lastThroughTheDoor = isLastThroughTheDoor(myLastVisit, data?.shop.last_verified_at ?? null);

  if (query.isLoading) {
    return (
      <main data-shop className="cs-wrap flex min-h-[60vh] items-center justify-center">
        <p className="cs-caps text-muted">Opening…</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main data-shop data-state="missing" className="cs-wrap pt-6">
        <Nothing
          kicker="Not here"
          standalone
          title="No such place, at least not on this campus."
          body="Cosign only knows the places around campus that somebody has actually been to. The link may be old, or the place may have closed."
          action={
            <button type="button" onClick={() => navigate("/")} className="cs-pill-ghost">
              Back home
            </button>
          }
        />
      </main>
    );
  }

  const { shop, photos, hours, intent_tallies, conditions, cosigners } = data;
  const a = shop.amenities;
  const today = todaysWindow(hours);
  const bucket = currentTimeBucket();
  const age = dataAge(shop.last_verified_at);
  const palette = paletteOf(shop.palette);
  const stale = age.stale && !confirmed;

  const facts: Array<[string, string]> = [];
  if (a?.outlet_count != null) {
    facts.push([
      "Outlets",
      a.outlet_count === 0
        ? `None${a.outlet_note ? ` — ${a.outlet_note}` : ""}`
        : `${a.outlet_count}${a.outlet_note ? ` — ${a.outlet_note}` : ""}`,
    ]);
  }
  if (a) {
    facts.push([
      "Wifi",
      a.wifi_mbps ? `${a.wifi_mbps} Mbps${a.wifi_note ? ` — ${a.wifi_note}` : ""}` : "None",
    ]);
    if (a.seat_count != null || a.table_size) {
      facts.push([
        "Seating",
        [a.seat_count != null ? `${a.seat_count} seats` : null, a.table_size ? TABLE_WORDS[a.table_size] : null]
          .filter(Boolean)
          .join(", "),
      ]);
    }
    facts.push(["Staying", a.camp_ok ? a.camp_note || "Fine to stay four hours" : a.camp_note || "Not a four-hour place"]);
    facts.push(["Light", a.natural_light ? "Real daylight" : "No natural light to speak of"]);
    if (a.bathroom_access) {
      facts.push([
        "Bathroom",
        `${BATHROOM_WORDS[a.bathroom_access] ?? a.bathroom_access}${a.bathroom_access === "code" && a.bathroom_code ? ` (${a.bathroom_code})` : ""}`,
      ]);
    }
  }
  if (shop.price_drip || shop.price_latte) {
    facts.push([
      "Prices",
      [
        shop.price_drip ? `drip $${shop.price_drip.toFixed(2)}` : null,
        shop.price_latte ? `latte $${shop.price_latte.toFixed(2)}` : null,
        shop.student_discount ? shop.student_discount_note || "student discount" : null,
      ]
        .filter(Boolean)
        .join(" · "),
    ]);
  }

  return (
    <main
      data-shop
      data-shop-slug={shop.slug}
      data-stale={stale ? "" : undefined}
      style={paletteStyle(palette)}
      className="cs-wrap pt-[max(var(--space-5),env(safe-area-inset-top))]"
    >
      <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-4">
        <button type="button" data-back onClick={() => navigate(-1)} className="cs-word cs-caps text-muted">
          Back
        </button>
        <p className="cs-caps truncate text-right text-gold">Cosign · a place</p>
      </div>

      {photos.length > 0 ? (
        // A scrollable strip of nothing but images has no focusable child,
        // so a keyboard user cannot reach it at all. tabIndex makes the
        // region itself focusable and therefore scrollable with the arrows.
        <div
          tabIndex={0}
          role="group"
          aria-label={`Photographs of ${shop.name}`}
          className="no-scrollbar -mx-[var(--gutter)] mt-5 flex gap-2 overflow-x-auto px-[var(--gutter)]"
        >
          {photos.map((p, i) => (
            <img
              key={p.id}
              src={p.path}
              alt=""
              width={280}
              height={175}
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
              className="cs-shot h-[175px] w-[280px] flex-none rounded-[var(--radius-md)] object-cover"
            />
          ))}
        </div>
      ) : (
        <div
          data-nophoto
          aria-hidden="true"
          className="cs-plate mt-5 flex aspect-[16/9] w-full items-center justify-center rounded-[var(--radius-md)] text-5xl"
        >
          {initialsOf(shop.name)}
        </div>
      )}

      <h1 className="cs-display mt-5 text-balance text-3xl text-ink sm:text-4xl">{shop.name}</h1>
      {shop.one_liner && <p className="mt-3 text-base text-line">{shop.one_liner}</p>}

      <p data-status className="cs-caps mt-4 text-gold">
        {shop.walk_min} min walk
        <span className="text-muted"> · </span>
        <span className={shop.open_now ? "text-ember-ink" : "text-muted"}>
          {shop.open_now ? "open now" : "shut right now"}
        </span>
        {today && (
          <>
            <span className="text-muted"> · </span>
            <span className="text-muted">{today} today</span>
          </>
        )}
      </p>
      <p className="mt-1 text-xs text-muted">{shop.address}</p>

      {/* The re-verify prompt. Only for a place whose facts have gone stale,
          and loudest for someone who has actually been there — they are the
          only person who can answer it. */}
      {/* Only one person is asked, and it is the person who can answer:
          whoever has been in since the facts were last confirmed. Everybody
          else gets the caveat and no button — confirming something you did
          not see is exactly the unverified data this feature exists to stop,
          and an ask that everyone gets is a nag. */}
      {stale && (
        <section
          data-reverify
          data-revisit={lastThroughTheDoor ? "" : undefined}
          className="mt-6 border-y border-rule-strong py-5"
        >
          <p className="cs-caps text-gold">
            {lastThroughTheDoor ? "Is this still right?" : "Nobody has checked in a while"}
          </p>
          <p className="mt-2 text-sm text-line">
            {age.label[0].toUpperCase() + age.label.slice(1)}.{" "}
            {lastThroughTheDoor ? (
              <>
                You were here{" "}
                <span data-last-visit>
                  {new Date(myLastVisit!).toLocaleDateString("en-US", { month: "long", day: "numeric" })}
                </span>
                , which is after the last time anyone confirmed any of this — you are the last person through
                the door, so you are the only one being asked.
              </>
            ) : (
              "Treat what's below as a rumour until somebody who has been in says otherwise."
            )}
          </p>
          {confirmError && (
            <p role="alert" data-verify-error className="mt-3 text-sm text-line">
              {confirmError}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-4">
            {lastThroughTheDoor && (
              <button type="button" data-verify disabled={confirming} onClick={confirmFresh} className="cs-pill">
                {confirming ? "Noting it…" : "Still right"}
              </button>
            )}
            {user && (
              <Link
                to={`/log?shop=${shop.slug}`}
                data-verify-log
                className={
                  lastThroughTheDoor
                    ? "cs-word text-xs text-muted underline underline-offset-4"
                    : "cs-pill-ghost"
                }
              >
                {lastThroughTheDoor ? "something's changed — log a visit" : "I'm here — log it"}
              </Link>
            )}
          </div>
        </section>
      )}

      {confirmed && (
        <p data-verified role="status" className="cs-caps mt-6 text-ember-ink">
          Noted — checked today, by you.
        </p>
      )}

      <section className="mt-8">
        <h2 className="cs-caps text-gold">What's actually here</h2>
        <dl className="mt-3">
          {facts.map(([label, value]) => (
            <div key={label} data-fact={label.toLowerCase()} className="grid grid-cols-[5.5rem_1fr] gap-x-4 border-t border-rule py-3">
              <dt className="cs-caps text-muted">{label}</dt>
              <dd className="text-sm text-line">{value}</dd>
            </div>
          ))}
        </dl>
        <p data-age className={`cs-caps mt-3 ${stale ? "text-line" : "text-muted"}`}>
          {age.label}
        </p>
      </section>

      {Object.keys(conditions).length > 0 && (
        <section className="mt-8">
          <h2 className="cs-caps text-gold">What it's like, by the hour</h2>
          <p className="mt-2 text-xs text-muted">
            Taken from what people tapped when they logged a visit — labels, never numbers.
          </p>
          <dl className="mt-3">
            {BUCKETS.filter((b) => conditions[b]).map((b) => {
              const c = conditions[b]!;
              return (
                <div
                  key={b}
                  data-bucket={b}
                  data-now={b === bucket ? "" : undefined}
                  className="grid grid-cols-[6.5rem_1fr] gap-x-4 border-t border-rule py-3"
                >
                  <dt className={`cs-caps ${b === bucket ? "text-ember-ink" : "text-muted"}`}>{BUCKET_WORDS[b]}</dt>
                  <dd className="text-sm text-line">
                    {[c.noise ? NOISE_LABELS[c.noise].toLowerCase() : null, c.crowd ? CROWD_LABELS[c.crowd].toLowerCase() : null]
                      .filter(Boolean)
                      .join(", ") || "nobody has said"}
                    <span className="text-muted"> · {c.samples} {c.samples === 1 ? "visit" : "visits"}</span>
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      )}

      {intent_tallies.length > 0 && (
        <section className="mt-8">
          <h2 className="cs-caps text-gold">What people come here for</h2>
          <p data-intents className="cs-caps mt-3 text-line">
            {intent_tallies.map((t, i) => (
              <span key={t.intent_tag}>
                {i > 0 && <span className="text-muted"> · </span>}
                {INTENT_TAG_LABELS_SHORT[t.intent_tag]}
                <span className="cs-figures text-muted"> {t.tally}</span>
              </span>
            ))}
          </p>
        </section>
      )}

      <section className="mt-8">
        <h2 className="cs-caps text-gold">Cosigned by</h2>
        {cosigners.total === 0 ? (
          <p className="mt-3 text-sm text-line">
            Nobody has put this in order yet. Ranking it into your list is the whole endorsement — there is
            no other button for it.
          </p>
        ) : (
          <p data-cosigners className="mt-3 text-sm text-line">
            {cosigners.cosigners.slice(0, 8).map((cs, i) => (
              <span key={cs.user_id}>
                {i > 0 && ", "}
                <Link to={`/${cs.username}`} className={cs.is_friend ? "text-ink underline underline-offset-4" : "underline underline-offset-4"}>
                  {cs.display_name}
                </Link>
                <span className="text-muted"> #{cs.position}</span>
              </span>
            ))}
            {/* Everyone past the eighth name counts too. Adding only the
                rankings the viewer may NOT read would quietly lose the ones
                it truncated and understate the total by that many. */}
            {cosigners.total - Math.min(cosigners.cosigners.length, 8) > 0 && (
              <span className="text-muted">
                {cosigners.cosigners.length > 0 ? " and " : ""}
                {cosigners.total - Math.min(cosigners.cosigners.length, 8)} more
              </span>
            )}
            .
          </p>
        )}
      </section>

      {user && (
        <div className="mt-8 border-t border-rule-strong pt-6">
          {/* Entering from here pre-picks the place, so the log is five taps
              from this screen instead of six. */}
          <Link to={`/log?shop=${shop.slug}`} data-log-entry-shop data-shop-slug={shop.slug} className="cs-pill">
            I'm here — log it
          </Link>
        </div>
      )}
    </main>
  );
};

export default ShopDetail;
