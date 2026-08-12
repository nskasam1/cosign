import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Wifi, Armchair, MapPin, DollarSign } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { currentTimeBucket, isStale } from "@/lib/timeBucket";
import { track } from "@/lib/analytics";
import { INTENT_TAG_LABELS } from "@/types/cosign";
import type { Shop, ShopSnapshot, ShopAmenities, ShopPhoto, ShopIntentTagTally } from "@/types/cosign";
import EmptyState from "@/components/EmptyState";

const ShopDetail = () => {
  const { shopId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [shop, setShop] = useState<Shop | null>(null);
  const [snapshot, setSnapshot] = useState<ShopSnapshot | null>(null);
  const [amenities, setAmenities] = useState<ShopAmenities | null>(null);
  const [photos, setPhotos] = useState<ShopPhoto[]>([]);
  const [tags, setTags] = useState<ShopIntentTagTally[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!shopId) return;
    (async () => {
      const bucket = currentTimeBucket();
      const [shopRes, snapshotRes, amenitiesRes, photosRes, tagsRes] = await Promise.all([
        supabase.from("shops").select("*").eq("id", shopId).single(),
        supabase
          .from("shop_snapshots")
          .select("*")
          .eq("shop_id", shopId)
          .eq("time_bucket", bucket)
          .order("recorded_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from("shop_amenities").select("*").eq("shop_id", shopId).maybeSingle(),
        supabase.from("shop_photos").select("*").eq("shop_id", shopId),
        supabase.from("shop_intent_tag_tallies").select("*").eq("shop_id", shopId),
      ]);
      setShop((shopRes.data as Shop) ?? null);
      setSnapshot((snapshotRes.data as ShopSnapshot) ?? null);
      setAmenities((amenitiesRes.data as ShopAmenities) ?? null);
      setPhotos((photosRes.data as ShopPhoto[]) ?? []);
      setTags((tagsRes.data as ShopIntentTagTally[]) ?? []);
      setLoading(false);
      track("shop_viewed", { shop_id: shopId });
    })();
  }, [shopId]);

  const confirmFresh = async () => {
    if (!shopId) return;
    setConfirming(true);
    await supabase.rpc("confirm_shop_freshness", { p_shop_id: shopId });
    setShop((prev) => (prev ? { ...prev, last_verified_at: new Date().toISOString() } : prev));
    track("freshness_confirmed", { shop_id: shopId });
    setConfirming(false);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-screen">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>;
  }

  if (!shop) {
    return (
      <EmptyState
        icon={<MapPin className="w-6 h-6" />}
        title="Shop not found"
        description="This shop may have been removed, or the link is broken."
        action={<button onClick={() => navigate("/")} className="text-sm text-primary font-semibold">Back home</button>}
      />
    );
  }

  const stale = isStale(shop.last_verified_at);
  const sortedTags = [...tags].sort((a, b) => b.tally - a.tally);

  return (
    <div className="min-h-screen pb-10">
      <div className="flex items-center gap-3 px-5 py-4">
        <button onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
      </div>

      {photos.length > 0 && (
        <div className="flex gap-2 px-5 overflow-x-auto pb-2">
          {photos.map((p) => (
            <img key={p.id} src={p.url} alt={p.type} className="w-40 h-28 object-cover rounded-2xl flex-shrink-0" />
          ))}
        </div>
      )}

      <div className="px-5 pt-2">
        <h1 className="text-2xl font-black text-foreground">{shop.name}</h1>
        <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1">
          <MapPin className="w-3.5 h-3.5" /> {shop.address}
        </p>

        {(shop.price_drip || shop.price_latte) && (
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
            <DollarSign className="w-3.5 h-3.5" />
            {shop.price_drip && `Drip $${shop.price_drip.toFixed(2)}`}
            {shop.price_drip && shop.price_latte && " · "}
            {shop.price_latte && `Latte $${shop.price_latte.toFixed(2)}`}
            {shop.has_student_discount && " · Student discount"}
          </p>
        )}

        {sortedTags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {sortedTags.map((t) => (
              <span key={t.intent_tag} className="text-xs font-semibold px-3 py-1.5 rounded-full bg-accent text-accent-foreground">
                {INTENT_TAG_LABELS[t.intent_tag]} · {t.tally}
              </span>
            ))}
          </div>
        )}

        {amenities && (
          <div className="grid grid-cols-2 gap-3 mt-5">
            <div className="rounded-2xl bg-card border border-border p-3 flex items-center gap-2">
              <Wifi className="w-4 h-4 text-primary" />
              <span className="text-sm text-foreground">
                {amenities.wifi_speed_mbps ? `${amenities.wifi_speed_mbps} Mbps` : "Wifi unknown"}
              </span>
            </div>
            <div className="rounded-2xl bg-card border border-border p-3 flex items-center gap-2">
              <Armchair className="w-4 h-4 text-primary" />
              <span className="text-sm text-foreground">
                {amenities.laptop_viable_seats != null ? `${amenities.laptop_viable_seats} laptop seats` : "Seating unknown"}
              </span>
            </div>
          </div>
        )}

        {snapshot && (
          <div className="mt-4 text-sm text-muted-foreground">
            Right now ({snapshot.time_bucket.replace("_", " ")}): noise {snapshot.noise_level ?? "?"}/3, crowding {snapshot.crowding ?? "?"}/3
            {snapshot.camp_ability != null && (snapshot.camp_ability ? " · camping is fine" : " · not great for camping out")}
          </div>
        )}

        <div className="mt-6 rounded-2xl bg-muted p-4 flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {shop.last_verified_at
              ? `Last verified ${new Date(shop.last_verified_at).toLocaleDateString()}`
              : "Never verified"}
          </span>
          {stale && user && (
            <button
              onClick={confirmFresh}
              disabled={confirming}
              className="text-sm font-semibold text-primary whitespace-nowrap disabled:opacity-50"
            >
              {confirming ? "Confirming…" : "Still accurate?"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShopDetail;
