// components/admin/UserDetailModal.tsx
//
// Modal del admin dashboard que muestra el detalle completo de un user
// (whatsapp, email, login events, pollas, stats). Read-only.
//
// Se abre cuando el admin clickea una fila de la card "Usuarios" en
// /admin. Bate al endpoint /api/admin/users/[id]/detail al abrir.

"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { X, Phone, Mail, MapPin, Smartphone, Trophy, Banknote, Calendar, Hash, Eye, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { needsName } from "@/lib/users/needs-name";
import UserPayoutsPreview from "@/components/admin/UserPayoutsPreview";

interface LoginEvent {
  at: string;
  method: string | null;
  device: string | null;
  city: string | null;
  country: string | null;
}

interface PollaSummary {
  pollaId: string;
  pollaSlug: string | null;
  pollaName: string;
  pollaStatus: string;
  tournament: string;
  role: string;
  status: string;
  paid: boolean;
  totalPoints: number;
  rank: number | null;
  joinedAt: string;
}

interface DetailPayload {
  profile: {
    id: string;
    displayName: string | null;
    whatsapp: string | null;
    whatsappVerified: boolean | null;
    email: string | null;
    avatarUrl: string | null;
    avatarEmoji: string | null;
    isAdmin: boolean;
    createdAt: string;
    defaultPayout: {
      method: string | null;
      account: string | null;
      accountName: string | null;
      accountType: string | null;
      setAt: string | null;
    };
  };
  stats: {
    totalPoints: number;
    pollasCount: number;
    predictionsCount: number;
  };
  logins: LoginEvent[];
  pollas: PollaSummary[];
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function UserDetailModal({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewingPayouts, setPreviewingPayouts] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get<DetailPayload>(
          `/api/admin/users/${userId}/detail`,
        );
        if (!cancelled) {
          setData(res.data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          const msg =
            (err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error ?? "No se pudo cargar el usuario";
          setError(msg);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center px-4 py-6 bg-black/55 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-bg-card border border-gold/15 rounded-2xl p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#0e1420" }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 text-text-muted hover:text-text-primary p-1"
          aria-label="Cerrar"
        >
          <X className="w-5 h-5" />
        </button>

        {loading ? (
          <div className="py-10 text-center">
            <p className="text-xs text-text-muted">Cargando…</p>
          </div>
        ) : error ? (
          <div className="py-10 text-center">
            <p className="text-xs text-red-alert">{error}</p>
          </div>
        ) : !data ? null : (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 mb-4 pr-6">
              <div className="w-12 h-12 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center text-2xl flex-shrink-0">
                {data.profile.avatarEmoji ?? "🐥"}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-bold text-text-primary truncate">
                  {data.profile.displayName ?? "Sin nombre"}
                  {data.profile.isAdmin ? (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-gold bg-gold/10 px-1.5 py-0.5 rounded">
                      admin
                    </span>
                  ) : null}
                </h2>
                <p className="text-[11px] text-text-muted">
                  Registrado · {fmtDate(data.profile.createdAt)}
                </p>
              </div>
            </div>

            {/* Avisos: si el user no tiene nombre real, va a ver el
                onboarding obligatorio en cuanto entre a la app. */}
            {needsName(data.profile.displayName) ? (
              <div className="mb-4 rounded-lg p-2.5 flex items-start gap-2 bg-red-alert/10 border border-red-alert/30">
                <AlertTriangle className="w-4 h-4 text-red-alert flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-[12px] text-red-alert font-semibold">
                    Onboarding obligatorio pendiente
                  </p>
                  <p className="text-[11px] text-red-alert/80 mt-0.5">
                    Este usuario verá la pantalla del onboarding (¿Cómo te llamas?) antes de poder usar la app — no puede saltarla.
                  </p>
                </div>
              </div>
            ) : null}

            {/* Acciones admin */}
            <div className="mb-4">
              <button
                type="button"
                onClick={() => setPreviewingPayouts(true)}
                className="w-full flex items-center justify-center gap-1.5 text-[12px] py-2 rounded-lg bg-gold/10 border border-gold/30 text-gold hover:bg-gold/15 transition-colors"
              >
                <Eye className="w-3.5 h-3.5" />
                Ver vista de pagos de este usuario
              </button>
            </div>

            {/* Stats trio */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div
                className="rounded-lg p-2 text-center"
                style={{ background: "#131d2e" }}
              >
                <p className="text-[10px] uppercase text-text-muted">Pollas</p>
                <p className="text-base font-bold text-text-primary tabular-nums">
                  {data.stats.pollasCount}
                </p>
              </div>
              <div
                className="rounded-lg p-2 text-center"
                style={{ background: "#131d2e" }}
              >
                <p className="text-[10px] uppercase text-text-muted">Preds</p>
                <p className="text-base font-bold text-text-primary tabular-nums">
                  {data.stats.predictionsCount}
                </p>
              </div>
              <div
                className="rounded-lg p-2 text-center"
                style={{ background: "#131d2e" }}
              >
                <p className="text-[10px] uppercase text-text-muted">Pts</p>
                <p className="text-base font-bold text-gold tabular-nums">
                  {data.stats.totalPoints}
                </p>
              </div>
            </div>

            {/* Contact */}
            <section className="mb-4">
              <h3 className="text-[10px] uppercase tracking-wide text-text-muted mb-2">
                Contacto
              </h3>
              <div className="space-y-1.5 text-[12px]">
                <div className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                  <span className="text-text-primary tabular-nums">
                    {data.profile.whatsapp ?? "—"}
                  </span>
                  {data.profile.whatsappVerified ? (
                    <span className="text-[10px] text-turf">✓</span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                  <span className="text-text-primary truncate">
                    {data.profile.email ?? "—"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Hash className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                  <span className="text-text-muted text-[10px] truncate">
                    {data.profile.id}
                  </span>
                </div>
              </div>
            </section>

            {/* Cuenta de cobro */}
            {data.profile.defaultPayout.account ? (
              <section className="mb-4">
                <h3 className="text-[10px] uppercase tracking-wide text-text-muted mb-2">
                  Cuenta de cobro
                </h3>
                <div
                  className="rounded-lg p-2.5 text-[12px]"
                  style={{ background: "#131d2e" }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Banknote className="w-3.5 h-3.5 text-gold flex-shrink-0" />
                    <span className="text-text-primary capitalize">
                      {data.profile.defaultPayout.method}
                    </span>
                    {data.profile.defaultPayout.accountType ? (
                      <span className="text-[10px] text-text-muted">
                        · {data.profile.defaultPayout.accountType}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-text-primary tabular-nums truncate">
                    {data.profile.defaultPayout.account}
                  </p>
                  {data.profile.defaultPayout.accountName ? (
                    <p className="text-[11px] text-text-muted truncate">
                      {data.profile.defaultPayout.accountName}
                    </p>
                  ) : null}
                </div>
              </section>
            ) : null}

            {/* Login events */}
            <section className="mb-4">
              <h3 className="text-[10px] uppercase tracking-wide text-text-muted mb-2">
                Últimos logins ({data.logins.length})
              </h3>
              {data.logins.length === 0 ? (
                <p className="text-[11px] text-text-muted">Sin eventos.</p>
              ) : (
                <div
                  className="rounded-lg max-h-[180px] overflow-y-auto"
                  style={{ background: "#131d2e" }}
                >
                  {data.logins.map((l, i) => (
                    <div
                      key={i}
                      className="px-2.5 py-2 border-b border-white/5 last:border-0 text-[11px]"
                    >
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-text-primary">
                          <Calendar className="w-3 h-3 inline mr-1 text-text-muted" />
                          {fmtDate(l.at)}
                        </span>
                        {l.method ? (
                          <span className="text-[9px] uppercase text-gold/70 bg-gold/10 px-1 py-0.5 rounded">
                            {l.method}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2 text-text-muted">
                        {l.city || l.country ? (
                          <span className="flex items-center gap-1 truncate">
                            <MapPin className="w-3 h-3 flex-shrink-0" />
                            {[l.city, l.country].filter(Boolean).join(", ")}
                          </span>
                        ) : null}
                        {l.device ? (
                          <span className="flex items-center gap-1 truncate">
                            <Smartphone className="w-3 h-3 flex-shrink-0" />
                            {l.device}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Pollas */}
            <section>
              <h3 className="text-[10px] uppercase tracking-wide text-text-muted mb-2">
                Pollas ({data.pollas.length})
              </h3>
              {data.pollas.length === 0 ? (
                <p className="text-[11px] text-text-muted">No participa en ninguna.</p>
              ) : (
                <div
                  className="rounded-lg max-h-[200px] overflow-y-auto"
                  style={{ background: "#131d2e" }}
                >
                  {data.pollas.map((p) => (
                    <button
                      key={p.pollaId}
                      type="button"
                      onClick={() => {
                        if (!p.pollaSlug) return;
                        onClose();
                        router.push(`/pollas/${p.pollaSlug}`);
                      }}
                      disabled={!p.pollaSlug}
                      className="w-full px-2.5 py-2 border-b border-white/5 last:border-0 text-left hover:bg-white/[0.03] disabled:opacity-50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <p className="text-[12px] text-text-primary truncate flex-1">
                          {p.pollaName}
                        </p>
                        {p.rank ? (
                          <span className="text-[11px] text-gold tabular-nums flex items-center gap-0.5 flex-shrink-0">
                            <Trophy className="w-3 h-3" />#{p.rank}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[10px] text-text-muted truncate">
                        {p.pollaStatus} · {p.role} · {p.totalPoints} pts ·{" "}
                        {p.paid ? "pagado" : "pendiente"}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {previewingPayouts ? (
        <UserPayoutsPreview
          userId={userId}
          onClose={() => setPreviewingPayouts(false)}
        />
      ) : null}
    </div>
  );
}
