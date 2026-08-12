import { MapPin } from "lucide-react";
import { motion } from "framer-motion";

interface LocationFilterProps {
  locations: string[];
  selected: string | null;
  onSelect: (loc: string | null) => void;
}

const LocationFilter = ({ locations, selected, onSelect }: LocationFilterProps) => {
  if (locations.length < 2) return null;

  const chips = [{ id: null, label: "All" }, ...locations.map((l) => ({ id: l, label: l }))];

  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-0.5">
      {chips.map(({ id, label }) => {
        const isActive = id === selected;
        return (
          <motion.button
            key={label}
            onClick={() => onSelect(id)}
            whileTap={{ scale: 0.93 }}
            className="relative flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium"
          >
            {isActive ? (
              <motion.div
                layoutId="location-active-pill"
                className="absolute inset-0 rounded-full gradient-accent"
                transition={{ type: "spring", bounce: 0.18, duration: 0.35 }}
              />
            ) : (
              <div className="absolute inset-0 rounded-full bg-muted/60 border border-border/50" />
            )}
            {id !== null && (
              <MapPin
                className={`w-3 h-3 relative z-10 flex-shrink-0 ${
                  isActive ? "text-primary-foreground" : "text-muted-foreground"
                }`}
              />
            )}
            <span
              className={`relative z-10 whitespace-nowrap ${
                isActive ? "text-primary-foreground font-semibold" : "text-muted-foreground"
              }`}
            >
              {label}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
};

export default LocationFilter;
