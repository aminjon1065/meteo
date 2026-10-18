import { cn } from "@meteo/ui/lib/utils";

/** Знак портала: солнце за облаком в фирменном синем квадрате. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      aria-hidden="true"
      className={cn("size-8 shrink-0", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="40" height="40" rx="10" fill="var(--brand-primary)" />
      <circle cx="26" cy="15" r="6" fill="var(--brand-accent)" />
      <path
        d="M11 29a5.5 5.5 0 0 1-.6-10.97A8 8 0 0 1 25.7 16.2 6.4 6.4 0 0 1 30 29H11z"
        fill="#ffffff"
      />
    </svg>
  );
}
