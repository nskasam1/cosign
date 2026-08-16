import { initialsOf, paletteOf, paletteStyle } from "@/lib/palette";
import type { CSSProperties } from "react";

interface PlacePlateProps {
  name: string;
  photo: string | null;
  palette: string | null;
  size: number;
  className?: string;
}

/**
 * A place's photograph, or — when it has none — the designed plate the share
 * page uses: its initials in the display face, on the ground its imagery
 * would have been painted with. Not a fallback, a state. The SPA's old light
 * placeholder asset read wrong on this ground and has been deleted.
 */
const PlacePlate = ({ name, photo, palette, size, className = "" }: PlacePlateProps) => {
  const style = { ...paletteStyle(paletteOf(palette)), width: size, height: size } as CSSProperties;
  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        style={style}
        className={`cs-shot flex-none ${className}`}
      />
    );
  }
  return (
    <span
      data-nophoto
      aria-hidden="true"
      style={{ ...style, fontSize: Math.round(size * 0.29) }}
      className={`cs-plate flex-none ${className}`}
    >
      {initialsOf(name)}
    </span>
  );
};

export default PlacePlate;
