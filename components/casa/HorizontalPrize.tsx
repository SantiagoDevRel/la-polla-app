"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { useMotionValueEvent, type MotionValue } from "framer-motion";
import { cn } from "@/lib/cn";

type Gesture = { id: number; startX: number; startY: number; origin: number; width: number; dragging: boolean };

/** Horizontal dragging controls the viewing angle; the prize stays in place. */
export function HorizontalPrize({ children, label, angle, paused, onPausedChange, onHoldingChange, className }: {
  children: ReactNode;
  label: string;
  angle: MotionValue<number>;
  paused: boolean;
  onPausedChange: (paused: boolean) => void;
  onHoldingChange: (holding: boolean) => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [position, setPosition] = useState(0);
  const [holding, setHolding] = useState(false);
  const finish = useRef<(pointerId: number, cancelled: boolean) => void>(() => {});

  useMotionValueEvent(angle, "change", value => setPosition((Math.round(((value % 360 + 360) % 360) / 2.5) * 2.5) % 360));
  const hold = (next: boolean) => { setHolding(next); onHoldingChange(next); };
  finish.current = (pointerId, cancelled) => {
    const current = gesture.current;
    if (!current || current.id !== pointerId) return;
    gesture.current = null;
    hold(false);
    if (!cancelled) onPausedChange(false);
    if (box.current?.hasPointerCapture(pointerId)) box.current.releasePointerCapture(pointerId);
  };

  useEffect(() => {
    const end = (event: globalThis.PointerEvent) => finish.current(event.pointerId, false);
    const cancel = (event: globalThis.PointerEvent) => finish.current(event.pointerId, true);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    return () => { window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", cancel); };
  }, []);

  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || gesture.current) return;
    gesture.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY,
      origin: angle.get(), width: Math.max(1, event.currentTarget.clientWidth), dragging: false };
    hold(true);
  };
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.dragging) {
      if (Math.abs(dy) >= 5 && Math.abs(dy) > Math.abs(dx)) { finish.current(event.pointerId, true); return; }
      if (Math.abs(dx) < 5 || Math.abs(dx) <= Math.abs(dy)) return;
      current.dragging = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    angle.set(current.origin + dx / current.width * 360);
  };

  return <div ref={box} role="slider" tabIndex={0} aria-label={label} aria-orientation="horizontal"
    aria-valuemin={0} aria-valuemax={360} aria-valuenow={position}
    aria-valuetext={`${position} grados. ${paused || holding ? "Pausado" : "En movimiento"}. Arrastra para girar; al soltar continúa. Flechas para girar, Inicio para el frente y Fin para la espalda.`}
    data-prize-interaction="rotate-y" data-prize-paused={paused || holding} data-prize-angle={position}
    className={cn("relative min-h-11 min-w-11 select-none rounded-md outline-none [touch-action:pan-y_pinch-zoom] focus-visible:ring-2 focus-visible:ring-gold", holding ? "cursor-grabbing" : "cursor-grab", className)}
    onPointerDown={begin} onPointerMove={drag}
    onPointerUp={event => finish.current(event.pointerId, false)}
    onPointerCancel={event => finish.current(event.pointerId, true)}
    onLostPointerCapture={event => { if (event.target === event.currentTarget) finish.current(event.pointerId, true); }}
    onClick={event => { event.preventDefault(); event.stopPropagation(); }}
    onDragStart={event => event.preventDefault()}
    onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End", " ", "Enter"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === " " || event.key === "Enter") { if (!event.repeat) onPausedChange(!paused); return; }
      onPausedChange(true);
      angle.set(event.key === "Home" ? 0 : event.key === "End" ? 180 : angle.get() + (event.key === "ArrowLeft" ? -15 : 15));
    }}>
    {children}
  </div>;
}
