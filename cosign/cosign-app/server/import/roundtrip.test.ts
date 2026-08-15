// @vitest-environment node
// The round-trip guarantee (IMPORT_FORMAT.md §4): seed → export → seed →
// export must be a fixpoint, and the founder CSV must survive
// parse → serialize → parse untouched.

import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDb } from "../db/db";
import { runSeed, DEFAULT_SEED_DIR } from "../db/seed";
import { exportSeed, writeSeedDir } from "./export";
import { formatHoursSyntax, parseHoursSyntax } from "./hoursSyntax";
import { parseShopsCsv, serializeShopsCsv, CSV_HEADER } from "./shopsCsv";

const dir = mkdtempSync(join(tmpdir(), "cosign-roundtrip-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("compact hours syntax", () => {
  it("parses the documented example", () => {
    expect(parseHoursSyntax("Mo-Fr 07:00-21:00; Sa-Su 08:00-22:00")).toEqual([
      { days: [1, 2, 3, 4, 5], open: "07:00", close: "21:00" },
      { days: [6, 0], open: "08:00", close: "22:00" },
    ]);
  });

  it("handles closed days, split days, overnight, and 24h", () => {
    expect(parseHoursSyntax("Su closed")).toEqual([]);
    expect(parseHoursSyntax("Mo-Fr 07:00-11:30, 15:00-21:00")).toHaveLength(2);
    expect(parseHoursSyntax("Fr-Sa 08:00-02:00")).toEqual([{ days: [5, 6], open: "08:00", close: "02:00" }]);
    expect(parseHoursSyntax("Th-Su 00:00-24:00")).toEqual([{ days: [4, 5, 6, 0], open: "00:00", close: "24:00" }]);
  });

  it("rejects bad values", () => {
    expect(() => parseHoursSyntax("Xx 09:00-17:00")).toThrow();
    expect(() => parseHoursSyntax("Mo 25:00-26:00")).toThrow();
  });

  it("format → parse is identity on parsed input", () => {
    const cases = [
      "Mo-Fr 07:00-21:00; Sa-Su 08:00-22:00",
      "Mo-We 07:00-01:00; Th-Su 00:00-24:00",
      "Tu-Sa 10:00-14:30",
    ];
    for (const c of cases) {
      const parsed = parseHoursSyntax(c);
      expect(parseHoursSyntax(formatHoursSyntax(parsed))).toEqual(parsed);
    }
  });
});

describe("founder shops CSV", () => {
  const exampleRow = `s_wheelhouse,wheelhouse,Wheelhouse Coffee,"2044 N High St, Columbus, OH 43201",40.0002,-83.0091,2.75,4.50,10% with BuckID,Mo-Fr 07:00-21:00; Sa-Su 08:00-22:00,14,most along the back wall,38,laptop,180,code,1889#,true,true,"The back room is the best free coworking space on campus, and the drip is $2.75."`;

  it("parses the documented example row", () => {
    const [shop] = parseShopsCsv(`${CSV_HEADER}\n${exampleRow}\n`);
    expect(shop.id).toBe("s_wheelhouse");
    expect(shop.address).toBe("2044 N High St, Columbus, OH 43201");
    expect(shop.student_discount).toBe(true);
    expect(shop.student_discount_note).toBe("10% with BuckID");
    expect(shop.hours).toHaveLength(2);
    expect(shop.amenities.bathroom_code).toBe("1889#");
    expect(shop.amenities.natural_light).toBe(true);
  });

  it("round-trips parse → serialize → parse", () => {
    const once = parseShopsCsv(`${CSV_HEADER}\n${exampleRow}\n`);
    const twice = parseShopsCsv(serializeShopsCsv(once));
    expect(twice).toEqual(once);
  });

  it("rejects bad enums with the row number", () => {
    const bad = exampleRow.replace(",laptop,", ",huge,");
    expect(() => parseShopsCsv(`${CSV_HEADER}\n${bad}\n`)).toThrow(/row 2/);
  });
});

describe("full seed round trip", () => {
  it("seed → export → seed → export is a fixpoint", () => {
    const db1Path = join(dir, "one.db");
    runSeed(db1Path, DEFAULT_SEED_DIR);
    const db1 = openDb(db1Path);
    const export1 = exportSeed(db1);
    db1.close();

    const exportDir = join(dir, "exported-seed");
    writeSeedDir(export1, exportDir, join(DEFAULT_SEED_DIR, "academic-calendar.json"));

    const db2Path = join(dir, "two.db");
    runSeed(db2Path, exportDir);
    const db2 = openDb(db2Path);
    const export2 = exportSeed(db2);
    db2.close();

    expect(export2).toEqual(export1);
  });

  it("export matches the authored seed's core facts", () => {
    const dbPath = join(dir, "three.db");
    runSeed(dbPath, DEFAULT_SEED_DIR);
    const db = openDb(dbPath);
    const exported = exportSeed(db);
    db.close();

    const authoredShops = JSON.parse(readFileSync(join(DEFAULT_SEED_DIR, "shops.json"), "utf-8"));
    const authoredRankings = JSON.parse(readFileSync(join(DEFAULT_SEED_DIR, "rankings.json"), "utf-8"));
    expect(exported.shops).toHaveLength(authoredShops.length);
    // every user's exported final order equals the authored final order —
    // i.e. binary-search replay reproduced the intended rankings exactly
    expect(
      Object.fromEntries(Object.entries(exported.rankings).map(([u, r]) => [u, r.final])),
    ).toEqual(Object.fromEntries(Object.entries(authoredRankings).map(([u, r]) => [u, (r as { final: string[] }).final])));
  });
});
