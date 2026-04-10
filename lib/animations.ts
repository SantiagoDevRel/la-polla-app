// lib/animations.ts — Single source of truth for all Framer Motion variants
// See CLAUDE.md "Animation System" for usage rules

import { Variants } from "framer-motion";

// Duration tokens
export const DURATION = {
  fast: 0.15, // Button presses, toggles
  normal: 0.25, // Default transitions
  medium: 0.35, // Card animations, entrances
  slow: 0.5, // Page transitions
};

// Easing tokens (typed as 4-tuples for framer-motion)
export const EASE = {
  default: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number],
  spring: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
  sharp: [0.4, 0, 0.2, 1] as [number, number, number, number],
};

// Cards, list items entering the view
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.medium, ease: EASE.default },
  },
};

// Simple opacity fade
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATION.normal } },
};

// Modals, popups scaling in
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.94 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: DURATION.normal, ease: EASE.default },
  },
};

// Stagger container for lists of items
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
};

// Score/number pop — use when revealing match scores or points
export const scorePop: Variants = {
  hidden: { opacity: 0, scale: 0.5 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: DURATION.medium, ease: EASE.spring },
  },
};
