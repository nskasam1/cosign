import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import PlaceSearch, { Place } from "@/components/PlaceSearch";
import { INTENT_TAG_LABELS } from "@/types/cosign";
import type { IntentTag, TimeBucket, TableSize, BathroomAccess } from "@/types/cosign";
import EmptyState from "@/components/EmptyState";
import { Lock } from "lucide-react";
import { toast } from "sonner";

const OSU_SLUG = "osu";

// Phase 8 — internal seeding tool for the ~30-shop launch weekend. Not
// meant to be pretty, meant to make one shop's worth of fieldwork data
// entry (identity + amenities + one snapshot + 3 photos + intent tags)
// fast. Gated to VITE_ADMIN_EMAIL, set once the owner account exists.
const AdminSeed = () => {
  const { user } = useAuth();
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL;
  const isOwner = adminEmail && user?.email === adminEmail;

  const [place, setPlace] = useState<Place | null>(null);
  const [priceDrip, setPriceDrip] = useState("");
  const [priceLatte, setPriceLatte] = useState("");
  const [studentDiscount, setStudentDiscount] = useState(false);

  const [outletCount, setOutletCount] = useState("");
  const [seatCount, setSeatCount] = useState("");
  const [laptopSeats, setLaptopSeats] = useState("");
  const [tableSize, setTableSize] = useState<TableSize | "">("");
  const [wifiSpeed, setWifiSpeed] = useState("");
  const [bathroomAccess, setBathroomAccess] = useState<BathroomAccess | "">("");
  const [naturalLight, setNaturalLight] = useState(false);

  const [timeBucket, setTimeBucket] = useState<TimeBucket>("afternoon");
  const [noise, setNoise] = useState("2");
  const [crowding, setCrowding] = useState("2");
  const [honestNote, setHonestNote] = useState("");

  const [photos, setPhotos] = useState<File[]>([]);
  const [tags, setTags] = useState<Set<IntentTag>>(new Set());
  const [saving, setSaving] = useState(false);

  if (!isOwner) {
    return (
      <EmptyState
        icon={<Lock className="w-6 h-6" />}
        title="Owner-only"
        description="This seeding tool is gated to the owner account (VITE_ADMIN_EMAIL)."
      />
    );
  }

  const submit = async () => {
    if (!place || photos.length < 3) {
      toast.error("Need a place and at least 3 photos.");
      return;
    }
    setSaving(true);
    try {
      const { data: school } = await supabase.from("schools").select("id").eq("slug", OSU_SLUG).single();

      const { data: shop, error: shopError } = await supabase
        .from("shops")
        .insert({
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          school_id: school!.id,
          price_drip: priceDrip ? Number(priceDrip) : null,
          price_latte: priceLatte ? Number(priceLatte) : null,
          has_student_discount: studentDiscount,
        })
        .select()
        .single();
      if (shopError || !shop) throw shopError;

      await supabase.from("shop_amenities").insert({
        shop_id: shop.id,
        outlet_count: outletCount ? Number(outletCount) : null,
        seat_count: seatCount ? Number(seatCount) : null,
        laptop_viable_seats: laptopSeats ? Number(laptopSeats) : null,
        table_size: tableSize || null,
        wifi_speed_mbps: wifiSpeed ? Number(wifiSpeed) : null,
        bathroom_access: bathroomAccess || null,
        has_natural_light: naturalLight,
      });

      await supabase.from("shop_snapshots").insert({
        shop_id: shop.id,
        time_bucket: timeBucket,
        noise_level: Number(noise),
        crowding: Number(crowding),
        honest_note: honestNote || null,
        recorded_by: user!.id,
      });

      for (const [i, file] of photos.entries()) {
        const path = `${shop.id}/${i}-${file.name}`;
        await supabase.storage.from("photos").upload(path, file, { upsert: true });
        const { data: pub } = supabase.storage.from("photos").getPublicUrl(path);
        await supabase.from("shop_photos").insert({
          shop_id: shop.id,
          url: pub.publicUrl,
          type: i === 0 ? "room" : i === 1 ? "best_seat" : "counter",
          uploaded_by: user!.id,
        });
      }

      if (tags.size > 0) {
        await supabase.from("shop_intent_tag_votes").insert(
          Array.from(tags).map((intent_tag) => ({ shop_id: shop.id, user_id: user!.id, intent_tag }))
        );
      }

      toast.success(`${shop.name} seeded.`);
      setPlace(null);
      setPhotos([]);
      setTags(new Set());
    } catch (err) {
      console.error("[Cosign admin-seed] failed:", err);
      toast.error("Seeding failed — check console.");
    } finally {
      setSaving(false);
    }
  };

  const toggleTag = (tag: IntentTag) => {
    setTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  return (
    <div className="min-h-screen px-6 py-8 max-w-lg mx-auto flex flex-col gap-6">
      <h1 className="text-2xl font-black text-foreground">Seed a shop</h1>

      <section className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-muted-foreground uppercase">Place</label>
        <PlaceSearch selectedPlace={place} onSelect={setPlace} />
        <div className="flex gap-2">
          <input placeholder="Drip price" value={priceDrip} onChange={(e) => setPriceDrip(e.target.value)}
            className="flex-1 bg-card border border-border rounded-xl px-3 py-2 text-sm" />
          <input placeholder="Latte price" value={priceLatte} onChange={(e) => setPriceLatte(e.target.value)}
            className="flex-1 bg-card border border-border rounded-xl px-3 py-2 text-sm" />
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={studentDiscount} onChange={(e) => setStudentDiscount(e.target.checked)} />
          Student discount
        </label>
      </section>

      <section className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-muted-foreground uppercase">Amenities</label>
        <div className="grid grid-cols-2 gap-2">
          <input placeholder="Outlet count" value={outletCount} onChange={(e) => setOutletCount(e.target.value)} className="bg-card border border-border rounded-xl px-3 py-2 text-sm" />
          <input placeholder="Seat count" value={seatCount} onChange={(e) => setSeatCount(e.target.value)} className="bg-card border border-border rounded-xl px-3 py-2 text-sm" />
          <input placeholder="Laptop-viable seats" value={laptopSeats} onChange={(e) => setLaptopSeats(e.target.value)} className="bg-card border border-border rounded-xl px-3 py-2 text-sm" />
          <input placeholder="Wifi Mbps" value={wifiSpeed} onChange={(e) => setWifiSpeed(e.target.value)} className="bg-card border border-border rounded-xl px-3 py-2 text-sm" />
          <select value={tableSize} onChange={(e) => setTableSize(e.target.value as TableSize)} className="bg-card border border-border rounded-xl px-3 py-2 text-sm">
            <option value="">Table size…</option>
            <option value="laptop">Laptop only</option>
            <option value="laptop_plus_friend">Laptop + friend</option>
            <option value="mug_only">Mug only</option>
          </select>
          <select value={bathroomAccess} onChange={(e) => setBathroomAccess(e.target.value as BathroomAccess)} className="bg-card border border-border rounded-xl px-3 py-2 text-sm">
            <option value="">Bathroom access…</option>
            <option value="open">Open</option>
            <option value="code">Code</option>
            <option value="customer_only">Customer only</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={naturalLight} onChange={(e) => setNaturalLight(e.target.checked)} />
          Natural light
        </label>
      </section>

      <section className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-muted-foreground uppercase">Snapshot (right now)</label>
        <select value={timeBucket} onChange={(e) => setTimeBucket(e.target.value as TimeBucket)} className="bg-card border border-border rounded-xl px-3 py-2 text-sm">
          <option value="morning">Morning</option>
          <option value="afternoon">Afternoon</option>
          <option value="evening">Evening</option>
          <option value="late_night">Late night</option>
        </select>
        <div className="flex gap-2">
          <input type="number" min={1} max={3} placeholder="Noise 1-3" value={noise} onChange={(e) => setNoise(e.target.value)} className="flex-1 bg-card border border-border rounded-xl px-3 py-2 text-sm" />
          <input type="number" min={1} max={3} placeholder="Crowding 1-3" value={crowding} onChange={(e) => setCrowding(e.target.value)} className="flex-1 bg-card border border-border rounded-xl px-3 py-2 text-sm" />
        </div>
        <input placeholder="One honest line (optional)" value={honestNote} onChange={(e) => setHonestNote(e.target.value)} className="bg-card border border-border rounded-xl px-3 py-2 text-sm" />
      </section>

      <section className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-muted-foreground uppercase">Photos (3 required: room, best seat, counter)</label>
        <input type="file" accept="image/*" multiple onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 3))} />
        <span className="text-xs text-muted-foreground">{photos.length}/3 selected</span>
      </section>

      <section className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-muted-foreground uppercase">Good for</label>
        <div className="flex flex-wrap gap-2">
          {Object.entries(INTENT_TAG_LABELS).map(([tag, label]) => (
            <button
              key={tag}
              onClick={() => toggleTag(tag as IntentTag)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full ${
                tags.has(tag as IntentTag) ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <button
        onClick={submit}
        disabled={saving}
        className="bg-primary text-primary-foreground rounded-2xl py-3 font-semibold disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save shop"}
      </button>
    </div>
  );
};

export default AdminSeed;
