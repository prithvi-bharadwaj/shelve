import type { SVGProps } from "react";

export function RegroupLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M5.5 20V7.5A2.5 2.5 0 0 1 8 5h4.25a4.25 4.25 0 0 1 0 8.5H5.5" />
      <path d="m12 13.5 6.5 6.5" />
      <path d="M5.5 3.5h6" opacity=".55" />
    </svg>
  );
}

export function UngroupIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M7 4H4.75A1.75 1.75 0 0 0 3 5.75v8.5A1.75 1.75 0 0 0 4.75 16H7" />
      <path d="M8.5 6.5h5M8.5 10h7M8.5 13.5h3.5" />
      <path d="m13.5 4 2-1m0 14 2-1" />
    </svg>
  );
}
