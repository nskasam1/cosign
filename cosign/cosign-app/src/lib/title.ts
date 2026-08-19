// The document title, per route.
//
// The SPA is one document, so `index.html` can only ever name the app — and
// for four phases it did, which meant every tab, every back-button entry,
// every bookmark and the first thing a screen reader announces on arrival
// all said "Cosign" and nothing else. The SSR share page has said what it is
// since Phase 2 (`${title} — Cosign`); this is the same sentence, said by
// the routes that had no way to say it.
//
// Deliberately not a library. react-helmet and its descendants exist to
// manage a whole <head> across a tree; this manages one string, and one
// string is a useEffect.

import { useEffect } from "react";

/** The suffix every title carries, matching server/pages/shareList.ts. */
export const SITE = "Cosign";

/**
 * Name this screen for as long as it is on it.
 *
 * `null` means "not known yet" rather than "no name": a screen whose title
 * arrives with its data passes null while the query is in flight, which
 * shows the bare app name instead of the *previous* screen's title — the one
 * failure mode that makes a per-route title worse than no per-route title,
 * because a stale tab name is a lie a static one cannot tell.
 */
export function useTitle(name: string | null | undefined): void {
  useEffect(() => {
    document.title = name ? `${name} — ${SITE}` : SITE;
  }, [name]);
}
