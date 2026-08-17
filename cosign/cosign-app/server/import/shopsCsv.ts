// The founder's bulk-entry CSV (seed/IMPORT_FORMAT.md §1) ↔ shops.json
// entries. Lossless both ways: the free-text student_discount column is
// preserved in student_discount_note, and the compact hours syntax round-
// trips through parse/format.

import { formatHoursSyntax, parseHoursSyntax, type HoursEntry } from "./hoursSyntax.ts";

export const CSV_HEADER =
  "id,slug,name,address,lat,lng,price_drip,price_latte,student_discount,hours,outlet_count,outlet_note,seat_count,table_size,wifi_mbps,bathroom_access,bathroom_code,natural_light,camp_ok,one_liner";

export interface CsvShop {
  id: string;
  slug: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  school: string;
  price_drip: number | null;
  price_latte: number | null;
  student_discount: boolean;
  student_discount_note: string | null;
  hours: HoursEntry[];
  amenities: {
    outlet_count: number | null;
    outlet_note: string | null;
    seat_count: number | null;
    table_size: string | null;
    wifi_mbps: number | null;
    wifi_note: string | null;
    bathroom_access: string | null;
    bathroom_code: string | null;
    natural_light: boolean;
    camp_ok: boolean;
    camp_note: string | null;
  };
  one_liner: string | null;
  palette: string;
  photos: string[];
}

/** RFC-4180-ish CSV line splitting with quoted fields. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function csvField(v: string | number | boolean | null): string {
  if (v === null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const TABLE_SIZES = ["laptop", "laptop_plus_friend", "mug_only"];
const BATHROOM = ["open", "code", "customer_only"];

export function parseShopsCsv(text: string): CsvShop[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (lines[0].trim() !== CSV_HEADER) {
    throw new Error(`shops.csv: header must be exactly:\n${CSV_HEADER}`);
  }
  return lines.slice(1).map((line, i) => {
    const row = i + 2; // 1-based, after header
    const f = splitCsvLine(line);
    if (f.length !== 20) throw new Error(`shops.csv row ${row}: expected 20 columns, got ${f.length}`);
    const [
      id, slug, name, address, lat, lng, priceDrip, priceLatte, discount, hours,
      outletCount, outletNote, seatCount, tableSize, wifiMbps, bathroomAccess,
      bathroomCode, naturalLight, campOk, oneLiner,
    ] = f;
    if (!id.startsWith("s_")) throw new Error(`shops.csv row ${row}: id must start with s_`);
    if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`shops.csv row ${row}: bad slug "${slug}"`);
    if (tableSize && !TABLE_SIZES.includes(tableSize)) {
      throw new Error(`shops.csv row ${row}: table_size must be one of ${TABLE_SIZES.join(", ")} (got "${tableSize}")`);
    }
    if (bathroomAccess && !BATHROOM.includes(bathroomAccess)) {
      throw new Error(`shops.csv row ${row}: bathroom_access must be one of ${BATHROOM.join(", ")} (got "${bathroomAccess}")`);
    }
    const bool = (v: string, col: string): boolean => {
      if (v !== "true" && v !== "false") throw new Error(`shops.csv row ${row}: ${col} must be true or false (got "${v}")`);
      return v === "true";
    };
    const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));
    return {
      id,
      slug,
      name,
      address,
      lat: Number(lat),
      lng: Number(lng),
      school: "osu",
      price_drip: num(priceDrip),
      price_latte: num(priceLatte),
      student_discount: discount.trim() !== "",
      // A bare "yes" is not a note. It is what serializeShopsCsv writes for a
      // discount nobody has written terms for, and what a founder types in a
      // column headed `student_discount` when there is nothing more to say.
      // Read back as note text it reaches the shop page — ShopDetail renders
      // `student_discount_note || "student discount"` — so an export and a
      // re-import would replace "student discount" with the word "yes" on
      // every one of the six shops that have a discount and no terms.
      student_discount_note: /^(|yes)$/i.test(discount.trim()) ? null : discount,
      hours: parseHoursSyntax(hours),
      amenities: {
        outlet_count: num(outletCount),
        outlet_note: outletNote || null,
        seat_count: num(seatCount),
        table_size: tableSize || null,
        wifi_mbps: num(wifiMbps),
        wifi_note: null,
        bathroom_access: bathroomAccess || null,
        bathroom_code: bathroomCode || null,
        natural_light: bool(naturalLight, "natural_light"),
        camp_ok: bool(campOk, "camp_ok"),
        camp_note: null,
      },
      one_liner: oneLiner || null,
      palette: "warm",
      photos: [],
    };
  });
}

export function serializeShopsCsv(shops: CsvShop[]): string {
  const rows = shops.map((s) =>
    [
      csvField(s.id),
      csvField(s.slug),
      csvField(s.name),
      csvField(s.address),
      csvField(s.lat),
      csvField(s.lng),
      csvField(s.price_drip),
      csvField(s.price_latte),
      csvField(s.student_discount_note ?? (s.student_discount ? "yes" : null)),
      csvField(formatHoursSyntax(s.hours)),
      csvField(s.amenities.outlet_count),
      csvField(s.amenities.outlet_note),
      csvField(s.amenities.seat_count),
      csvField(s.amenities.table_size),
      csvField(s.amenities.wifi_mbps),
      csvField(s.amenities.bathroom_access),
      csvField(s.amenities.bathroom_code),
      csvField(s.amenities.natural_light),
      csvField(s.amenities.camp_ok),
      csvField(s.one_liner),
    ].join(","),
  );
  return [CSV_HEADER, ...rows].join("\n") + "\n";
}
