"use client";

// app/(app)/admin/page.tsx — panel de administración, versión corta.
//
// (2026-09-02) La página tenía 1020 líneas y casi todas medían el producto
// viejo: las pollas entre amigos y el Mundial, que ya terminó. Se dejó lo que
// se mira de verdad — tres números y el acceso al panel de la casa — más el
// bloque para dar y quitar el acceso de administrador, que hasta hoy solo se
// podía hacer corriendo SQL a mano.
//
// SE DEJARON DE IMPORTAR (ningún archivo se borró; revivir uno es volver a
// escribir su <Card /> acá):
//   · components/admin/KnockoutStatusCard      — brackets del Mundial
//   · components/admin/ScoringSurveyCard       — encuesta goles_v2 (mig. 072)
//   · components/admin/DoublePointsSurveyCard  — encuesta doble octavos (074)
//   · components/admin/KnockoutModeCard        — modo de 120 minutos (mig. 077)
//   · components/admin/EngagementCard          — actividad de pollas P2P
//   · components/admin/WebAnalyticsCard        — PostHog
//   · components/admin/SentryHealthCard        — Sentry
//   · components/admin/PayoutsByPolla          — pagos de las pollas viejas
//   · components/admin/UserDetailModal         — ficha de usuario
// Y con ellos los bloques de Twilio (costo y top números), plantillas de
// WhatsApp, uso de la API de Claude, analítica de logins, ubicación y
// dispositivos, y las listas de usuarios y pollas con botón de eliminar.
// Sus endpoints (/api/admin/twilio-usage, analytics, engagement, etc.) siguen
// en pie y sin cambios.
//
// Las pantallas internas que perdieron su enlace siguen funcionando por URL
// directa: /admin/discrepancias, /admin/matches y /admin/payment-proofs.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Search, ShieldCheck } from "lucide-react";
import { HeroFrame, Label, SectionHead } from "@/components/street";
import { useToast } from "@/components/ui/Toast";

interface Metricas {
  usuarios: number;
  pollasCreadas: number;
  pollasConInscritos: number;
}

interface Persona {
  id: string;
  display_name: string;
  is_admin?: boolean;
}

export default function AdminPage() {
  const { showToast } = useToast();

  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [admins, setAdmins] = useState<Persona[] | null>(null);
  const [yoId, setYoId] = useState<string | null>(null);

  const [termino, setTermino] = useState("");
  const [resultados, setResultados] = useState<Persona[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState<string | null>(null);

  const cargarAdmins = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/promote");
      if (!r.ok) throw new Error("no se pudo leer la lista");
      const j = await r.json();
      setAdmins(j.admins ?? []);
      setYoId(j.yoId ?? null);
    } catch {
      setAdmins([]);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/overview");
        if (r.ok) setMetricas(await r.json());
      } catch {
        // El bloque de números se queda en su estado vacío. No vale la pena
        // interrumpir con un error por una cifra de referencia.
      }
    })();
    cargarAdmins();
  }, [cargarAdmins]);

  // La búsqueda espera a que la persona termine de escribir. `cancelado` evita
  // que una respuesta lenta pise el resultado de una consulta más nueva.
  useEffect(() => {
    const q = termino.trim();
    if (q.length < 2) {
      setResultados([]);
      setBuscando(false);
      return;
    }
    let cancelado = false;
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/admin/promote?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        if (!cancelado) setResultados(j.resultados ?? []);
      } catch {
        if (!cancelado) setResultados([]);
      } finally {
        if (!cancelado) setBuscando(false);
      }
    }, 300);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [termino]);

  async function cambiarAcceso(persona: Persona, isAdmin: boolean) {
    setGuardando(persona.id);
    try {
      const r = await fetch("/api/admin/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: persona.id, isAdmin }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showToast(j.error ?? "No se pudo guardar el cambio.", "error");
        return;
      }
      const nombre = persona.display_name || "El usuario";
      showToast(
        isAdmin
          ? `${nombre} ya es administrador.`
          : `${nombre} dejó de ser administrador.`,
        "success",
      );
      await cargarAdmins();
      // La lista de búsqueda refleja el estado nuevo sin repetir la consulta.
      setResultados((prev) =>
        prev.map((p) => (p.id === persona.id ? { ...p, is_admin: isAdmin } : p)),
      );
    } catch {
      // Sin este catch, un fallo de RED (no de status, ese ya esta cubierto)
      // dejaba la promesa sin manejar: el boton volvia de "Quitando..." a
      // "Quitar" y parecia que no habia pasado nada.
      showToast("Se cayó la conexión. Intenta otra vez.", "error");
    } finally {
      setGuardando(null);
    }
  }

  const filas = [
    {
      clave: "usuarios",
      etiqueta: "Usuarios registrados",
      valor: metricas?.usuarios,
      nota: null as string | null,
    },
    {
      clave: "creadas",
      etiqueta: "Pollas creadas",
      valor: metricas?.pollasCreadas,
      nota: "Sin contar los borradores.",
    },
    {
      clave: "inscritos",
      etiqueta: "Pollas con inscritos",
      valor: metricas?.pollasConInscritos,
      // El dueño pidió "pollas visitadas". No hay analítica de páginas en el
      // proyecto, así que las visitas no se pueden medir; se muestra el dato
      // que sí existe y se aclara en la pantalla, para que nadie lo lea como
      // otra cosa.
      nota: "No medimos visitas. Son las pollas con al menos una inscripción pagada.",
    },
  ];

  return (
    <div className="pb-28">
      <HeroFrame height="h-[150px]">
        <Link
          href="/casa"
          className="mb-3 inline-flex items-center gap-2 text-text-secondary transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="text-[13px]">Volver</span>
        </Link>
        <Label>Panel</Label>
        <h1 className="lp-display mt-1 text-[34px]">Administración</h1>
      </HeroFrame>

      <div className="px-4 pt-5">
        {/* El panel de la casa es donde se opera de verdad: se crean las
            pollas y se revisan los comprobantes. Es el único acento de la
            pantalla. */}
        <div className="mb-9 bg-bg-card p-4">
          <p className="text-[14px] text-text-primary">Panel de la casa</p>
          <p className="mt-1 text-[12px] text-text-muted">
            Crear pollas, revisar comprobantes y ver el acumulado.
          </p>
          <Link href="/casa/admin" className="lp-btn lp-btn-primary mt-4 w-full">
            Ir al panel de la casa
          </Link>
        </div>

        <SectionHead title="Resumen" />
        <ul className="mb-9 space-y-px">
          {filas.map((f) => (
            <li key={f.clave} className="flex items-start gap-4 bg-bg-card p-4">
              <span className="min-w-0 flex-1">
                <Label>{f.etiqueta}</Label>
                {f.nota ? (
                  <span className="mt-1 block text-[11px] leading-snug text-text-muted">
                    {f.nota}
                  </span>
                ) : null}
              </span>
              <span className="lp-money shrink-0 text-[30px] text-text-primary">
                {f.valor == null ? "—" : f.valor}
              </span>
            </li>
          ))}
        </ul>

        <SectionHead
          title="Administradores"
          meta={admins ? `${admins.length}` : undefined}
        />

        {admins === null ? (
          <p className="bg-bg-card p-4 text-[13px] text-text-muted">
            Cargando administradores...
          </p>
        ) : (
          <ul className="space-y-px">
            {admins.map((a) => {
              const soyYo = a.id === yoId;
              // Sin estas dos condiciones la aplicación se puede quedar sin
              // nadie que entre al panel, y eso solo se arregla con SQL. El
              // endpoint las repite: esto es la pantalla, no la defensa.
              const puedeQuitar = !soyYo && admins.length > 1;
              return (
                <li key={a.id} className="flex items-center gap-3 bg-bg-card p-4">
                  <ShieldCheck
                    className="h-4 w-4 shrink-0 text-text-muted"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-text-primary">
                      {a.display_name || "Sin nombre"}
                    </span>
                    {soyYo ? <Label className="mt-0.5">Tu cuenta</Label> : null}
                  </span>
                  {puedeQuitar ? (
                    <button
                      type="button"
                      onClick={() => cambiarAcceso(a, false)}
                      disabled={guardando === a.id}
                      className="lp-btn lp-btn-ghost shrink-0 px-4 text-[13px]"
                    >
                      {guardando === a.id ? "Quitando..." : "Quitar"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-2 text-[11px] leading-snug text-text-muted">
          No puedes quitarte el acceso a ti mismo ni dejar la aplicación sin
          administradores.
        </p>

        <div className="mt-6">
          <label htmlFor="buscar-usuario" className="lp-label mb-2 block">
            Buscar un usuario
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
              aria-hidden="true"
            />
            <input
              id="buscar-usuario"
              type="text"
              value={termino}
              onChange={(e) => setTermino(e.target.value)}
              placeholder="Nombre del usuario"
              autoComplete="off"
              className="lp-input pl-11"
            />
          </div>

          <div className="mt-2">
            {termino.trim().length < 2 ? (
              <p className="text-[11px] text-text-muted">
                Escribe al menos 2 letras del nombre.
              </p>
            ) : buscando ? (
              <p className="text-[11px] text-text-muted">Buscando...</p>
            ) : resultados.length === 0 ? (
              <p className="text-[11px] text-text-muted">
                Ningún usuario con ese nombre.
              </p>
            ) : (
              <ul className="space-y-px">
                {resultados.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 bg-bg-card p-4">
                    <span className="min-w-0 flex-1 truncate text-[14px] text-text-primary">
                      {p.display_name || "Sin nombre"}
                    </span>
                    {p.is_admin ? (
                      <span className="lp-label shrink-0">Ya es admin</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => cambiarAcceso(p, true)}
                        disabled={guardando === p.id}
                        className="lp-btn lp-btn-ghost shrink-0 px-4 text-[13px]"
                      >
                        {guardando === p.id ? "Guardando..." : "Hacer admin"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
