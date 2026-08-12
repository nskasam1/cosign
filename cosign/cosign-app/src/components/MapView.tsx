import { useEffect, useRef, useState } from "react";
import { LocateFixed } from "lucide-react";
import type { Shop } from "@/types/cosign";

declare global {
  interface Window { google?: any; }
}

interface MapViewProps {
  shops: Shop[];
  onSelectShop: (shop: Shop) => void;
  isVisible?: boolean;
}

const YOU_ARE_HERE_SVG = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
  <circle cx="14" cy="14" r="13" fill="#c8a96e" stroke="#1a1c1e" stroke-width="2"/>
  <circle cx="14" cy="14" r="5" fill="#1a1c1e"/>
</svg>
`);

const PIN_SVG = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
  <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 24 16 24s16-14 16-24C32 7.163 24.837 0 16 0z" fill="#e53e3e"/>
  <circle cx="16" cy="16" r="6" fill="white"/>
</svg>
`);

const MapView = ({ shops, onSelectShop, isVisible = true }: MapViewProps) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const userMarkerRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (window.google?.maps) { setReady(true); return; }
    const interval = setInterval(() => {
      if (window.google?.maps) { clearInterval(interval); setReady(true); }
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const placeUserMarker = (map: any, lat: number, lng: number) => {
    if (userMarkerRef.current) userMarkerRef.current.setMap(null);
    userMarkerRef.current = new window.google.maps.Marker({
      position: { lat, lng },
      map,
      title: "You are here",
      zIndex: 999,
      icon: {
        url: `data:image/svg+xml;charset=UTF-8,${YOU_ARE_HERE_SVG}`,
        scaledSize: new window.google.maps.Size(28, 28),
        anchor: new window.google.maps.Point(14, 14),
      },
    });
  };

  const goToUserLocation = (map: any) => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        map.panTo({ lat, lng });
        map.setZoom(15);
        placeUserMarker(map, lat, lng);
        setLocating(false);
      },
      () => setLocating(false),
      { timeout: 8000 }
    );
  };

  useEffect(() => {
    if (!ready || !mapRef.current || mapInstanceRef.current) return;

    const map = new window.google.maps.Map(mapRef.current, {
      zoom: 15,
      center: { lat: 40.0067, lng: -83.0305 }, // OSU campus — hardcoded per single-campus scope
      disableDefaultUI: true,
      zoomControl: true,
      zoomControlOptions: {
        position: window.google.maps.ControlPosition.RIGHT_CENTER,
      },
      styles: [
        { elementType: "geometry", stylers: [{ color: "#1a1c1e" }] },
        { elementType: "labels.text.fill", stylers: [{ color: "#9ca3af" }] },
        { elementType: "labels.text.stroke", stylers: [{ color: "#1a1c1e" }] },
        { featureType: "road", elementType: "geometry", stylers: [{ color: "#2d3035" }] },
        { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3a3d42" }] },
        { featureType: "water", elementType: "geometry", stylers: [{ color: "#141618" }] },
        { featureType: "poi", elementType: "geometry", stylers: [{ color: "#1e2024" }] },
        { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
        { featureType: "transit", stylers: [{ visibility: "off" }] },
      ],
    });

    mapInstanceRef.current = map;
    goToUserLocation(map);
  }, [ready]);

  useEffect(() => {
    if (isVisible && mapInstanceRef.current) {
      window.google?.maps?.event?.trigger(mapInstanceRef.current, "resize");
    }
  }, [isVisible]);

  useEffect(() => {
    if (!ready || !mapInstanceRef.current) return;

    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    shops.forEach(shop => {
      const marker = new window.google.maps.Marker({
        position: { lat: shop.lat, lng: shop.lng },
        map: mapInstanceRef.current,
        title: shop.name,
        icon: {
          url: `data:image/svg+xml;charset=UTF-8,${PIN_SVG}`,
          scaledSize: new window.google.maps.Size(32, 40),
          anchor: new window.google.maps.Point(16, 40),
        },
      });

      const infoWindow = new window.google.maps.InfoWindow({
        content: `
          <div style="background:#1a1c1e;color:#e8e0d5;padding:8px 12px;border-radius:8px;font-family:sans-serif;min-width:140px">
            <div style="font-weight:600;font-size:13px">${shop.name}</div>
          </div>
        `,
        disableAutoPan: true,
      });

      marker.addListener("mouseover", () => infoWindow.open(mapInstanceRef.current, marker));
      marker.addListener("mouseout", () => infoWindow.close());
      marker.addListener("click", () => onSelectShop(shop));

      markersRef.current.push(marker);
    });
  }, [ready, shops, onSelectShop]);

  return (
    <div className="flex-1 relative w-full h-full">
      {!ready ? (
        <div className="flex-1 flex items-center justify-center h-full">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div ref={mapRef} className="w-full h-full" />
          <button
            onClick={() => mapInstanceRef.current && goToUserLocation(mapInstanceRef.current)}
            disabled={locating}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-card border border-border rounded-full px-4 py-2.5 text-sm text-foreground shadow-lg backdrop-blur-sm active:scale-95 transition-transform disabled:opacity-50"
          >
            <LocateFixed className={`w-4 h-4 text-primary ${locating ? "animate-pulse" : ""}`} />
            {locating ? "Locating…" : "My location"}
          </button>
        </>
      )}
    </div>
  );
};

export default MapView;
