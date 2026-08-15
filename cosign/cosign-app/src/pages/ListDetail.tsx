import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ListOrdered, Plus, X } from "lucide-react";
import { api, type ListView, type ShopSummary } from "@/lib/api";
import EmptyState from "@/components/EmptyState";

// List detail. Friends-only by default — the server 404s this for anyone
// outside the owner's circle unless the list is public (decision 12).
const ListDetail = () => {
  const { listId } = useParams();
  const [data, setData] = useState<ListView | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [shops, setShops] = useState<ShopSummary[]>([]);

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
      <div className="flex items-center justify-center h-screen">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={<ListOrdered className="w-6 h-6" />}
        title="This list isn't yours to see"
        description="It may be friends-only, or the link is broken. Lists open up only when their owner shares them."
        action={<Link to="/" className="text-sm text-primary font-semibold">Back home</Link>}
      />
    );
  }

  const { list, items, can_edit } = data;
  const inList = new Set(items.map((i) => i.shop_id));

  return (
    <div className="min-h-screen px-5 py-8 max-w-md mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-black text-foreground">{list.title}</h1>
        <p className="text-xs text-muted-foreground">
          {list.is_collaborative ? "Collaborative · " : ""}
          {list.visibility === "public" ? "Public" : "Friends only"}
        </p>
      </header>

      {items.length === 0 ? (
        <EmptyState
          icon={<ListOrdered className="w-6 h-6" />}
          title="Empty list, full of promise"
          description={can_edit ? "Add the first place — every good list starts with one strong opinion." : "Nothing here yet."}
        />
      ) : (
        <ol className="space-y-2">
          {items.map((it) => (
            <li key={it.shop_id} className="flex items-center gap-3 rounded-2xl bg-card border border-border p-3">
              <span className="text-primary font-black w-6 text-right">{it.position}</span>
              <Link to={`/shop/${it.shop.slug}`} className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-foreground truncate">{it.shop.name}</span>
                {it.note && <span className="block text-xs text-muted-foreground truncate">{it.note}</span>}
              </Link>
              {can_edit && (
                <button onClick={() => remove(it.shop_id)} aria-label={`Remove ${it.shop.name}`} className="p-2 text-muted-foreground">
                  <X className="w-4 h-4" />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}

      {can_edit && !adding && (
        <button
          onClick={openPicker}
          className="mt-6 w-full rounded-xl border border-dashed border-border text-sm text-muted-foreground p-3 flex items-center justify-center gap-2 min-h-[44px] hover:border-primary/60 hover:text-primary"
        >
          <Plus className="w-4 h-4" /> Add a place
        </button>
      )}

      {adding && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-foreground mb-2">Pick a place</h2>
          <div className="grid gap-2 max-h-80 overflow-y-auto">
            {shops
              .filter((s) => !inList.has(s.id))
              .map((s) => (
                <button
                  key={s.id}
                  onClick={() => add(s.id)}
                  className="rounded-2xl bg-card border border-border p-3 text-left text-sm font-semibold text-foreground hover:border-primary/60 min-h-[44px]"
                >
                  {s.name}
                </button>
              ))}
          </div>
          <button onClick={() => setAdding(false)} className="mt-3 text-xs text-muted-foreground underline-offset-4 hover:underline">
            Never mind
          </button>
        </div>
      )}
    </div>
  );
};

export default ListDetail;
