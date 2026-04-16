import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export type OrbProps = {
  isActive?: boolean;
  className?: string;
  style?: React.CSSProperties;
  variant?: "destructive" | "primary";
};

/**
 * A minimalist, audio-reactive recording indicator.
 * Displays a solid core with a reactive outer border that scales with the microphone volume.
 *
 * PERFORMANCE: Uses CSS variables (`--volume-scale`) to allow direct DOM manipulation
 * from requestAnimationFrame loops, bypassing React re-renders.
 */
export const Orb = forwardRef<HTMLDivElement, OrbProps>(
  ({ isActive = false, className, style, variant = "destructive" }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "relative flex items-center justify-center w-full h-full",
          className,
        )}
        style={style}
      >
        {/* Audio Reactive Border */}
        <div
          className={cn(
            "absolute rounded-full border-2 transition-transform duration-75 ease-out",
            isActive
              ? variant === "destructive"
                ? "border-destructive opacity-100"
                : "border-primary opacity-100"
              : "border-muted opacity-50",
          )}
          style={{
            width: "60%",
            height: "60%",
            // Use CSS variable with a fallback to 0
            transform: isActive
              ? "scale(calc(1 + (var(--volume-scale, 0) * 0.8)))"
              : "scale(1)",
          }}
        />

        {/* Solid Inner Core */}
        <div
          className={cn(
            "absolute rounded-full transition-colors duration-300",
            isActive
              ? variant === "destructive"
                ? "bg-destructive shadow-md shadow-destructive/20"
                : "bg-primary shadow-md shadow-primary/20"
              : "bg-muted",
          )}
          style={{
            width: "40%",
            height: "40%",
          }}
        />
      </div>
    );
  },
);
Orb.displayName = "Orb";
