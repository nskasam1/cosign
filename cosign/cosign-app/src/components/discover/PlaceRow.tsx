import { Link } from "react-router-dom";
import type { DiscoverEntry } from "@/lib/api";
import { initialsOf, paletteOf, paletteStyle } from "@/lib/palette";
import { factsOf, freshnessBand, friendSentence } from "@/lib/placeCopy";
import PlacePlate from "@/components/log/PlacePlate";

/**
 * One place in a column: its picture, its name, the one honest line about it,
 * who put it in order, and the facts. The share page's entry, carried into a
 * surface that also has state — open or shut, checked or gone stale.
 *
 * The whole row is one link. The re-verify prompt deliberately does NOT live
 * here: "prompt a re-verify on revisit" (brief #10) means when you arrive at
 * a place you have been to, which is the shop page — a button on every row
 * of Home would be asking twenty-two questions of somebody who came here to
 * be told one thing.
 */
const PlaceRow = ({
  place,
  now,
  lead = false,
}: {
  place: DiscoverEntry;
  now: Date;
  lead?: boolean;
}) => {
  const facts = factsOf(place, now);
  const who = friendSentence(place);
  const palette = paletteOf(place.palette);
  const band = freshnessBand(place.age);

  return (
    <Link
      to={`/shop/${place.slug}`}
      data-place
      data-shop-id={place.id}
      data-shop-slug={place.slug}
      data-lead={lead ? "" : undefined}
      data-stale={place.age.stale ? "" : undefined}
      style={paletteStyle(palette)}
      className={
        lead
          ? "cs-row block py-5"
          : "cs-row grid grid-cols-[3.5rem_1fr] items-start gap-x-4 py-5"
      }
    >
      {lead ? (
        place.photo ? (
          <img
            src={place.photo}
            alt=""
            width={560}
            height={350}
            fetchPriority="high"
            decoding="async"
            className="cs-shot mb-4 aspect-[16/10] w-full rounded-[var(--radius-md)] object-cover"
          />
        ) : (
          <span
            data-nophoto
            aria-hidden="true"
            className="cs-plate mb-4 flex aspect-[16/10] w-full items-center justify-center rounded-[var(--radius-md)] text-4xl"
          >
            {initialsOf(place.name)}
          </span>
        )
      ) : (
        <PlacePlate name={place.name} photo={place.photo} palette={place.palette} size={56} />
      )}

      <span className="block min-w-0">
        <span className={`cs-display block text-ink ${lead ? "text-3xl sm:text-4xl" : "text-lg"}`}>
          {place.name}
        </span>

        {place.one_liner && (
          <span className={`mt-2 block text-line ${lead ? "text-base" : "text-sm"}`}>
            {place.one_liner}
          </span>
        )}

        {who && (
          <span data-who className="mt-3 flex items-start gap-2 text-xs text-muted">
            {place.friends.length > 0 && (
              <span aria-hidden="true" className="flex flex-none pt-0.5">
                {/* Two, and the sentence names the same two. A hard cap
                    rather than a habit: with three you could walk the
                    column and reassemble a friend's whole ordering. */}
                {place.friends.slice(0, 2).map((f, i) =>
                  f.avatar ? (
                    <img
                      key={f.username}
                      src={f.avatar}
                      alt=""
                      width={22}
                      height={22}
                      loading="lazy"
                      decoding="async"
                      className={`h-[22px] w-[22px] rounded-full border-[1.5px] border-background bg-surface ${i > 0 ? "-ml-2" : ""}`}
                    />
                  ) : null,
                )}
              </span>
            )}
            <span className="min-w-0">{who}</span>
          </span>
        )}

        {/* Past sixty days the facts leave the label voice entirely: same
            words, muted and untracked, because they are no longer a claim
            anybody is standing behind. */}
        <span
          data-facts
          data-freshness={band}
          className={`cs-caps mt-3 block ${band === "stale" ? "font-normal tracking-[0.1em] text-muted" : "text-gold"}`}
        >
          {facts.map((f, i) => (
            <span key={f}>
              {i > 0 && <span className="text-muted"> · </span>}
              <span className={f.startsWith("your ") && band !== "stale" ? "text-[hsl(var(--pal))]" : undefined}>
                {f}
              </span>
            </span>
          ))}
        </span>

        {/* And the caveat is set BRIGHTER than the facts it qualifies. Under
            three weeks it says nothing at all — somebody checked recently,
            which is the default, and a default needs no line. */}
        {band !== "fresh" && (
          <span
            data-age
            className={`cs-caps mt-1 block ${band === "stale" ? "text-line" : "text-muted"}`}
          >
            {place.age.label}
          </span>
        )}
      </span>
    </Link>
  );
};

export default PlaceRow;
