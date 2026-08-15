import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Wifi, Armchair, MapPin, DollarSign, Plug, Sun, KeyRound, Clock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { currentTimeBucket } from "@/lib/timeBucket";
import { track } from "@/lib/analytics";
import { api, type ShopDetail as ShopDetailData } from "@/lib/api";
import { INTENT_TAG_LABELS, NOISE_LABELS, CROWD_LABELS } from "@/types/cosign";
import EmptyState from "@/components/EmptyState";

const ShopDetail = () => {
  const { shopId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [data, setData] = useState<ShopDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!shopId) return;
    api
      .shop(shopId)
      .then((d) => {
        setData(d);
        track("shop_viewed", { shop_id: d.shop.id });
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [shopId]);

  const confirmFresh = async () => {
    if (!data) return;
    setConfirming(true);
    try {
      await api.verifyShop(data.shop.id);
      setData((prev) =>
        prev
          ? { ...prev, shop: { ...prev.shop, last_verified_at: new Date().toISOString(), stale: false } }
          : prev,
      );
      track("freshness_confirmed", { shop_id: data.shop.id });
    } finally {
      setConfirming(false);
    }
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
        icon={<MapPin className="w-6 h-6" />}
        title="Shop not found"
        description="This shop may have been removed, or the link is broken."
        action={
          <button onClick={() => navigate("/")} className="text-sm text-primary font-semibold">
            Back home
          </button>
        }
      />
    );
  }

  const { shop, photos, intent_tallies, conditions, cosigners } = data;
  const a = shop.amenities;
  const bucket = currentTimeBucket();
  const now = conditions[bucket];

  return (
    <div className="min-h-screen pb-10">
      <div className="flex items-center gap-3 px-5 py-4">
        <button onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
      </div>

      {photos.length > 0 && (
        <div className="flex gap-2 px-5 overflow-x-auto pb-2 no-scrollbar">
          {photos.map((p) => (
            <img key={p.id} src={p.path} alt={p.kind} className="w-40 h-28 object-cover rounded-2xl flex-shrink-0" />
          ))}
        </div>
      )}

      <div className="px-5 pt-2">
        <h1 className="text-2xl font-black text-foreground">{shop.name}</h1>
        {shop.one_liner && <p className="text-sm text-muted-foreground mt-1 italic">{shop.one_liner}</p>}
        <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1">
          <MapPin className="w-3.5 h-3.5" /> {shop.address} · {shop.walk_min} min walk
        </p>
        <p className="text-sm mt-1 flex items-center gap-1">
          <Clock className="w-3.5 h-3.5 text-primary" />
          <span className={shop.open_now ? "text-primary" : "text-muted-foreground"}>
            {shop.open_now ? "Open now" : "Closed right now"}
          </span>
        </p>

        {(shop.price_drip || shop.price_latte) && (
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
            <DollarSign className="w-3.5 h-3.5" />
            {shop.price_drip && `Drip $${shop.price_drip.toFixed(2)}`}
            {shop.price_drip && shop.price_latte && " · "}
            {shop.price_latte && `Latte $${shop.price_latte.toFixed(2)}`}
            {shop.student_discount && " · Student discount"}
          </p>
        )}

        {intent_tallies.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {intent_tallies.map((t) => (
              <span
                key={t.intent_tag}
                className="text-xs font-semibold px-3 py-1.5 rounded-full bg-accent text-accent-foreground"
              >
                {INTENT_TAG_LABELS[t.intent_tag]} · {t.tally}
              </span>
            ))}
          </div>
        )}

        {a && (
          <div className="grid grid-cols-2 gap-3 mt-5">
            <div className="rounded-2xl bg-card border border-border p-3 flex items-center gap-2">
              <Plug className="w-4 h-4 text-primary" />
              <span className="text-sm text-foreground">
                {a.outlet_count == null
                  ? "Outlets unknown"
                  : a.outlet_count === 0
                    ? "No outlets"
                    : `${a.outlet_count} outlets`}
              </span>
            </div>
            <div className="rounded-2xl bg-card border border-border p-3 flex items-center gap-2">
              <Wifi className="w-4 h-4 text-primary" />
              <span className="text-sm text-foreground">{a.wifi_mbps ? `${a.wifi_mbps} Mbps` : "No wifi"}</span>
            </div>
            <div className="rounded-2xl bg-card border border-border p-3 flex items-center gap-2">
              <Armchair className="w-4 h-4 text-primary" />
              <span className="text-sm text-foreground">
                {a.seat_count != null ? `${a.seat_count} seats` : "Seating unknown"}
              </span>
            </div>
            <div className="rounded-2xl bg-card border border-border p-3 flex items-center gap-2">
              {a.bathroom_access === "code" ? (
                <KeyRound className="w-4 h-4 text-primary" />
              ) : (
                <Sun className="w-4 h-4 text-primary" />
              )}
              <span className="text-sm text-foreground">
                {a.bathroom_access === "code" && a.bathroom_code
                  ? `Bathroom code ${a.bathroom_code}`
                  : a.natural_light
                    ? "Natural light"
                    : a.camp_ok
                      ? "Camp-friendly"
                      : "Quick stop"}
              </span>
            </div>
          </div>
        )}
        {a?.outlet_note && <p className="text-xs text-muted-foreground mt-2">{a.outlet_note}</p>}

        {now && (
          <div className="mt-4 text-sm text-muted-foreground">
            Usually around {bucket.replace("_", " ")}:{" "}
            {now.noise ? NOISE_LABELS[now.noise].toLowerCase() : "noise unknown"}
            {" · "}
            {now.crowd ? CROWD_LABELS[now.crowd].toLowerCase() : "crowd unknown"}
            <span className="text-xs"> ({now.samples} logs)</span>
          </div>
        )}

        {cosigners.total > 0 && (
          <div className="mt-5">
            <h2 className="text-sm font-semibold text-foreground mb-2">
              Cosigned by {cosigners.total}
            </h2>
            <div className="flex flex-wrap gap-2">
              {cosigners.cosigners.slice(0, 8).map((cs) => (
                <span
                  key={cs.user_id}
                  className={`text-xs px-3 py-1.5 rounded-full border ${
                    cs.is_friend ? "border-primary text-primary" : "border-border text-muted-foreground"
                  }`}
                >
                  {cs.display_name} · #{cs.position}
                </span>
              ))}
              {cosigners.others > 0 && (
                <span className="text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground">
                  {cosigners.cosigners.length > 0 ? `+${cosigners.others} more` : `${cosigners.others} people`}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="mt-6 rounded-2xl bg-muted p-4 flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {shop.last_verified_at
              ? `Last verified ${new Date(shop.last_verified_at).toLocaleDateString()}`
              : "Never verified"}
          </span>
          {shop.stale && user && (
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
