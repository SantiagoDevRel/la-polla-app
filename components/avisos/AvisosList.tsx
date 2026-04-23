// components/avisos/AvisosList.tsx — Interactive Avisos feed
//
// Takes the server-fetched initial payload and renders the filter tabs +
// list. Clicking an unread item marks it read via the /api/notifications
// POST endpoint and optimistically updates local state. "Marcar todas"
// flips every unread row with a single call. No emojis — every type gets
// a lucide icon with a tinted background matching the Tribuna Caliente
// semantic palette (gold for wins, turf for celebration, red for
// rank-down, muted for neutral).

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  ArrowDown,
  Target,
  Trophy,
  Flag,
  Frown,
  Bell,
  Check,
} from "lucide-react";
import { getPollitoBase } from "@/lib/pollitos";

type NotificationType =
  | "rank_up"
  | "rank_down"
  | "perfect_pick"
  | "last_place"
  | "polla_finished"
  | "polla_started";

export interface AvisoItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  polla_id: string | null;
  match_id: string | null;
  actor_user_id: string | null;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
  polla: { id: string; slug: string; name: string } | null;
  actor: { id: string; display_name: string | null; avatar_url: string | null } | null;
}

interface TypeVisual {
  Icon: typeof ArrowUp;
  tint: string; // tailwind bg class for circle
  ring: string; // tailwind border for circle
  iconColor: string; // tailwind text color
}

const TYPE_VISUALS: Record<NotificationType, TypeVisual> = {
  rank_up: { Icon: ArrowUp, tint: "bg-gold/15", ring: "border-gold/30", iconColor: "text-gold" },
  rank_down: { Icon: ArrowDown, tint: "bg-red-alert/15", ring: "border-red-alert/30", iconColor: "text-red-alert" },
  perfect_pick: { Icon: Target, tint: "bg-turf/15", ring: "border-turf/30", iconColor: "text-turf" },
  last_place: { Icon: Frown, tint: "bg-bg-elevated", ring: "border-border-subtle", iconColor: "text-text-muted" },
  polla_finished: { Icon: Trophy, tint: "bg-gold/15", ring: "border-gold/30", iconColor: "text-gold" },
  polla_started: { Icon: Flag, tint: "bg-bg-elevated", ring: "border-border-subtle", iconColor: "text-text-secondary" },
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return "ahora";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `hace ${d} d`;
  return new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
}

export interface AvisosListProps {
  initialItems: AvisoItem[];
  initialUnread: number;
}

export function AvisosList({ initialItems, initialUnread }: AvisosListProps) {
  const router = useRouter();
  const [items, setItems] = useState<AvisoItem[]>(initialItems);
  const [unread, setUnread] = useState<number>(initialUnread);
  const [, startTransition] = useTransition();

  async function markRead(id: string) {
    // Optimistic: flip locally first so the UI is instant.
    setItems((prev) =>
      prev.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n)),
    );
    setUnread((u) => Math.max(0, u - 1));
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data?.unread === "number") setUnread(data.unread);
      }
    } catch {
      // Silent — next page load resyncs.
    }
    startTransition(() => router.refresh());
  }

  async function markAll() {
    setItems((prev) =>
      prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })),
    );
    setUnread(0);
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      /* silent */
    }
    startTransition(() => router.refresh());
  }

  return (
    <>
      {/* Header row: Bell + title + mark-all */}
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="relative w-10 h-10 rounded-full bg-bg-elevated border border-border-subtle grid place-items-center">
            <Bell className="w-5 h-5 text-gold" strokeWidth={2} aria-hidden="true" />
            {unread > 0 ? (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-red-alert text-white text-[10px] font-bold leading-[16px] text-center border-[2px] border-bg-base">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </div>
          <h1 className="font-display text-[26px] tracking-[0.06em] uppercase text-text-primary leading-none">
            Avisos
          </h1>
        </div>
        {unread > 0 ? (
          <button
            type="button"
            onClick={markAll}
            className="flex items-center gap-1 font-body text-[11px] font-semibold tracking-[0.06em] uppercase text-text-muted hover:text-gold transition-colors"
          >
            <Check className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden="true" />
            Leer todas
          </button>
        ) : null}
      </header>

      {/* Feed */}
      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((n) => (
            <Aviso key={n.id} item={n} onMarkRead={markRead} />
          ))}
        </ul>
      )}
    </>
  );
}

function Aviso({
  item,
  onMarkRead,
}: {
  item: AvisoItem;
  onMarkRead: (id: string) => void;
}) {
  const visual = TYPE_VISUALS[item.type];
  const unread = !item.read_at;
  const href = item.polla ? `/pollas/${item.polla.slug}` : null;

  const content = (
    <div
      className={
        "flex items-start gap-3 p-3 rounded-lg border transition-colors " +
        (unread
          ? "bg-bg-card border-gold/25"
          : "bg-bg-card border-border-subtle")
      }
    >
      {/* Icon well — or rival pollito for rank_down */}
      {item.type === "rank_down" && item.actor?.avatar_url ? (
        <div className="relative w-10 h-10 rounded-full overflow-hidden flex-shrink-0 bg-bg-elevated">
          <Image
            src={getPollitoBase(item.actor.avatar_url)}
            alt=""
            width={40}
            height={40}
            className="object-cover w-full h-full"
          />
        </div>
      ) : (
        <div
          className={
            "relative w-10 h-10 rounded-full grid place-items-center flex-shrink-0 border " +
            visual.tint +
            " " +
            visual.ring
          }
        >
          <visual.Icon className={"w-5 h-5 " + visual.iconColor} strokeWidth={2} aria-hidden="true" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="font-body text-[13px] font-semibold text-text-primary leading-tight">
            {item.title}
          </p>
          <span className="font-body text-[10px] text-text-muted flex-shrink-0 pt-0.5">
            {timeAgo(item.created_at)}
          </span>
        </div>
        {item.body ? (
          <p className="font-body text-[11.5px] text-text-secondary mt-0.5 leading-snug">
            {item.body}
          </p>
        ) : null}
      </div>

      {unread ? (
        <span
          aria-label="Sin leer"
          className="w-2 h-2 rounded-full bg-gold flex-shrink-0 mt-1"
        />
      ) : null}
    </div>
  );

  if (href) {
    return (
      <li>
        <Link
          href={href}
          onClick={() => {
            if (unread) onMarkRead(item.id);
          }}
          className="block"
        >
          {content}
        </Link>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          if (unread) onMarkRead(item.id);
        }}
        className="block w-full text-left"
      >
        {content}
      </button>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="mt-8 flex flex-col items-center text-center gap-3 px-6">
      <div className="relative w-24 h-24">
        <Image
          src={getPollitoBase(null)}
          alt=""
          fill
          sizes="96px"
          className="object-contain"
        />
      </div>
      <p className="font-body text-[13px] text-text-secondary max-w-[240px]">
        Todavía no hay avisos. Cuando pase algo en tus pollas lo ves acá.
      </p>
    </div>
  );
}

export default AvisosList;
