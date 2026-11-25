// The site's mark: an open book (the library) with a gold spark above it (the "brain" lighting up) on a crimson-to-maroon tile: the colours of the site's top bar.
// Drawn as inline SVG: sharp at any size, no image to download, the same file as public/favicon.svg. It is decoration: the name next to it carries the meaning.
import { useId } from "react";

export function BrandMark({ size = 40, className }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`bm${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E0352D" />
          <stop offset="0.5" stopColor="#C00000" />
          <stop offset="1" stopColor="#7A0A0A" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#bm${id})`} />
      <g transform="translate(0 5)">
        <g transform="translate(0 1.6)" fill="#3A0000" fillOpacity="0.32">
          <path d="M31 27C25.5 23.6 18.5 23 12 24.6V44.6C18.5 43 25.5 43.6 31 47Z" />
          <path d="M33 27C38.5 23.6 45.5 23 52 24.6V44.6C45.5 43 38.5 43.6 33 47Z" />
          <path d="M32 7C32.8 11 35 13.2 39 14C35 14.8 32.8 17 32 21C31.2 17 29 14.8 25 14C29 13.2 31.2 11 32 7Z" />
        </g>
        <path d="M31 27C25.5 23.6 18.5 23 12 24.6V44.6C18.5 43 25.5 43.6 31 47Z" fill="#fff" />
        <path d="M33 27C38.5 23.6 45.5 23 52 24.6V44.6C45.5 43 38.5 43.6 33 47Z" fill="#fff" fillOpacity="0.9" />
        <path d="M32 7C32.8 11 35 13.2 39 14C35 14.8 32.8 17 32 21C31.2 17 29 14.8 25 14C29 13.2 31.2 11 32 7Z" fill="#FFD166" />
      </g>
    </svg>
  );
}
