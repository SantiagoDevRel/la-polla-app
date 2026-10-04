"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { motion, useMotionValue } from "framer-motion";
import { cn } from "@/lib/cn";

type Gesture = { id: number; startX: number; startY: number; origin: number; paused: boolean; dragging: boolean };

/** A small horizontal movement; vertical scrolling and pinch zoom stay native. */
export function HorizontalPrize({ children, label, paused, onPausedChange, onHoldingChange, className }: {
  children: ReactNode;
  label: string;
  paused: boolean;
  onPausedChange: (paused: boolean) => void;
  onHoldingChange: (holding: boolean) => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const x = useMotionValue(0);
  const limit = useRef(14);
  const [position, setPosition] = useState(0);
  const [holding, setHolding] = useState(false);
  const finish = useRef<(pointerId: number, cancelled: boolean) => void>(() => {});

  const move = (next: number) => {
    const value = Math.max(-limit.current, Math.min(limit.current, next));
    x.set(value);
    setPosition(Math.round(value / limit.current * 100));
  };
  const hold = (next: boolean) => { setHolding(next); onHoldingChange(next); };
  finish.current = (pointerId, cancelled) => {
    const current = gesture.current;
    if (!current || current.id !== pointerId) return;
    gesture.current = null;
    hold(false);
    if (!cancelled) onPausedChange(current.dragging ? true : !current.paused);
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
    limit.current = Math.max(1, Math.min(36, event.currentTarget.clientWidth * 0.25));
    gesture.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, origin: x.get(), paused, dragging: false };
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
      onPausedChange(true);
    }
    event.preventDefault();
    move(current.origin + dx);
  };

  return <div ref={box} role="slider" tabIndex={0} aria-label={label} aria-orientation="horizontal"
    aria-valuemin={-100} aria-valuemax={100} aria-valuenow={position}
    aria-valuetext={`${position === 0 ? "Centrado" : position < 0 ? "A la izquierda" : "A la derecha"}. ${paused || holding ? "Pausado" : "En movimiento"}. Flechas para mover; Enter o espacio para pausar o reanudar.`}
    data-prize-interaction="horizontal" data-prize-paused={paused || holding} data-prize-position={position}
    className={cn("relative min-h-11 min-w-11 select-none rounded-md outline-none [touch-action:pan-y_pinch-zoom] focus-visible:ring-2 focus-visible:ring-gold", holding ? "cursor-grabbing" : "cursor-grab", className)}
    onPointerDown={begin} onPointerMove={drag}
    onPointerUp={event => finish.current(event.pointerId, false)}
    onPointerCancel={event => finish.current(event.pointerId, true)}
    onLostPointerCapture={event => finish.current(event.pointerId, true)}
    onClick={event => { event.preventDefault(); event.stopPropagation(); }}
    onDragStart={event => event.preventDefault()}
    onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", " ", "Enter"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      limit.current = Math.max(1, Math.min(36, event.currentTarget.clientWidth * 0.25));
      if (event.key === " " || event.key === "Enter") { if (!event.repeat) onPausedChange(!paused); return; }
      onPausedChange(true);
      move(event.key === "Home" ? 0 : x.get() + (event.key === "ArrowLeft" ? -4 : 4));
    }}>
    <motion.div className="h-full w-full" style={{ x }}>{children}</motion.div>
  </div>;
}
