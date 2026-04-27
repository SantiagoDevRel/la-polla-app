// components/layout/FontScaleApplier.tsx — Reads the stored font-scale
// preference on mount, applies it once, then keeps it applied to nodes
// React adds later (route changes, lazy components, modals).
//
// Mounted once at the (app) layout so it covers every authenticated
// page. Renders nothing.
"use client";

import { useEffect } from "react";
import {
  applyScale,
  FONT_SCALE_VALUES,
  getStoredScale,
  scaleInlineFontSizes,
} from "@/lib/font-scale";

export default function FontScaleApplier() {
  useEffect(() => {
    applyScale(getStoredScale());

    // Keep the inline-px scaling consistent as React adds new nodes
    // (route changes, lazy children, modal portals). The observer
    // re-reads the current preference on every fire so toggling the
    // FontScalePicker mid-session works without remounting.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const value = FONT_SCALE_VALUES[getStoredScale()];
        scaleInlineFontSizes(value);
      }, 80);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style"],
    });

    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return null;
}
