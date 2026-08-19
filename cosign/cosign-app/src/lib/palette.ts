// The place-palette treatment, in one file (Phase 3). A place's rank numeral
// and its no-photo plate take the same hue its photograph was painted with,
// so a list carries a colour rhythm drawn from the places themselves — the
// Phase 2 decision, now shared by the SSR share page and the SPA instead of
// living only in server/pages/shareData.ts.
//
// Pure: no node built-ins, no DOM. Both sides import it.

/** The six imagery treatments in seed/images/generate.mjs. */
export const PALETTES = ["warm", "amber", "rose", "moss", "slate", "clay"] as const;
export type Palette = (typeof PALETTES)[number];

export function paletteOf(raw: string | null | undefined): Palette {
  return (PALETTES as readonly string[]).includes(raw ?? "") ? (raw as Palette) : "warm";
}

/**
 * The two custom properties every palette-aware element reads: `--pal` for
 * the place's hue (numerals, plate ink, hairline) and `--plate` for the
 * ground its initials sit on. Both pairs clear 4.5:1 (tokens.md).
 */
export function paletteStyle(palette: Palette): Record<string, string> {
  return { "--pal": `var(--pal-${palette})`, "--plate": `var(--plate-${palette})` };
}

/** "Cardinal & Vine" -> "C&V"; "Terrazzo" -> "TZ". */
export function initialsOf(name: string): string {
  const words = name.replace(/^The\s+/i, "").split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    const w = words[0];
    return (w[0] + (w.slice(1).match(/[aeiou]?([bcdfghjklmnpqrstvwxyz])/i)?.[1] ?? w[1] ?? "")).toUpperCase();
  }
  return words
    .map((w) => (w === "&" ? "&" : w[0]))
    .join("")
    .slice(0, 3)
    .toUpperCase();
}
