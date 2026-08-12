import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Load Google Maps JS SDK — only needed for the Map view (pins/markers)
const googleMapsKey = import.meta.env.VITE_GOOGLE_MAPS_KEY;
if (googleMapsKey) {
  const script = document.createElement("script");
  // Do NOT use &loading=async — that defers library load and breaks new google.maps.Map()
  script.src = `https://maps.googleapis.com/maps/api/js?key=${googleMapsKey}`;
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
}

createRoot(document.getElementById("root")!).render(<App />);
