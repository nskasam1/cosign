// Geolocation behind a provider interface with a local stub (fixed campus
// coordinate) — no persistent location history: positions are read
// momentarily and never stored (decision 12).

export interface LatLng {
  lat: number;
  lng: number;
}

/** The Oval, Ohio State University — the stub's fixed campus coordinate. */
export const CAMPUS_CENTER: LatLng = { lat: 40.0007, lng: -83.0114 };

export interface GeoProvider {
  /** Momentary position read; never persisted. */
  currentPosition(): Promise<LatLng>;
}

/** Local stub: always the campus center. The only provider in v1. */
export const stubGeoProvider: GeoProvider = {
  currentPosition: async () => CAMPUS_CENTER,
};

/**
 * One momentary read, handed straight to the request that needs it.
 *
 * Nothing keeps the result: not a module variable, not localStorage, not a
 * row. Swapping the provider is the whole seam — `server/repo/discover.test.ts`
 * moves the coordinate and watches the hero query follow it, which is what
 * "correct via stubbed geolocation" means when the stub IS the provider.
 */
export async function readPosition(provider: GeoProvider = stubGeoProvider): Promise<LatLng> {
  return provider.currentPosition();
}

/** Great-circle distance in meters (replaces the raw-degrees Math.hypot bug). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function walkingMinutes(meters: number): number {
  return Math.round(meters / 80); // ~4.8 km/h
}
