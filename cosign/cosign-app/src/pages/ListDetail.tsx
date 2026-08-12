import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { Plus, X, List as ListIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { List, ListItem, Shop } from "@/types/cosign";
import EmptyState from "@/components/EmptyState";

// Phase 4.2 — collaborative lists. Public read (same discovery ethos as
// everything else); add/remove gated by can_edit_list() server-side, this
// UI just hides the controls when the viewer isn't an editor.
const ListDetail = () => {
  const { listId } = useParams();
  const { user } = useAuth();

  const [list, setList] = useState<List | null>(null);
  const [items, setItems] = useState<(ListItem & { shop: Shop })[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [allShops, setAllShops] = useState<Shop[]>([]);
  const [picking, setPicking] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!listId) return;
    const { data: listData } = await supabase.from("lists").select("*").eq("id", listId).single();
    setList((listData as List) ?? null);

    const { data: itemRows } = await supabase
      .from("list_items")
      .select("*, shop:shops(*)")
      .eq("list_id", listId)
      .order("position");
    setItems((itemRows ?? []) as unknown as (ListItem & { shop: Shop })[]);

    if (user) {
      const { data: editable } = await supabase.rpc("can_edit_list", { p_list_id: listId, p_user_id: user.id });
      setCanEdit(!!editable);
    }
    setLoading(false);
  }, [listId, user]);

  useEffect(() => { load(); }, [load]);

  const addShop = async (shop: Shop) => {
    if (!user || !listId) return;
    await supabase.from("list_items").insert({
      list_id: listId,
      shop_id: shop.id,
      added_by: user.id,
      position: items.length,
    });
    setPicking(false);
    load();
  };

  const removeItem = async (itemId: string) => {
    await supabase.from("list_items").delete().eq("id", itemId);
    load();
  };

  const openPicker = async () => {
    const { data } = await supabase.from("shops").select("*");
    setAllShops((data ?? []) as Shop[]);
    setPicking(true);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-screen">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>;
  }

  if (!list) {
    return (
      <EmptyState
        icon={<ListIcon className="w-6 h-6" />}
        title="List not found"
        description="This list may have been removed."
        action={<Link to="/" className="text-sm text-primary font-semibold">Back home</Link>}
      />
    );
  }

  return (
    <div className="min-h-screen pb-10">
      <div className="px-5 pt-8 pb-4">
        <h1 className="text-2xl font-black text-foreground">{list.title}</h1>
        {list.is_collaborative && <p className="text-sm text-muted-foreground">Collaborative list</p>}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<ListIcon className="w-6 h-6" />}
          title="Nothing added yet"
          description={canEdit ? "Add the first shop to get this list started." : "This list is still empty."}
          action={canEdit && <button onClick={openPicker} className="text-sm font-semibold text-primary">Add a shop</button>}
        />
      ) : (
        <ol className="px-5 flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 rounded-2xl bg-card border border-border p-3">
              <Link to={`/shop/${item.shop.id}`} className="flex-1">
                <div className="font-semibold text-foreground">{item.shop.name}</div>
                <div className="text-xs text-muted-foreground">{item.shop.address}</div>
              </Link>
              {canEdit && (
                <button onClick={() => removeItem(item.id)} aria-label="Remove">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}

      {canEdit && items.length > 0 && (
        <div className="px-5 mt-4">
          <button onClick={openPicker} className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Plus className="w-4 h-4" /> Add a shop
          </button>
        </div>
      )}

      {picking && (
        <div className="fixed inset-0 bg-background/95 flex flex-col p-5 z-50">
          <div className="flex items-center justify-between mb-4">
            <span className="font-semibold text-foreground">Add a shop</span>
            <button onClick={() => setPicking(false)}><X className="w-5 h-5 text-muted-foreground" /></button>
          </div>
          <div className="flex flex-col gap-2 overflow-y-auto">
            {allShops.map((shop) => (
              <button
                key={shop.id}
                onClick={() => addShop(shop)}
                className="text-left rounded-2xl border border-border bg-card p-3"
              >
                <div className="text-sm font-semibold text-foreground">{shop.name}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ListDetail;
