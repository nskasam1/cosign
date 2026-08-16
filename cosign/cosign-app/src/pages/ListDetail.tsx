import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type ListView, type ShopSummary } from "@/lib/api";
import { paletteOf, paletteStyle } from "@/lib/palette";
import { useTitle } from "@/lib/title";
import PlacePlate from "@/components/log/PlacePlate";
import Nothing from "@/components/Nothing";

// A list (distinct from the canonical ranking). Friends-only by default —
// the server 404s this for anyone outside the owner's circle unless the list
// is public (decision 12), so there is nothing to hide client-side.
const ListDetail = () => {
  const { listId } = useParams();
  const [data, setData] = useState<ListView | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [shops, setShops] = useState<ShopSummary[]>([]);
  useTitle(data?.list.title ?? null);

  const load = useCallback(() => {
    if (!listId) return;
    api
      .list(listId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
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

  if (loading) {
    return (
      <main data-list className="cs-wrap flex min-h-[60vh] items-center justify-center">
        <p className="cs-caps text-muted">Opening…</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main data-list data-state="missing" className="cs-wrap pt-6">
        <Nothing
          kicker="Not yours to see"
          standalone
          title="This list is friends-only."
          body="Lists open up only when their owner sends a link. If you think you should have this one, ask them — that's the whole mechanism, and it's deliberate."
          action={
            <Link to="/" className="cs-pill-ghost">
              Back home
            </Link>
          }
        />
      </main>
    );
  }

  const { list, items, can_edit } = data;
  const inList = new Set(items.map((i) => i.shop_id));

  return (
    <main data-list data-list-id={list.id} className="cs-wrap pt-[max(var(--space-5),env(safe-area-inset-top))]">
      <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-4">
        <p className="cs-caps text-gold">Cosign · a list</p>
        <p className="cs-caps text-right text-muted">
          {list.is_collaborative ? "collaborative · " : ""}
          {list.visibility === "public" ? "public" : "friends only"}
        </p>
      </div>

      <h1 className="cs-display mt-5 text-balance text-3xl text-ink sm:text-4xl">{list.title}</h1>

      {items.length === 0 ? (
        <div className="mt-8">
          <Nothing
            kicker="Empty"
            title="Nothing on it yet."
            body={
              can_edit
                ? "Add the first place. A list of one strong opinion is more use to a friend than a list of twenty hedged ones."
                : "The owner hasn't added anywhere yet."
            }
          />
        </div>
      ) : (
        <ol className="mt-6">
          {items.map((it) => (
            <li key={it.shop_id} className="relative">
              <Link
                to={`/shop/${it.shop.slug}`}
                data-item
                data-shop-id={it.shop_id}
                style={paletteStyle(paletteOf(it.shop.palette))}
                className="cs-row grid grid-cols-[2.1rem_3.5rem_1fr] items-center gap-x-3 py-4 pr-16"
              >
                <span className="cs-display cs-figures text-right text-2xl text-[hsl(var(--pal))]">
                  {it.position}
                </span>
                <PlacePlate name={it.shop.name} photo={null} palette={it.shop.palette} size={56} />
                <span className="min-w-0">
                  <span className="cs-display block truncate text-lg text-ink">{it.shop.name}</span>
                  {it.note && <span className="mt-1 block truncate text-xs text-muted">{it.note}</span>}
                </span>
              </Link>
              {/* `.cs-word` sets a 44px minimum HEIGHT and nothing about
                  width, and "off" at 11px is 40px wide — under the target the
                  brief mandates. The padding is what makes it a target, not
                  the word. */}
              {can_edit && (
                <button
                  type="button"
                  data-remove
                  onClick={() => remove(it.shop_id)}
                  className="cs-caps absolute bottom-0 right-0 top-0 min-w-[var(--tap)] px-4 text-muted"
                >
                  <span className="sr-only">Take {it.shop.name} off this list</span>
                  <span aria-hidden="true">off</span>
                </button>
              )}
            </li>
          ))}
        </ol>
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
    </main>
  );
};

export default ListDetail;
