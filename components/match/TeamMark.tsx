"use client";

import { useEffect, useRef, useState } from "react";

interface TeamMarkProps {
  name: string;
  src: string | null;
}

export function TeamMark({ name, src }: TeamMarkProps) {
  const [failed, setFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setFailed(false);
    // A cached/network error can happen before React hydrates and attaches
    // `onError`. Check the settled element as well so a broken crest never
    // survives as the browser's missing-image icon.
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth === 0) setFailed(true);
  }, [src]);

  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <span className="mx-auto mb-3 flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-bg-elevated">
      {src && !failed ? (
        // Provider crests are already small assets; bypassing Next Image avoids
        // consuming Vercel image-optimization quota for a 56 px decoration.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imageRef}
          src={src}
          alt=""
          className="h-12 w-12 max-w-none object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="lp-display text-[20px] tracking-[0.08em] text-text-secondary" aria-hidden="true">
          {initials || "—"}
        </span>
      )}
    </span>
  );
}
