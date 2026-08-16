// The sentences Home and Search say about a place. Pure, so the wording is
// unit-testable rather than screenshot-testable — and so the one rule that
// matters here ("name a friend, count everyone else") is enforced in one
// place instead of at every call site.
//
// Copy voice: a knowing friend, not a brand. No numbers that could be read
// as a score — a position in somebody's ordered list is written as a word
// ("ranks it fourth"), never as a fraction.

export interface PlaceLike {
  walk_min: number;
  open_now: boolean;
  closes_in_min: number | null;
  amenities: { outlet_count: number | null } | null;
  you: number | null;
  friends: Array<{ display_name: string; position: number }>;
  others: number;
  cosign_total: number;
  age: { label: string; stale: boolean };
}

const ORDINALS = [
  "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth",
  "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth",
  "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth",
  "twenty-first", "twenty-second",
];

/** "fourth" up to twenty-second, then plain — nobody says "thirty-ninth". */
export function ordinalWord(n: number): string {
  return ORDINALS[n - 1] ?? `number ${n}`;
}

const COUNTS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

export function countWord(n: number): string {
  return COUNTS[n] ?? String(n);
}

/** "open till 10 pm" · "open all night" · "shut" — never a bare number. */
export function closingLabel(closesInMin: number | null, now: Date = new Date()): string {
  if (closesInMin === null) return "shut";
  // Past twelve hours the clock time stops being useful and starts being a
  // curiosity: The All-Nighter runs Thursday to Monday and "open till 1 am
  // on Monday" is not what anyone wanted to know.
  if (closesInMin > 12 * 60) return "open all night";
  const at = new Date(now.getTime() + closesInMin * 60_000);
  const h24 = at.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mins = at.getMinutes();
  const time = mins === 0 ? `${h12}` : `${h12}:${String(mins).padStart(2, "0")}`;
  return `open till ${time} ${h24 < 12 ? "am" : "pm"}`;
}

/**
 * What week of the term it is, in words. On the page for the same reason
 * the log flow's receipt carries the semester: Cosign already knows, so it
 * never asks.
 */
export function phaseLabel(phase: string, semester: string): string {
  if (phase === "finals") return "Finals week";
  if (phase === "week_one") return "Week one";
  if (phase === "break") return "Between terms";
  const [year, term] = semester.split("-");
  return term ? `${term[0].toUpperCase()}${term.slice(1)} ${year}` : "Term time";
}

/** 1260 → "9 pm", 1290 → "9:30 pm", 1560 → "2 am" (the next day). */
export function clockLabel(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mins = m % 60;
  return `${h12}${mins ? `:${String(mins).padStart(2, "0")}` : ""} ${h24 < 12 ? "am" : "pm"}`;
}

export interface HoursRowLike {
  day: number;
  open_min: number;
  close_min: number;
}

/** "7 am – 10 pm" for today, or null when it never opens today. */
export function todaysWindow(hours: HoursRowLike[], now: Date = new Date()): string | null {
  const today = hours.filter((h) => h.day === now.getDay()).sort((a, b) => a.open_min - b.open_min);
  if (today.length === 0) return null;
  if (today.length === 1 && today[0].open_min === 0 && today[0].close_min >= 1440) return "all day";
  return today.map((h) => `${clockLabel(h.open_min)} – ${clockLabel(h.close_min)}`).join(", ");
}

/**
 * The gold small-caps line under a place: walk, hours, outlets, and where it
 * sits in your own list. Facts and measurements — never a rating.
 */
export function factsOf(place: PlaceLike, now: Date = new Date()): string[] {
  const facts = [`${place.walk_min} min`, closingLabel(place.closes_in_min, now)];
  const outlets = place.amenities?.outlet_count;
  if (outlets != null) facts.push(outlets === 0 ? "no outlets" : `${outlets} outlets`);
  if (place.you !== null) facts.push(`your ${ordinalWord(place.you)}`);
  return facts;
}

/**
 * Who put it in order, in names — and only names the viewer could already
 * open. `friends` holds accepted friends only (server/repo/scores.ts), so
 * this cannot leak a stranger's list however public it is; everyone else is
 * a number.
 */
export function friendSentence(place: PlaceLike): string | null {
  const { friends, cosign_total: total } = place;
  if (total === 0) return null;
  const mine = place.you === null ? 0 : 1;
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

  if (friends.length === 0) {
    const strangers = total - mine;
    if (strangers === 0) return "Only on your list so far.";
    // Deliberately not "none of them anyone you know": true, but it would
    // be the same eight words on every row of a friendless account's Home,
    // and the section it sits under has already said it once.
    return cap(`on ${countWord(strangers)} ${strangers === 1 ? "list" : "lists"} near campus.`);
  }

  // Two names is the most a line can carry before it stops being a sentence.
  const shown = friends.slice(0, 2);
  const named = shown.map((f, i) => {
    const first = f.display_name.split(" ")[0];
    return i === 0 ? `${first} ranks it ${ordinalWord(f.position)}` : `${first} ${ordinalWord(f.position)}`;
  });
  const rest = total - shown.length - mine;
  const tail = rest > 0 ? ` ${cap(countWord(rest))} more ${rest === 1 ? "list has" : "lists have"} it too.` : "";
  return `${named.join(", ")}.${tail}`;
}

/**
 * How loudly a row should say how old it is. Three bands, because a date is
 * only worth the space it takes when it changes what you would do:
 *
 *   fresh  (< 21 days) — say nothing. Somebody checked recently; that is
 *                        the default and the default needs no line.
 *   aging  (21–60)     — a muted clause after the facts.
 *   stale  (> 60)      — the facts themselves drop out of the label voice
 *                        and the caveat is set BRIGHTER than the facts it
 *                        qualifies, so the row reads stale before a word of
 *                        it is read.
 */
export type FreshnessBand = "fresh" | "aging" | "stale";

export function freshnessBand(age: { days: number | null; stale: boolean }): FreshnessBand {
  if (age.stale) return "stale";
  return (age.days ?? 0) < 21 ? "fresh" : "aging";
}

/**
 * When the viewer is the last person through the door — their own visit is
 * newer than the facts on file — they are the only person who can answer
 * "is this still right?", so they are the only person asked.
 */
export function isLastThroughTheDoor(lastVisit: string | null, lastVerifiedAt: string | null): boolean {
  if (!lastVisit) return false;
  if (!lastVerifiedAt) return true;
  return new Date(lastVisit).getTime() > new Date(lastVerifiedAt).getTime();
}
