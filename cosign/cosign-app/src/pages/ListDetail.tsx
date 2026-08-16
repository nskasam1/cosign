import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, api, type CollabRow, type ListView, type ShopSummary } from "@/lib/api";
import { collabFinding, ordinal } from "@/lib/collab";
import { paletteOf, paletteStyle } from "@/lib/palette";
import { track } from "@/lib/analytics";
import { useTitle } from "@/lib/title";
import type { User } from "@/types/cosign";
import PlacePlate from "@/components/log/PlacePlate";
import Nothing from "@/components/Nothing";

/**
 * A list, and — when more than one person can write to it — the order their
 * own rankings imply (brief #8).
 *
 * The page shows the list AS IT IS, always. The derived order is computed for
 * the reader and written nowhere until an editor presses the one button that
 * writes it, because a list that quietly re-ordered itself would be a change
 * nobody made, and there would be nobody to name in the notification the
 * other editors get.
 *
 * Two rules this surface will not bend (PLAN, Phase 5B):
 *   * a tie is never broken. Two places the contributors ordered in opposite
 *     directions share one standing, the brace says which rows the numeral
 *     covers, and the column jumps from 3 to 5.
 *   * a place nobody who can edit has ranked gets NO numeral cell at all —
 *     not a dash, not a zero. A placeholder in that column is one refactor
 *     away from being a rank.
 */

interface Row {
  shop_id: string;
  /** Null only for a place no contributor has ranked. */
  standing: number | null;
  tied: boolean;
  collab: CollabRow | null;
}

const ListDetail = () => {
  const { listId } = useParams();
  const [data, setData] = useState<ListView | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "hidden" | "unreachable">("loading");
  const [adding, setAdding] = useState(false);
  const [shops, setShops] = useState<ShopSummary[]>([]);
  const [friends, setFriends] = useState<User[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  useTitle(data?.list.title ?? null);

  const load = useCallback(() => {
    if (!listId) return;
    api
      .list(listId)
      .then((d) => {
        setData(d);
        setState("ok");
      })
      .catch((err) => {
        setData(null);
        // A 404 is the friends-only wall; anything else is this machine, and
        // telling somebody their friend has shut them out because a request
        // dropped is a lie this product has now caught itself in three times.
        setState(err instanceof ApiError && err.status === 404 ? "hidden" : "unreachable");
      });
  }, [listId]);

  useEffect(load, [load]);

  const openPicker = async () => {
    if (shops.length === 0) {
      const { shops: all } = await api.shops();
      setShops(all);
    }
    setAdding(true);
  };

  const add = async (shopId: string) => {
    if (!data) return;
    await api.addListItem(data.list.id, shopId);
    setAdding(false);
    load();
  };

  const remove = async (shopId: string) => {
    if (!data) return;
    await api.removeListItem(data.list.id, shopId);
    load();
  };

  const redraw = async () => {
    if (!data || busy) return;
    setBusy(true);
    try {
      const { rerank } = await api.rerankList(data.list.id);
      track("list_reranked", { list_id: data.list.id, moved: rerank.moved });
      setSaid(`${rerank.moved} of ${data.items.length} moved.`);
      load();
    } catch {
      setSaid("That didn't save. Nothing moved, and nobody was told.");
    } finally {
      setBusy(false);
    }
  };

  const openEditors = async () => {
    if (friends) return;
    const { accepted } = await api.friends();
    setFriends(accepted);
  };

  const addEditor = async (username: string) => {
    if (!data) return;
    await api.addListEditor(data.list.id, username);
    setFriends(null);
    load();
  };

  // The numerals. When the list already sits in the order its contributors
  // imply, they are the derived STANDINGS — which is where two places share
  // one. Until then they are the list's own positions, because that is what
  // the list currently says.
  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const settled = data.derived.source === "contributors" && data.derived.settled;
    const byId = new Map(data.derived.ranked.map((r) => [r.shop_id, r]));
    const unranked = new Set(data.derived.unranked.map((r) => r.shop_id));
    return data.items.map((it) => ({
      shop_id: it.shop_id,
      standing: settled ? (unranked.has(it.shop_id) ? null : (byId.get(it.shop_id)?.standing ?? null)) : it.position,
      tied: settled && !!byId.get(it.shop_id)?.tied_with_previous,
      collab: data.derived.source === "contributors" ? (byId.get(it.shop_id) ?? null) : null,
    }));
  }, [data]);

  /**
   * Consecutive rows that share a standing become one item — and a place
   * with no standing is not in this list at all: it has its own section
   * below, where the numeral column does not exist rather than standing
   * empty. A blank cell in a column of ranks is one refactor from a rank.
   */
  const groups = useMemo<Row[][]>(() => {
    const out: Row[][] = [];
    for (const row of rows) {
      if (row.standing === null) continue;
      if (row.tied && out.length > 0) out[out.length - 1].push(row);
      else out.push([row]);
    }
    return out;
  }, [rows]);

  const outside = useMemo(() => rows.filter((r) => r.standing === null), [rows]);

  if (state === "loading") {
    return (
      <main data-list data-state="loading" className="cs-wrap flex min-h-[60vh] items-center justify-center">
        <p className="cs-display text-muted">Looking.</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main data-list data-state={state} className="cs-wrap pt-6">
        {state === "hidden" ? (
          <Nothing
            kicker="Not yours to see"
            standalone
            title="That list is friends only."
            body="Lists open up only when their owner sends a link. If you think you should have this one, ask them — that's the whole mechanism, and it's deliberate."
            action={
              <Link to="/" className="cs-pill-ghost">
                Back home
              </Link>
            }
          />
        ) : (
          <Nothing
            kicker="Can't reach it"
            standalone
            title="Cosign can't reach this list."
            body="This is this machine, not the list — it is almost certainly still there. Nothing was missed."
            action={
              <button type="button" onClick={load} className="cs-pill-ghost">
                Try again
              </button>
            }
          />
        )}
      </main>
    );
  }

  const { list, items, can_edit, is_owner, contributors, derived, last_rerank } = data;
  const inList = new Set(items.map((i) => i.shop_id));
  const byShop = new Map(items.map((it) => [it.shop_id, it]));
  const named = (shopId: string) => byShop.get(shopId)?.shop.name ?? shopId;
  const first = (userId: string) =>
    contributors.find((c) => c.user_id === userId)?.display_name.split(" ")[0] ?? "somebody";
  const firstNames = contributors.map((c) => c.display_name.split(" ")[0]);
  const people =
    firstNames.length <= 1
      ? (firstNames[0] ?? "")
      : `${firstNames.slice(0, -1).join(", ")} and ${firstNames.at(-1)}`;
  const collaborative = derived.source === "contributors";
  const canRedraw = can_edit && collaborative && !derived.settled;

  /**
   * Somebody's own number one, sitting below something else. Stated once, on
   * the row it is about, rather than as a footnote section — three
   * near-identical notes at the bottom of a four-screen page is a round trip
   * per asterisk.
   */
  const dissent = new Map<string, string>();
  if (collaborative && derived.ranked.length > 1) {
    const lead = derived.ranked[0];
    for (const c of contributors) {
      const mine = derived.ranked
        .filter((r) => r.positions.some((p) => p.user_id === c.user_id))
        .sort(
          (a, b) =>
            a.positions.find((p) => p.user_id === c.user_id)!.position -
            b.positions.find((p) => p.user_id === c.user_id)!.position,
        );
      const top = mine[0];
      if (!top || top.shop_id === lead.shop_id) continue;
      dissent.set(
        top.shop_id,
        `${c.display_name.split(" ")[0]} has this first, above ${named(lead.shop_id)} — which is first here.`,
      );
    }
  }


  const newest = [...items].sort((a, b) => (a.added_at < b.added_at ? 1 : -1))[0];

  return (
    <main
      data-list
      data-list-id={list.id}
      data-collab={collaborative ? "" : undefined}
      data-settled={derived.settled ? "" : undefined}
      className="cs-wrap pt-[max(var(--space-5),env(safe-area-inset-top))]"
    >
      <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-4">
        <p className="cs-caps text-gold">
          Cosign ·{" "}
          {contributors.length > 1 ? `a list ${firstNames.length} people keep` : "a list"}
        </p>
        <p className="cs-caps text-right text-muted">
          {list.visibility === "public" ? "public" : "friends only"}
        </p>
      </div>

      <h1 className="cs-display mt-5 text-balance text-3xl text-ink sm:text-4xl">{list.title}</h1>

      {collaborative ? (
        <>
          <p data-finding className="cs-display mt-5 text-balance text-xl text-ink">
            {collabFinding(derived, named)}
          </p>
          <p className="cs-display mt-4 text-lg text-line">
            {derived.pairs_judged} pairs of places. {derived.pairs_contested} of them have more than one of
            you on them.
          </p>
          <p className="mt-3 text-sm text-line">
            The order below is {firstNames.length === 2 ? "both" : `all ${firstNames.length}`} of those lists
            laid over each other: every pair is settled by the people who have ranked both, and where they
            disagree nothing breaks the tie. Nothing is averaged, and no list counts for more than another.
          </p>

          <section className="mt-8">
            <h2 className="cs-caps text-gold">Who keeps it</h2>
            <dl data-provenance className="cs-ledger mt-3 text-sm text-line">
              {contributors.map((c) => (
                <Fragment key={c.user_id}>
                  <dt>
                    {c.display_name.split(" ")[0]}
                    <span className="cs-caps ml-3 text-muted">
                      {c.user_id === list.owner_id ? "keeps the list" : "can add and put in order"}
                    </span>
                  </dt>
                  <dd className="cs-caps text-muted">
                    {c.ranked} of {items.length} ranked
                  </dd>
                </Fragment>
              ))}
            </dl>
          </section>
        </>
      ) : (
        items.length > 0 && (
          <p data-finding className="cs-display mt-5 text-balance text-xl text-ink">
            {collabFinding(derived, named)}
          </p>
        )
      )}

      {canRedraw && (
        <section data-out-of-date className="mt-8 border-t border-rule-strong pt-5">
          <h2 className="cs-caps text-gold">Out of date until somebody says so</h2>
          <p className="mt-3 text-sm text-line">
            These lists have moved since this one was last put in order, and none of it has touched the
            order below. Nothing here re-shuffles on its own — an order that rearranged itself while nobody
            was looking would not be anybody's.
          </p>
          <button type="button" data-redraw disabled={busy} onClick={redraw} className="cs-pill mt-5">
            {busy ? "Reading three lists…" : "Put these in order"}
          </button>
          <p className="mt-3 text-xs text-muted">
            Reads {firstNames.length === 2 ? "both" : `all ${firstNames.length}`} of your lists as they stand
            right now and rebuilds this one. Everybody else who can edit it is told that you did, and told
            what moved.
          </p>
        </section>
      )}

      {said && (
        <p data-said className="cs-caps mt-4 text-ember-ink">
          {said}
        </p>
      )}

      {items.length === 0 ? (
        <div className="mt-8">
          <Nothing
            kicker="Empty"
            title="Nothing on it yet."
            body={
              can_edit
                ? "Add a place and it sits here until one of you ranks it. A list of one strong opinion is more use to a friend than a list of twenty hedged ones."
                : "The owner hasn't added anywhere yet."
            }
          />
        </div>
      ) : (
        // One <li> per STANDING, not per place: where two places share one,
        // the brace says which rows the numeral covers.
        <ol className="mt-8">
          {groups.map((group) => (
            <li
              key={group[0].shop_id}
              data-standing={group[0].standing ?? undefined}
              data-shared={group.length > 1 ? "" : undefined}
              className={group.length > 1 ? "cs-brace" : undefined}
            >
              {group.map((row) => {
                const it = byShop.get(row.shop_id)!;
                const positions = row.collab?.positions ?? [];
                const note = dissent.get(row.shop_id);
                return (
                  <span key={row.shop_id} className="relative block">
                    <Link
                      to={`/shop/${it.shop.slug}`}
                      data-item
                      data-shop-id={row.shop_id}
                      data-row-standing={row.standing ?? undefined}
                      style={paletteStyle(paletteOf(it.shop.palette))}
                      className="cs-row grid grid-cols-[2.1rem_1fr_4rem] items-start gap-x-3 py-4"
                    >
                      {/* No cell at all for a place nobody has ranked. */}
                      <span className="cs-display cs-figures pt-1 text-right text-2xl text-[hsl(var(--pal))]">
                        {row.standing ?? ""}
                      </span>
                      <span className="min-w-0">
                        <span className="cs-display block text-balance text-lg text-ink">{it.shop.name}</span>
                        {it.note && (
                          <span className="mt-1 block text-xs text-muted">
                            “{it.note}” — {first(it.added_by)}
                          </span>
                        )}
                        <span className="cs-caps mt-2 block text-gold">
                          {collaborative && `Added by ${first(it.added_by)}`}
                          {positions.map((p) => (
                            <span key={p.user_id} className="cs-figures">
                              {" · "}
                              {first(p.user_id)} {p.position}
                            </span>
                          ))}
                          {collaborative &&
                            positions.length === 0 &&
                            contributors.map((c) => (
                              <span key={c.user_id}>
                                {" · "}
                                {c.display_name.split(" ")[0]} —
                              </span>
                            ))}
                        </span>
                      </span>
                      {it.shop.photo ? (
                        <img
                          src={it.shop.photo}
                          alt=""
                          width={64}
                          height={64}
                          className="cs-shot h-16 w-16"
                          loading="lazy"
                        />
                      ) : (
                        <PlacePlate name={it.shop.name} photo={null} palette={it.shop.palette} size={64} />
                      )}
                    </Link>
                    {note && (
                      <span className="mt-1 block border-l border-rule-strong pl-3 text-xs text-line">
                        {note}
                      </span>
                    )}
                    {/* Its own line rather than a corner: the photograph
                        owns the right edge of the row, and a control laid
                        over a picture is a control nobody can see. */}
                    {can_edit && (
                      <span className="flex justify-end">
                        <button
                          type="button"
                          data-remove
                          onClick={() => remove(row.shop_id)}
                          className="cs-word cs-caps min-w-[var(--tap)] justify-center px-4 text-muted"
                        >
                          <span className="sr-only">Take {it.shop.name} off this list</span>
                          <span aria-hidden="true">off</span>
                        </button>
                      </span>
                    )}
                  </span>
                );
              })}
              {group.length > 1 && (
                <p data-tie-note className="mb-4 mt-1 pl-[2.6rem] text-xs text-line">
                  {ordinal(group[0].standing ?? 0)} is two places. {named(group[0].shop_id)} and{" "}
                  {named(group[1].shop_id)} have been ranked against each other and came out level —
                  nothing here separates them, nobody is overruled to make the column tidier, and there is
                  no {ordinal((group[0].standing ?? 0) + 1)}.
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      {outside.length > 0 && (
        <section data-unranked className="mt-9 border-t border-rule-strong pt-5">
          <h2 className="cs-caps text-gold">Added, not in the order</h2>
          {/* No numeral column at all here — see the comment above `groups`. */}
          <ul className="mt-4">
            {outside.map((row) => {
              const it = byShop.get(row.shop_id)!;
              return (
                <li key={row.shop_id}>
                  <Link
                    to={`/shop/${it.shop.slug}`}
                    data-outside
                    data-shop-id={row.shop_id}
                    style={paletteStyle(paletteOf(it.shop.palette))}
                    className="cs-row grid grid-cols-[1fr_4rem] items-start gap-x-3 py-4"
                  >
                    <span className="min-w-0">
                      <span className="cs-display block text-balance text-lg text-ink">{it.shop.name}</span>
                      {it.note && (
                        <span className="mt-1 block text-xs text-muted">
                          “{it.note}” — {first(it.added_by)}
                        </span>
                      )}
                      <span className="cs-caps mt-2 block text-gold">
                        Added by {first(it.added_by)}
                        {contributors.map((c) => (
                          <span key={c.user_id}>
                            {" · "}
                            {c.display_name.split(" ")[0]} —
                          </span>
                        ))}
                      </span>
                    </span>
                    {it.shop.photo ? (
                      <img src={it.shop.photo} alt="" width={64} height={64} className="cs-shot h-16 w-16" loading="lazy" />
                    ) : (
                      <PlacePlate name={it.shop.name} photo={null} palette={it.shop.palette} size={64} />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-sm text-line">
            None of {people} has put {derived.unranked.map((r) => named(r.shop_id)).join(", ")} in order, so
            there is nothing to compare {derived.unranked.length === 1 ? "it" : "them"} against — not one
            this-or-that anywhere in your lists involves{" "}
            {derived.unranked.length === 1 ? "it" : "them"}. It sits here until one of you goes, and then it
            lands wherever the taps put it.
          </p>
          <p className="mt-2 text-xs text-muted">It could be given a position by guessing. It won't be.</p>
          <Link to="/log" className="cs-pill-ghost mt-5">
            Log a visit
          </Link>
          <p className="mt-3 text-xs text-muted">
            In Cosign an order comes out of the head-to-head and from nowhere else, so a log is the only way
            in.
          </p>
        </section>
      )}

      {can_edit && !adding && (
        <button type="button" data-add-place onClick={openPicker} className="cs-pill-ghost mt-8">
          Add a place
        </button>
      )}

      {adding && (
        <section className="mt-8 border-t border-rule-strong pt-5">
          <h2 className="cs-caps text-gold">Which one?</h2>
          <div className="mt-2 max-h-96 overflow-y-auto">
            {shops
              .filter((s) => !inList.has(s.id))
              .map((s) => (
                <button key={s.id} type="button" onClick={() => add(s.id)} className="cs-row py-4">
                  <span className="cs-display block text-lg text-line">{s.name}</span>
                </button>
              ))}
          </div>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="cs-word mt-3 text-xs text-muted underline underline-offset-4"
          >
            never mind
          </button>
        </section>
      )}

      {is_owner && (
        <section data-editors className="mt-10 border-t border-rule-strong pt-5">
          <h2 className="cs-caps text-gold">Who can change it</h2>
          <dl className="cs-ledger mt-3 text-sm text-line">
            {contributors.map((c, i) => (
              <Fragment key={c.user_id}>
                <dt>{c.display_name}</dt>
                <dd className="cs-caps text-muted">{i === 0 ? "owns it" : "can add and put in order"}</dd>
              </Fragment>
            ))}
          </dl>
          {friends === null ? (
            <button type="button" data-add-editor onClick={openEditors} className="cs-word mt-4 text-sm text-ember-ink underline underline-offset-4">
              add an editor
            </button>
          ) : (
            <div className="mt-5">
              <h3 className="cs-caps text-muted">Somebody you know</h3>
              {friends.filter((f) => !contributors.some((c) => c.user_id === f.id)).length === 0 ? (
                <p className="mt-2 text-sm text-line">
                  Everybody you've agreed to know can already write to this one.
                </p>
              ) : (
                friends
                  .filter((f) => !contributors.some((c) => c.user_id === f.id))
                  .map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      data-editor-candidate={f.username}
                      onClick={() => addEditor(f.username)}
                      className="cs-row py-4"
                    >
                      <span className="cs-display block text-lg text-line">{f.display_name}</span>
                    </button>
                  ))
              )}
            </div>
          )}
          <p className="mt-4 text-xs text-muted">
            Adding somebody puts a line on that person's page saying you did. Only people you have agreed to
            know — an editor is write access to your list.
          </p>
        </section>
      )}

      {collaborative && (last_rerank || newest) && (
        <section data-record className="mt-9 border-t border-rule pt-5">
          <h2 className="cs-caps text-gold">The record</h2>
          <dl className="cs-ledger mt-3 text-sm text-line">
            {newest && (!last_rerank || newest.added_at > last_rerank.created_at) && (
              <Fragment>
                <dt>
                  {first(newest.added_by)} added {newest.shop.name}
                  {last_rerank && " — after the last time this was put in order"}
                </dt>
                <dd className="cs-caps text-muted">{dateOf(newest.added_at)}</dd>
              </Fragment>
            )}
            {last_rerank && (
              <Fragment>
                <dt>
                  {first(last_rerank.actor_id)} put the list back in order. {last_rerank.moved} of{" "}
                  {items.length} moved.
                </dt>
                <dd className="cs-caps text-muted">{dateOf(last_rerank.created_at)}</dd>
              </Fragment>
            )}
          </dl>
        </section>
      )}

      {collaborative && (
        <p className="cs-caps mt-10 border-t border-rule pt-5 text-muted">
          Nothing here is scored, and nothing here was paid for.
        </p>
      )}
    </main>
  );
};

/** "15 Aug" — read off the timestamp's own date part, never the viewer's
 *  clock, the same rule Phase 4's stale labels follow. */
function dateOf(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]} ${String(y).slice(2)}`;
}

export default ListDetail;
