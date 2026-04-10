// components/polla/PollaCard.tsx — Tarjeta de polla con diseño "estadio de noche"
// Border-left gold si admin, bg-card con hover, badges de torneo/estado/pago
interface PollaCardProps {
  polla: {
    id: string;
    name: string;
    slug: string;
    description?: string;
    tournament: string;
    status: string;
    buy_in_amount: number;
    currency: string;
    payment_mode: string;
    type: string;
  };
  participantCount?: number;
  myPoints?: number;
  myRank?: number;
  isAdmin?: boolean;
}

const TOURNAMENT_LABELS: Record<string, string> = {
  worldcup_2026: "🌍 Mundial 26",
  champions_2025: "⭐ Champions",
  liga_betplay_2025: "🇨🇴 BetPlay",
};

const PAYMENT_LABELS: Record<string, string> = {
  honor: "🤝 Honor",
  admin_collects: "💰 Admin",
  digital_pool: "📲 Digital",
};

export default function PollaCard({
  polla,
  participantCount,
  myPoints,
  myRank,
  isAdmin,
}: PollaCardProps) {
  return (
    <a
      href={`/pollas/${polla.slug}`}
      className="block rounded-2xl transition-all duration-150 hover:bg-bg-card-hover"
      style={{
        backgroundColor: "var(--bg-card)",
        border: "1px solid var(--border-subtle)",
        borderLeft: isAdmin
          ? "3px solid var(--gold)"
          : "3px solid var(--border-medium)",
      }}
    >
      <div className="p-4">
        {/* Top row: name + tournament badge */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="font-semibold text-[16px] text-text-primary truncate">
                {polla.name}
              </h3>
              {isAdmin && (
                <span className="text-[10px] bg-gold text-bg-base px-1.5 py-0.5 rounded font-semibold flex-shrink-0">
                  Admin
                </span>
              )}
            </div>
            {polla.description && (
              <p className="text-text-muted text-xs line-clamp-1">
                {polla.description}
              </p>
            )}
          </div>
          <span className="text-text-muted text-lg flex-shrink-0">→</span>
        </div>

        {/* Badge row */}
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span
            className="text-[11px] px-2 py-0.5 rounded-full font-medium"
            style={{
              backgroundColor: "var(--bg-card-elevated)",
              color: "var(--text-secondary)",
            }}
          >
            {TOURNAMENT_LABELS[polla.tournament] || `⚽ ${polla.tournament}`}
          </span>
          <span
            className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
              polla.status === "active"
                ? "bg-green-dim text-green-live"
                : "bg-bg-elevated text-text-muted"
            }`}
          >
            {polla.status === "active" ? "Activa" : "Terminada"}
          </span>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-3 text-xs text-text-muted">
          {participantCount !== undefined && (
            <span>👥 {participantCount}</span>
          )}
          {polla.buy_in_amount > 0 && (
            <span>
              💰{" "}
              {new Intl.NumberFormat("es-CO", {
                style: "currency",
                currency: polla.currency || "COP",
                maximumFractionDigits: 0,
              }).format(polla.buy_in_amount)}
            </span>
          )}
          <span>
            {PAYMENT_LABELS[polla.payment_mode] || polla.payment_mode}
          </span>
          <span>{polla.type === "closed" ? "🔒" : "🌐"}</span>
        </div>

        {/* My rank */}
        {myRank !== undefined && myRank !== null && (
          <div
            className="mt-2 rounded-lg px-3 py-1.5 flex items-center justify-between"
            style={{
              backgroundColor: "var(--gold-dim)",
              border: "1px solid var(--border-gold)",
            }}
          >
            <span className="text-xs font-medium text-gold">
              Tu posición: #{myRank}
            </span>
            <span className="text-xs font-bold text-gold">
              {myPoints ?? 0} pts
            </span>
          </div>
        )}
      </div>
    </a>
  );
}
