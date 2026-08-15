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
      // keep fields the CSV doesn't carry (photos, palette, timestamps)
      const prev = byId.get(shop.id)!;
      byId.set(shop.id, { ...prev, ...shop, photos: shop.photos?.length ? shop.photos : prev.photos });
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

const [, , mode, file, ...flags] = process.argv;
if (!file) die(`usage:\n  npm run import:shops -- <file.csv> [--dry-run]\n  npm run export:shops -- <file.csv>`);
if (mode === "export") exportShops(file);
else importShops(file, flags.includes("--dry-run"));
