// The command behind seed/IMPORT_FORMAT.md §1 — the founder's bulk-entry
// CSV becomes seed/shops.json, and back out again so a spreadsheet round
// trip never loses a field.
//
//   npm run import:shops -- path/to/shops.csv        merge into seed/shops.json
//   npm run import:shops -- path/to/shops.csv --dry-run
//   npm run export:shops -- path/to/shops.csv        write current shops as CSV
//
// Merge is by shop id: an existing id is updated in place, a new one is
// appended. Nothing is deleted — dropping a row from the CSV never silently
// removes a shop that is already out there.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { APP_ROOT } from "../db/db.ts";
import { CSV_HEADER, parseShopsCsv, serializeShopsCsv, type CsvShop } from "./shopsCsv.ts";

const SHOPS_JSON = join(APP_ROOT, "seed", "shops.json");

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function readShopsJson(): CsvShop[] {
  return JSON.parse(readFileSync(SHOPS_JSON, "utf-8")) as CsvShop[];
}

/**
 * The sheet has twenty columns and a shop has more, so `parseShopsCsv` has to
 * invent a value for every field the sheet cannot carry: `wifi_note: null`,
 * `camp_note: null`, `palette: "warm"`, `school: "osu"`, `photos: []`. A plain
 * `{ ...prev, ...incoming }` then writes those inventions over the real data —
 * which is exactly the round trip IMPORT_FORMAT.md §5 promises is lossless, so
 * the founder's own backup was the thing that destroyed the notes. Measured on
 * the committed seed before this was fixed: 22 wifi_notes, 22 camp_notes and
 * 18 palettes gone in one `export:shops` → `import:shops`.
 *
 * A CSV can never MEAN "clear the wifi note" — it has no column for one — so
 * an uncarried field always comes from the row we already had.
 */
export function mergeShop(prev: CsvShop, incoming: CsvShop): CsvShop {
  return {
    ...prev,
    ...incoming,
    school: prev.school ?? incoming.school,
    palette: prev.palette ?? incoming.palette,
    photos: incoming.photos?.length ? incoming.photos : prev.photos,
    amenities: {
      ...prev.amenities,
      ...incoming.amenities,
      wifi_note: prev.amenities?.wifi_note ?? incoming.amenities?.wifi_note ?? null,
      camp_note: prev.amenities?.camp_note ?? incoming.amenities?.camp_note ?? null,
    },
  };
}

export function importShops(csvPath: string, dryRun = false): void {
  let text: string;
  try {
    text = readFileSync(csvPath, "utf-8");
  } catch {
    die(`can't read ${csvPath}`);
  }

  let incoming: CsvShop[];
  try {
    incoming = parseShopsCsv(text);
  } catch (e) {
    die(`${csvPath}: ${e instanceof Error ? e.message : e}\n\nExpected header:\n${CSV_HEADER}`);
  }

  const existing = readShopsJson();
  const byId = new Map(existing.map((s) => [s.id, s]));
  const added: string[] = [];
  const updated: string[] = [];

  for (const shop of incoming) {
    if (byId.has(shop.id)) {
      byId.set(shop.id, mergeShop(byId.get(shop.id)!, shop));
      updated.push(shop.id);
    } else {
      byId.set(shop.id, shop);
      added.push(shop.id);
    }
  }

  const merged = [...byId.values()];
  console.log(`${csvPath}: ${incoming.length} rows`);
  console.log(`  added   ${added.length}${added.length ? `: ${added.join(", ")}` : ""}`);
  console.log(`  updated ${updated.length}${updated.length ? `: ${updated.join(", ")}` : ""}`);
  console.log(`  shops.json: ${existing.length} -> ${merged.length}`);

  if (dryRun) {
    console.log("\n--dry-run: nothing written. Drop the flag to apply, then `npm run seed`.");
    return;
  }
  writeFileSync(SHOPS_JSON, JSON.stringify(merged, null, 1) + "\n", "utf-8");
  console.log(`\nwrote ${SHOPS_JSON} — run \`npm run seed\` to rebuild the database.`);
}

export function exportShops(csvPath: string): void {
  const shops = readShopsJson();
  writeFileSync(csvPath, serializeShopsCsv(shops), "utf-8");
  console.log(`wrote ${csvPath} (${shops.length} shops)`);
}

// Only run the CLI when this file IS the command — importing it must not
// execute it. `mergeShop` is the round-trip guarantee's one piece of logic
// and the test has to be able to import it; before this guard, doing so ran
// `die()` on the test runner's argv and killed the file with
// "process.exit unexpectedly called with 1". Same rule as server/index.ts,
// which only binds :8787 when it is the entry module.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [, , mode, file, ...flags] = process.argv;
  if (!file) die(`usage:\n  npm run import:shops -- <file.csv> [--dry-run]\n  npm run export:shops -- <file.csv>`);
  if (mode === "export") exportShops(file);
  else importShops(file, flags.includes("--dry-run"));
}
