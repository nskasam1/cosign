// @vitest-environment node
//
// The ≤ 8 tap budget (decision 4) is only real if the discretionary questions
// can't multiply, so the cap is proved exhaustively against every amenity row
// the product actually ships rather than against a hand-picked few.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CROWD_LEVELS,
  INTENT_TAGS,
  LOG_TAP_KEYS,
  type CrowdLevel,
  type ShopAmenities,
} from "@/types/cosign";
import {
  comparisonBound,
  confirmationsFor,
  emptyDraft,
  firstIncompleteStep,
  LOG_STEPS,
  stepAllowed,
  type LogDraft,
  type LogStep,
} from "./logFlow";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface SeedShop {
  id: string;
  name: string;
  amenities: Record<string, unknown>;
}

const SHOPS = JSON.parse(readFileSync(join(APP, "seed", "shops.json"), "utf-8")) as SeedShop[];

/** Seed rows carry the amenity facts but not the DB's shop_id/updated_at
 *  columns, and confirmationsFor reads only the facts. */
function amenities(shopId: string): ShopAmenities {
  const shop = SHOPS.find((s) => s.id === shopId);
  if (!shop) throw new Error(`no seeded shop ${shopId}`);
  return { ...shop.amenities } as unknown as ShopAmenities;
}

/** The crowd answers the flow can hold: the three enum values plus "didn't
 *  notice", which is a real answer and arrives as null. */
const CROWD_ANSWERS: Array<CrowdLevel | null> = [...CROWD_LEVELS, null];

describe("confirmationsFor", () => {
  it("never asks more than two, across every intent × crowd × seeded shop", () => {
    let combinations = 0;
    const rows: Array<ShopAmenities | null> = [...SHOPS.map((s) => amenities(s.id)), null];
    for (const intent of INTENT_TAGS) {
      for (const crowd of CROWD_ANSWERS) {
        for (const row of rows) {
          const asks = confirmationsFor(intent, crowd, row);
          combinations++;
          expect(asks.length).toBeLessThanOrEqual(2);
          expect(new Set(asks).size).toBe(asks.length);
          for (const key of asks) expect(LOG_TAP_KEYS).toContain(key);
        }
      }
    }
    expect(combinations).toBe(INTENT_TAGS.length * CROWD_ANSWERS.length * (SHOPS.length + 1));
  });

  it("drops the third and fourth question when all four qualify", () => {
    // Wheelhouse has outlets, wifi and camp_ok; packed adds got_a_table.
    expect(confirmationsFor("deep_work", "packed", amenities("s_wheelhouse"))).toEqual([
      "found_outlet",
      "wifi_held_up",
    ]);
  });

  it("asks found_outlet only for plug-in intents at a shop with outlets", () => {
    expect(confirmationsFor("killing_time", null, amenities("s_wheelhouse"))).toContain(
      "found_outlet",
    );
    // right intent, no outlets to find (Terrazzo has none)
    expect(confirmationsFor("deep_work", null, amenities("s_terrazzo"))).not.toContain(
      "found_outlet",
    );
    // outlets, but nobody plugs in on a first date
    expect(confirmationsFor("first_date", null, amenities("s_wheelhouse"))).not.toContain(
      "found_outlet",
    );
  });

  it("asks wifi_held_up only for laptop intents where wifi exists", () => {
    expect(confirmationsFor("reading", null, amenities("s_wheelhouse"))).toContain("wifi_held_up");
    // Marginalia is the seeded no-wifi shop
    expect(confirmationsFor("reading", null, amenities("s_marginalia"))).not.toContain(
      "wifi_held_up",
    );
    // wifi is there; killing_time isn't a laptop intent (it still gets outlets)
    expect(confirmationsFor("killing_time", null, amenities("s_wheelhouse"))).not.toContain(
      "wifi_held_up",
    );
  });

  it("asks got_a_table only when the room was not empty", () => {
    expect(confirmationsFor("quick_grab", "comfortable", amenities("s_percolate"))).toEqual([
      "got_a_table",
    ]);
    expect(confirmationsFor("quick_grab", "packed", amenities("s_percolate"))).toEqual([
      "got_a_table",
    ]);
    expect(confirmationsFor("quick_grab", "empty", amenities("s_percolate"))).toEqual([]);
  });

  it("never asks got_a_table for an empty room or an unanswered one", () => {
    for (const intent of INTENT_TAGS) {
      for (const crowd of ["empty", null] as Array<CrowdLevel | null>) {
        for (const shop of SHOPS) {
          expect(confirmationsFor(intent, crowd, amenities(shop.id))).not.toContain("got_a_table");
        }
        expect(confirmationsFor(intent, crowd, null)).not.toContain("got_a_table");
      }
    }
  });

  it("asks would_camp only for long-stay intents where camping is ok", () => {
    // Marginalia: camp_ok, no wifi — would_camp rides along with found_outlet
    expect(confirmationsFor("late_night", null, amenities("s_marginalia"))).toEqual([
      "found_outlet",
      "would_camp",
    ]);
    // camp_ok, but a first date is not a four-hour stay
    expect(confirmationsFor("first_date", null, amenities("s_marginalia"))).not.toContain(
      "would_camp",
    );
    // long-stay intent, but Terrazzo turns tables
    expect(confirmationsFor("deep_work", null, amenities("s_terrazzo"))).not.toContain("would_camp");
  });

  it("asks nothing for a quick grab with no outlets and no wifi", () => {
    // No seeded shop is both outlet-less and wifi-less (Percolate is closest:
    // no outlets, 12 Mbps), so the row is built rather than looked up.
    const bare = { outlet_count: 0, wifi_mbps: null, camp_ok: false } as unknown as ShopAmenities;
    expect(confirmationsFor("quick_grab", null, bare)).toEqual([]);
    expect(confirmationsFor("quick_grab", "empty", bare)).toEqual([]);
    expect(confirmationsFor("quick_grab", null, amenities("s_percolate"))).toEqual([]);
  });

  it("asks nothing when the shop's amenities are unknown", () => {
    expect(confirmationsFor("deep_work", null, null)).toEqual([]);
    expect(confirmationsFor(null, null, null)).toEqual([]);
  });
});

describe("comparisonBound", () => {
  it("is ceil(log2(n+1)) at the sizes the flow shows", () => {
    expect(comparisonBound(0)).toBe(0);
    expect(comparisonBound(1)).toBe(1);
    expect(comparisonBound(6)).toBe(3); // u_lena's seeded ranking
    expect(comparisonBound(8)).toBe(4);
    expect(comparisonBound(22)).toBe(5); // every seeded shop
  });
});

describe("the step chain", () => {
  const draftAt = (step: LogStep): LogDraft => {
    const d = emptyDraft();
    if (step === "where") return d;
    d.shopId = "s_wheelhouse";
    if (step === "why") return d;
    d.intent = "deep_work";
    if (step === "noise") return d;
    d.noise = "quiet";
    d.noiseAnswered = true;
    if (step === "crowd") return d;
    d.crowd = "comfortable";
    d.crowdAnswered = true;
    return d;
  };

  it("lists the chain without the extras branch", () => {
    expect(LOG_STEPS).toEqual(["where", "why", "noise", "crowd", "review"]);
  });

  it("starts empty", () => {
    expect(emptyDraft()).toEqual({
      shopId: null,
      intent: null,
      noise: null,
      crowd: null,
      noiseAnswered: false,
      crowdAnswered: false,
      taps: {},
      line: "",
      photo: null,
    });
    expect(emptyDraft("s_foundry").shopId).toBe("s_foundry");
  });

  it("opens each step only once its prerequisites are answered", () => {
    const all: LogStep[] = [...LOG_STEPS, "extras"];
    // for each stopping point, exactly the steps up to it (plus where) are open
    const openAt: Record<LogStep, LogStep[]> = {
      where: ["where"],
      why: ["where", "why"],
      noise: ["where", "why", "noise"],
      crowd: ["where", "why", "noise", "crowd"],
      review: all,
      extras: all,
    };
    for (const stop of LOG_STEPS) {
      const open = all.filter((step) => stepAllowed(step, draftAt(stop)));
      expect({ [stop]: open }).toEqual({ [stop]: openAt[stop] });
    }
  });

  it("keeps review shut until crowd is answered, then opens extras too", () => {
    const d = draftAt("crowd");
    expect(stepAllowed("review", d)).toBe(false);
    expect(stepAllowed("extras", d)).toBe(false);
    d.crowdAnswered = true;
    expect(stepAllowed("review", d)).toBe(true);
    expect(stepAllowed("extras", d)).toBe(true);
  });

  it("counts a declined question as answered", () => {
    const d = draftAt("noise");
    d.noiseAnswered = true; // "Didn't notice" — noise stays null
    expect(d.noise).toBeNull();
    expect(stepAllowed("crowd", d)).toBe(true);
    expect(firstIncompleteStep(d)).toBe("crowd");
  });

  it("resumes at the first unanswered question", () => {
    expect(firstIncompleteStep(emptyDraft())).toBe("where");
    expect(firstIncompleteStep(emptyDraft("s_wheelhouse"))).toBe("why");
    expect(firstIncompleteStep(draftAt("noise"))).toBe("noise");
    expect(firstIncompleteStep(draftAt("crowd"))).toBe("crowd");
    expect(firstIncompleteStep(draftAt("review"))).toBe("review");
  });
});
