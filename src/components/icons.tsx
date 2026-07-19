import type { SVGProps } from "react";

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
