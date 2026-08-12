import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { MapPin, Loader2, AlertTriangle } from "lucide-react";

export interface Place {
  place_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  google_maps_url: string;
}

interface Suggestion {
  placeId: string;
  mainText: string;
  secondaryText: string;
}

interface PlaceSearchProps {
  onSelect: (place: Place) => void;
  selectedPlace: Place | null;
  initialQuery?: string;
}

// In dev:  Vite proxy forwards /api/places/* to places.googleapis.com (server-side, key injected by proxy)
// In prod: Vercel Edge Functions at api/places/autocomplete.ts + api/places/details.ts handle it
// The browser never sends the API key.

async function autocomplete(input: string, sessionToken: string): Promise<Suggestion[]> {
  const res = await fetch("/api/places/autocomplete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, sessionToken, includedPrimaryTypes: ["establishment"] }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  return (json.suggestions ?? []).map((s: any) => ({
    placeId: s.placePrediction.placeId,
    mainText:
      s.placePrediction.structuredFormat?.mainText?.text ??
      s.placePrediction.text?.text ??
      "",
    secondaryText: s.placePrediction.structuredFormat?.secondaryText?.text ?? "",
  }));
}

async function placeDetails(placeId: string, sessionToken: string): Promise<Place> {
  const params = new URLSearchParams({
    placeId,
    fields: "id,displayName,formattedAddress,location",
    sessionToken,
  });
  const res = await fetch(`/api/places/details?${params}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  return {
    place_id: placeId,
    name: json.displayName?.text ?? "",
    address: json.formattedAddress ?? "",
    lat: json.location?.latitude ?? 0,
    lng: json.location?.longitude ?? 0,
    google_maps_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(json.displayName?.text ?? '')}&query_place_id=${placeId}`,
  };
}

const PlaceSearch = ({ onSelect, selectedPlace, initialQuery = "" }: PlaceSearchProps) => {
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionToken = useRef(crypto.randomUUID());
  // Track whether the user has actually typed so we don't search on mount
  const userHasTyped = useRef(false);

  const runSearch = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const results = await autocomplete(q, sessionToken.current);
      setSuggestions(results);
      setShowDropdown(true);
    } catch (e: any) {
      setError(e.message ?? "Search failed");
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userHasTyped.current) return;
    setError(null);
    if (!query || query.length < 2) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    const tid = setTimeout(() => runSearch(query), 300);
    return () => clearTimeout(tid);
  }, [query, runSearch]);

  const handleSelect = async (s: Suggestion) => {
    setSuggestions([]);
    setShowDropdown(false);
    setError(null);
    setLoading(true);
    try {
      const place = await placeDetails(s.placeId, sessionToken.current);
      onSelect(place);
      setQuery(place.name);
      sessionToken.current = crypto.randomUUID();
    } catch (e: any) {
      setError(e.message ?? "Failed to load place details");
    } finally {
      setLoading(false);
    }
  };

  const handleManualConfirm = () => {
    if (!query.trim()) return;
    onSelect({
      place_id: `manual-${Date.now()}`,
      name: query.trim(),
      address: "",
      lat: 0,
      lng: 0,
      google_maps_url: "",
    });
    setShowDropdown(false);
    setSuggestions([]);
  };

  return (
    <div className="relative">
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
        )}
        <Input
          value={selectedPlace ? selectedPlace.name : query}
          onChange={(e) => {
            userHasTyped.current = true;
            setQuery(e.target.value);
            if (selectedPlace) onSelect(null as unknown as Place);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (suggestions.length > 0) handleSelect(suggestions[0]);
              else if (query.trim()) handleManualConfirm();
            }
            if (e.key === "Escape") setShowDropdown(false);
          }}
          onFocus={() => { if (suggestions.length > 0) setShowDropdown(true); }}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          placeholder="Search coffee shop…"
          className="pl-9 pr-9 bg-background border-border"
        />
      </div>

      {error && (
        <div className="flex items-start gap-1.5 mt-1.5 px-1">
          <AlertTriangle className="w-3.5 h-3.5 text-destructive flex-shrink-0 mt-0.5" />
          <p className="text-xs text-destructive leading-snug">{error}</p>
        </div>
      )}

      {showDropdown && (
        <div className="absolute z-50 top-full mt-1 w-full border border-border rounded-xl bg-card overflow-hidden shadow-xl">
          {suggestions.map((s) => (
            <button
              key={s.placeId}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(s); }}
              className="w-full text-left px-4 py-3 text-sm hover:bg-muted transition-colors border-b border-border last:border-b-0 flex items-start gap-2.5"
            >
              <MapPin className="w-3.5 h-3.5 text-primary mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <span className="text-foreground block truncate">{s.mainText}</span>
                {s.secondaryText && (
                  <span className="text-muted-foreground text-xs block truncate">
                    {s.secondaryText}
                  </span>
                )}
              </div>
            </button>
          ))}
          {suggestions.length === 0 && query.length >= 2 && !loading && (
            <button
              onMouseDown={(e) => { e.preventDefault(); handleManualConfirm(); }}
              className="w-full text-left px-4 py-3 text-sm hover:bg-muted transition-colors text-muted-foreground flex items-center gap-2.5"
            >
              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
              Use &ldquo;<span className="text-foreground ml-1">{query}</span>&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default PlaceSearch;
