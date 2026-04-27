// components/layout/FontScaleApplier.tsx — Reads the stored font-scale
// preference on mount and applies it to <body>. Mounted once at the
// (app) layout so it covers every authenticated page. Renders nothing.
"use client";

import { useEffect } from "react";
import { applyScale, getStoredScale } from "@/lib/font-scale";

export default function FontScaleApplier() {
  useEffect(() => {
    applyScale(getStoredScale());
  }, []);

  return null;
}
