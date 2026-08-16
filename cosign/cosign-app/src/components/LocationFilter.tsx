import { MapPin } from "lucide-react";

interface LocationFilterProps {
  locations: string[];
  selected: string | null;
  onSelect: (loc: string | null) => void;
}

// Phase 3 note: this used the deleted .gradient-accent utility and drove its
// active state with framer-motion's whileTap + layoutId spring, neither of
// which consults prefers-reduced-motion — the tokens only zero CSS durations.
// It is now a flat ember chip on the share page's own chip geometry.
const LocationFilter = ({ locations, selected, onSelect }: LocationFilterProps) => {
  if (locations.length < 2) return null;

  const chips = [{ id: null, label: "All" }, ...locations.map((l) => ({ id: l, label: l }))];

  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-0.5">
      {chips.map(({ id, label }) => {
        const isActive = id === selected;
        return (
          <button
            key={label}
            type="button"
            onClick={() => onSelect(id)}
            aria-pressed={isActive}
            className={`flex min-h-11 flex-shrink-0 items-center gap-1.5 rounded-full border px-4 text-xs transition-colors duration-fast ease-out ${
              isActive
                ? "border-ember bg-ember font-bold text-background"
                : "border-rule-strong bg-surface text-line"
            }`}
          >
            {id !== null && <MapPin className="h-3 w-3 flex-shrink-0" aria-hidden="true" />}
            <span className="whitespace-nowrap">{label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default LocationFilter;
