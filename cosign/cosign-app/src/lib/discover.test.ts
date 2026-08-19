// @vitest-environment node
//
// The hero query and the discovery order, driven from a stubbed position.
// The position is the stub: `GeoProvider.currentPosition()` returns a fixed
// campus coordinate in v1, so "hero query correct via stubbed geolocation"
// means exactly this — move the coordinate, and the answer must move with
// it rather than staying wherever the seed happened to put it.

import { describe, expect, it } from "vitest";
import { CAMPUS_CENTER, type LatLng } from "./geo";
import {
  NEAR_ME_MAX_WALK_MIN,
  crowdOrder,
  discoveryOrder,
  heroMatches,
  heroModeFor,
  heroPick,
  movedBetween,
  place,
  stillOpenIn,
  type Candidate,
} from "./discover";

/** One degree of latitude is ~111 km, so this is metres-per-degree arithmetic. */
const northOf = (at: LatLng, metres: number): Pick<LatLng, "lat" | "lng"> => ({
  lat: at.lat + metres / 111_320,
  lng: at.lng,
});

function shop(id: string, at: { lat: number; lng: number }, over: Partial<Candidate> = {}): Candidate {
  return {
    id,
    lat: at.lat,
    lng: at.lng,
    open_now: true,
    closes_in_min: 120,
    outlet_count: 8,
    camp_ok: false,
    friend_count: 0,
    friend_score: 0,
    friend_sample: 0,
    crowd_score: 0,
    crowd_sample: 0,
    ...over,
  };
}

// A little campus. Distances are from CAMPUS_CENTER unless the test moves.
const NEAR = shop("near", northOf(CAMPUS_CENTER, 400));                       // 5 min walk
const NEARER_NO_OUTLETS = shop("dry", northOf(CAMPUS_CENTER, 150), { outlet_count: 0 });
const NEAREST_CLOSED = shop("shut", northOf(CAMPUS_CENTER, 80), { open_now: false, closes_in_min: null });
const CAMPABLE = shop("camp", northOf(CAMPUS_CENTER, 900), { camp_ok: true, closes_in_min: 300 });
const LATEST = shop("latest", northOf(CAMPUS_CENTER, 1200), { camp_ok: true, closes_in_min: 600 });
const FAR = shop("far", northOf(CAMPUS_CENTER, 4000));                        // 50 min walk
const ALL = [NEAR, NEARER_NO_OUTLETS, NEAREST_CLOSED, CAMPABLE, LATEST, FAR];

const ids = (list: Array<{ id: string }>) => list.map((s) => s.id);

describe("near me, open now, has outlets", () => {
  it("keeps only places that are open, have an outlet, and are within a walk", () => {
    expect(ids(heroMatches(place(ALL, CAMPUS_CENTER))).sort()).toEqual(["camp", "latest", "near"]);
  });

  it("excludes a nearer place with no outlets and a nearer place that is shut", () => {
    const matches = ids(heroMatches(place(ALL, CAMPUS_CENTER)));
    expect(matches).not.toContain("dry"); // 150 m away, zero outlets
    expect(matches).not.toContain("shut"); // 80 m away, closed
  });

  it("excludes a place past the far end of campus", () => {
    const placed = place([FAR], CAMPUS_CENTER);
    expect(placed[0].walk_min).toBeGreaterThan(NEAR_ME_MAX_WALK_MIN);
    expect(heroMatches(placed)).toEqual([]);
  });

  it("picks the nearest match", () => {
    expect(heroPick(place(ALL, CAMPUS_CENTER))!.id).toBe("near");
  });

  it("follows the stubbed position: stand somewhere else and the answer moves", () => {
    // Standing next to the far one, it is now the only thing within a walk.
    const elsewhere: LatLng = { lat: FAR.lat, lng: FAR.lng };
    expect(heroPick(place(ALL, elsewhere))!.id).toBe("far");
    // ...and the campus answer is now the one that is out of range.
    expect(ids(heroMatches(place(ALL, elsewhere)))).toEqual(["far"]);
  });

  it("has no answer when nothing open with an outlet is near — the designed empty state", () => {
    expect(heroPick(place([NEARER_NO_OUTLETS, NEAREST_CLOSED, FAR], CAMPUS_CENTER))).toBeNull();
    expect(heroPick([])).toBeNull();
  });

  it("breaks a tie inside the same walking minute with your friends", () => {
    // Same latitude offset north and south: identical distance, so the only
    // thing left to separate them is whose list they are on.
    const a = shop("a", { lat: CAMPUS_CENTER.lat + 0.0045, lng: CAMPUS_CENTER.lng });
    const b = shop("b", { lat: CAMPUS_CENTER.lat - 0.0045, lng: CAMPUS_CENTER.lng }, {
      friend_count: 1,
      friend_score: 0.9,
      friend_sample: 3,
    });
    const placed = place([a, b], CAMPUS_CENTER);
    expect(placed[0].distance_m).toBe(placed[1].distance_m);
    expect(heroPick(placed)!.id).toBe("b");
  });
});

describe("finals week changes the answer, never the question", () => {
  it("is driven by the calendar phase, not by a setting", () => {
    expect(heroModeFor("finals")).toBe("finals");
    expect(heroModeFor("mid_semester")).toBe("usual");
    expect(heroModeFor("week_one")).toBe("usual");
    expect(heroModeFor("break")).toBe("usual");
  });

  it("runs the same predicate — both modes answer from the same match set", () => {
    const placed = place(ALL, CAMPUS_CENTER);
    const matches = heroMatches(placed);
    expect(matches).toContain(heroPick(placed, "usual"));
    expect(matches).toContain(heroPick(placed, "finals"));
    // A place with no outlets can never be the finals answer either, however
    // long it stays open — the query is the brief's, in both weeks.
    const openAllNightNoOutlets = shop("bar", northOf(CAMPUS_CENTER, 90), {
      outlet_count: 0,
      camp_ok: true,
      closes_in_min: 1200,
    });
    expect(heroPick(place([openAllNightNoOutlets, CAMPABLE], CAMPUS_CENTER), "finals")!.id).toBe("camp");
  });

  it("prefers somewhere you can stay, and among those the one open longest", () => {
    const placed = place(ALL, CAMPUS_CENTER);
    expect(heroPick(placed, "usual")!.id).toBe("near"); // closest
    expect(heroPick(placed, "finals")!.id).toBe("latest"); // camp-able, open 10 hours
  });

  it("still refuses a place you cannot sit in over one you can, however close", () => {
    const closeButTurning = shop("turning", northOf(CAMPUS_CENTER, 60), { camp_ok: false, closes_in_min: 900 });
    const placed = place([closeButTurning, CAMPABLE], CAMPUS_CENTER);
    expect(heroPick(placed, "usual")!.id).toBe("turning");
    expect(heroPick(placed, "finals")!.id).toBe("camp");
  });
});

describe("the order Home reads in", () => {
  const crowdFavourite = shop("crowd", northOf(CAMPUS_CENTER, 100), {
    friend_count: 0,
    friend_score: 0.98,
    friend_sample: 50,
  });
  const friendsPick = shop("friends", northOf(CAMPUS_CENTER, 2000), {
    friend_count: 1,
    friend_score: 0.2,
    friend_sample: 3,
  });

  it("puts a place your friends have ranked above one only the crowd has", () => {
    // Deliberately the hard case: the crowd's is nearer AND scores higher.
    expect(ids(discoveryOrder(place([crowdFavourite, friendsPick], CAMPUS_CENTER)))).toEqual([
      "friends",
      "crowd",
    ]);
  });

  it("orders inside the friends' tier by how highly they rank it", () => {
    const top = shop("top", northOf(CAMPUS_CENTER, 3000), { friend_count: 1, friend_score: 0.95, friend_sample: 3 });
    const bottom = shop("bottom", northOf(CAMPUS_CENTER, 50), { friend_count: 2, friend_score: 0.3, friend_sample: 6 });
    expect(ids(discoveryOrder(place([bottom, top], CAMPUS_CENTER)))).toEqual(["top", "bottom"]);
  });

  it("falls back to the walk for places nobody has put in order", () => {
    const far = shop("far", northOf(CAMPUS_CENTER, 3000));
    const close = shop("close", northOf(CAMPUS_CENTER, 200));
    expect(ids(discoveryOrder(place([far, close], CAMPUS_CENTER)))).toEqual(["close", "far"]);
  });

  it("degrades to the crowd order for someone with no friends and no list", () => {
    const a = shop("a", northOf(CAMPUS_CENTER, 900), { friend_score: 0.9, friend_sample: 10 });
    const b = shop("b", northOf(CAMPUS_CENTER, 100), { friend_score: 0.4, friend_sample: 10 });
    expect(ids(discoveryOrder(place([b, a], CAMPUS_CENTER)))).toEqual(["a", "b"]);
  });

  it("is stable — the same input gives the same order", () => {
    const placed = place(ALL, CAMPUS_CENTER);
    expect(ids(discoveryOrder(placed))).toEqual(ids(discoveryOrder([...placed].reverse())));
  });

  it("lets your friends order their own picks, whatever the crowd thinks", () => {
    // The friend's number one; the crowd's last. And the friend's last;
    // the crowd's number one. A weighted mean would put the crowd's
    // favourite first at any crowd size past a handful — which is why the
    // friend score has no stranger in it at all.
    const friendsFirst = shop("theirs-1", northOf(CAMPUS_CENTER, 3000), {
      friend_count: 1, friend_score: 1, friend_sample: 1, crowd_score: 0, crowd_sample: 50,
    });
    const friendsLast = shop("theirs-9", northOf(CAMPUS_CENTER, 100), {
      friend_count: 1, friend_score: 0, friend_sample: 1, crowd_score: 1, crowd_sample: 50,
    });
    expect(ids(discoveryOrder(place([friendsLast, friendsFirst], CAMPUS_CENTER)))).toEqual([
      "theirs-1",
      "theirs-9",
    ]);
  });

  it("lets the crowd order the places your friends have no opinion about", () => {
    const loved = shop("loved", northOf(CAMPUS_CENTER, 3000), { crowd_score: 0.9, crowd_sample: 10 });
    const tolerated = shop("meh", northOf(CAMPUS_CENTER, 100), { crowd_score: 0.2, crowd_sample: 10 });
    expect(ids(discoveryOrder(place([tolerated, loved], CAMPUS_CENTER)))).toEqual(["loved", "meh"]);
  });
});

describe("the order you are not being given", () => {
  const mine = shop("mine", northOf(CAMPUS_CENTER, 2000), {
    friend_count: 1, friend_score: 1, friend_sample: 2, crowd_score: 0.1, crowd_sample: 30,
  });
  const theirs = shop("theirs", northOf(CAMPUS_CENTER, 200), { crowd_score: 0.95, crowd_sample: 30 });
  const nobodys = shop("nobodys", northOf(CAMPUS_CENTER, 400), { crowd_score: 0.5, crowd_sample: 2 });
  const placed = place([mine, theirs, nobodys], CAMPUS_CENTER);

  it("is the same places, ordered as if nobody you knew counted for more", () => {
    expect(ids(discoveryOrder(placed))).toEqual(["mine", "theirs", "nobodys"]);
    expect(ids(crowdOrder(placed))).toEqual(["theirs", "nobodys", "mine"]);
    expect(new Set(ids(crowdOrder(placed)))).toEqual(new Set(ids(discoveryOrder(placed))));
  });

  it("counts how many places move between the two", () => {
    expect(movedBetween(discoveryOrder(placed), crowdOrder(placed))).toBe(3);
    expect(movedBetween(discoveryOrder(placed), discoveryOrder(placed))).toBe(0);
    // one swap in the middle moves exactly the two that swapped
    const a = [{ id: "x" }, { id: "y" }, { id: "z" }];
    const b = [{ id: "x" }, { id: "z" }, { id: "y" }];
    expect(movedBetween(a, b)).toBe(2);
  });

  it("is the crowd's order for everyone, so a logged-out reader sees no difference", () => {
    // Nobody's friend: every friend_score is 0 and the tier is flat.
    const anonymous = placed.map((p) => ({ ...p, friend_count: 0, friend_score: 0, friend_sample: 0 }));
    expect(ids(discoveryOrder(anonymous))).toEqual(ids(crowdOrder(anonymous)));
    expect(movedBetween(discoveryOrder(anonymous), crowdOrder(anonymous))).toBe(0);
  });
});

describe("who is still open", () => {
  it("names only places open for at least that long, longest first", () => {
    const placed = place(ALL, CAMPUS_CENTER);
    expect(ids(stillOpenIn(placed, 240))).toEqual(["latest", "camp"]);
    expect(stillOpenIn(placed, 900)).toEqual([]);
  });
});
