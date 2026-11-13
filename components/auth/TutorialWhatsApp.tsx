"use client";

// Tutorial obligatorio del ingreso por WhatsApp (2026-11-13). Mismo diseño A
// que aprobó el dueño para Los Del Sur, con la marca de La Polla.
//
// Por qué: la gente abría el chat del bot y no enviaba el mensaje ya escrito,
// o no tocaba el botón de la respuesta. La primera vez en cada celular, antes
// de abrir WhatsApp, se animan los tres toques reales y «Abrir WhatsApp» se
// activa solo al terminar una vuelta completa. El celular lo recuerda cuando
// la persona abre WhatsApp desde aquí; si el almacenamiento falla, el tutorial
// vuelve a salir (nunca bloquea el ingreso).
//
// Los tres toques son los del flujo de verdad:
//   1. ENVIAR el mensaje prellenado (lib/auth/whatsapp-login.ts).
//   2. «Haz clic para entrar» en la respuesta del bot (cta_url de Zernio).
//   3. «Entrar a La Polla» en /login/whatsapp.
//
// La maqueta imita la interfaz de WhatsApp, por eso sus colores van en CSS
// propio y no en tokens del sistema. Solo anima transform/opacity; con
// «reducir movimiento» las escenas cambian igual, sin dedo ni anillo.

import { useEffect, useRef, useState } from "react";

const CLAVE_VISTO = "lp_wa_tutorial_visto";
const PASO_MS = 2600;
const PASOS = ["ENVÍA EL MENSAJE", "TOCA «HAZ CLIC PARA ENTRAR»", "YA ESTÁS ADENTRO"] as const;
const PASOS_EN = ["SEND THE MESSAGE", "TAP «HAZ CLIC PARA ENTRAR»", "YOU'RE IN"] as const;
/** El mismo texto que lleva el enlace wa.me (lib/auth/whatsapp-login.ts). */
const MENSAJE = "dame el link para entrar a la polla";

export function tutorialWhatsAppVisto(): boolean {
  try { return window.localStorage.getItem(CLAVE_VISTO) === "1"; } catch { return false; }
}

export function marcarTutorialWhatsAppVisto(): void {
  try { window.localStorage.setItem(CLAVE_VISTO, "1"); } catch { /* sale otra vez la próxima */ }
}

const CSS = `
@keyframes lp-wat-tap{0%{transform:scale(.3);opacity:0}25%{opacity:.95}100%{transform:scale(1.7);opacity:0}}
@keyframes lp-wat-dedo{0%{transform:translate(22px,26px);opacity:0}35%{transform:translate(0,0);opacity:1}55%{transform:translate(0,0) scale(.9)}70%,100%{transform:translate(0,0) scale(1);opacity:1}}
@keyframes lp-wat-entra{0%{transform:translateY(10px);opacity:0}100%{transform:translateY(0);opacity:1}}
@keyframes lp-wat-llena{0%{transform:scaleX(0)}100%{transform:scaleX(1)}}
@keyframes lp-wat-check{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.1);opacity:1}100%{transform:scale(1);opacity:1}}
@keyframes lp-wat-hunde{0%,40%{transform:scale(1)}50%{transform:scale(.95)}60%,100%{transform:scale(1)}}
.lp-wat-anillo{position:absolute;width:40px;height:40px;border-radius:50%;border:3px solid rgb(var(--whatsapp-rgb));animation:lp-wat-tap 1.1s ease-out .9s 2 both;pointer-events:none}
.lp-wat-dedo{position:absolute;width:20px;height:20px;border-radius:50%;background:rgba(255,255,255,.92);box-shadow:0 2px 10px rgba(0,0,0,.5);animation:lp-wat-dedo 1.2s cubic-bezier(.22,1,.36,1) .2s both;pointer-events:none}
.lp-wat-entra{animation:lp-wat-entra .45s cubic-bezier(.22,1,.36,1) both}
.lp-wat-llena{transform-origin:left;animation:lp-wat-llena ${PASO_MS}ms linear both}
.lp-wat-check{animation:lp-wat-check .45s cubic-bezier(.22,1,.36,1) 1.5s both}
.lp-wat-hunde{animation:lp-wat-hunde 1.4s ease .3s both}
.lp-wat-pantalla{background:#0b141a}
.lp-wat-cabecera{background:#1f2c34}
.lp-wat-caja{background:#2a3942}
.lp-wat-enviado{background:#005c4b}
.lp-wat-recibido{background:#1f2c34}
.lp-wat-enlace{color:#53bdeb}
@media (prefers-reduced-motion: reduce){.lp-wat *{animation:none!important}.lp-wat .lp-wat-anillo,.lp-wat .lp-wat-dedo{display:none}}
`;

function CabeceraChat() {
  return (
    <div className="lp-wat-cabecera flex h-11 flex-none items-center gap-2 px-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/pollitos/logo_realistic-192.webp" alt="" width={28} height={28} className="h-7 w-7 max-w-none shrink-0 rounded-full bg-bg-elevated object-contain" />
      <div className="flex min-w-0 flex-col leading-[1.1]">
        <span className="truncate text-[13px] font-bold text-white">La Polla</span>
        <span className="truncate text-[11px] text-white/60">WhatsApp</span>
      </div>
    </div>
  );
}

function Escena({ paso }: { paso: number }) {
  if (paso === 0) return (
    <div className="absolute inset-0 flex flex-col">
      <CabeceraChat />
      <div className="flex-1" />
      <div className="flex items-center gap-1.5 p-2">
        <div className="lp-wat-entra lp-wat-caja flex min-h-9 min-w-0 flex-1 items-center rounded-[20px] px-3 py-1.5 text-[13px] font-semibold leading-tight text-white">{MENSAJE}</div>
        <div className="relative h-10 w-10 flex-none">
          <div className="lp-wat-hunde grid h-10 w-10 place-items-center rounded-full bg-whatsapp">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
          </div>
          <div className="lp-wat-anillo" style={{ left: 0, top: 0 }} />
          <div className="lp-wat-dedo" style={{ left: 10, top: 10 }} />
        </div>
      </div>
    </div>
  );
  if (paso === 1) return (
    <div className="absolute inset-0 flex flex-col">
      <CabeceraChat />
      <div className="flex flex-1 flex-col justify-end gap-2 p-2.5">
        <div className="lp-wat-enviado max-w-[85%] self-end rounded-[12px_12px_2px_12px] px-2.5 py-1.5 text-[13px] font-semibold leading-tight text-white">{MENSAJE}</div>
        <div className="lp-wat-entra lp-wat-recibido w-[90%] self-start overflow-hidden rounded-[12px_12px_12px_2px]" style={{ animationDelay: ".25s" }}>
          <div className="px-2.5 py-2 text-[12px] font-semibold leading-snug text-white">Haz clic aquí para entrar a La Polla.</div>
          <div className="lp-wat-enlace relative flex h-9 items-center justify-center gap-1.5 border-t border-white/10 text-[13px] font-bold">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
            Haz clic para entrar
            <div className="lp-wat-anillo" style={{ left: "50%", top: -2, marginLeft: -20, animationDelay: "1.2s" }} />
            <div className="lp-wat-dedo" style={{ left: "50%", top: 8, marginLeft: -10, animationDelay: ".7s" }} />
          </div>
        </div>
      </div>
    </div>
  );
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg-base p-4">
      <p className="font-display text-xl leading-none tracking-wide text-gold">CONFIRMA TU INGRESO</p>
      <div className="relative w-full">
        <div className="lp-wat-hunde grid h-11 place-items-center rounded-xl bg-gold text-[14px] font-bold text-bg-base">Entrar a La Polla</div>
        <div className="lp-wat-anillo" style={{ left: "50%", top: 2, marginLeft: -20 }} />
        <div className="lp-wat-dedo" style={{ left: "50%", top: 12, marginLeft: -10 }} />
      </div>
      <div className="lp-wat-check absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-bg-base">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-turf">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
        </div>
        <p className="font-display text-2xl tracking-wide text-text-primary">¡ADENTRO!</p>
      </div>
    </div>
  );
}

/** Los tres pasos animados. `onListo` se dispara una vez, al terminar la primera vuelta. */
export function TutorialWhatsApp({ onListo, en = false }: { onListo: () => void; en?: boolean }) {
  const [paso, setPaso] = useState(0);
  const listoRef = useRef(onListo);
  useEffect(() => { listoRef.current = onListo; }, [onListo]);

  useEffect(() => {
    let vueltas = 0;
    const timer = window.setInterval(() => {
      vueltas += 1;
      setPaso(vueltas % PASOS.length);
      if (vueltas === PASOS.length) listoRef.current();
    }, PASO_MS);
    return () => window.clearInterval(timer);
  }, []);

  const textos = en ? PASOS_EN : PASOS;
  return (
    <div className="lp-wat" data-tutorial-whatsapp data-paso={paso + 1}>
      <style>{CSS}</style>
      {/* Maqueta decorativa: el texto de abajo lleva el mismo paso para lectores de pantalla. */}
      <div aria-hidden="true" className="mx-auto w-[min(232px,64vw)] rounded-[28px] bg-bg-elevated p-2 shadow-[inset_0_0_0_2px_rgba(255,255,255,0.14),0_18px_50px_rgba(0,0,0,0.6)]" style={{ height: "min(300px, 36dvh)", minHeight: 210 }}>
        <div className="lp-wat-pantalla relative h-full w-full overflow-hidden rounded-[21px]">
          <Escena key={paso} paso={paso} />
        </div>
      </div>
      <div aria-hidden="true" className="mt-3.5 grid grid-cols-3 gap-1.5">
        {PASOS.map((_, i) => (
          <div key={i} className="h-1 overflow-hidden rounded-full bg-white/[0.18]">
            {i < paso && <div className="h-full w-full bg-gold" />}
            {i === paso && <div key={`activa-${paso}`} className="lp-wat-llena h-full w-full bg-gold" />}
          </div>
        ))}
      </div>
      <div className="mt-3 flex min-h-[34px] items-center gap-3" aria-live="polite">
        <span aria-hidden="true" className="grid min-h-[34px] min-w-[34px] flex-none place-items-center rounded-full px-1 bg-whatsapp font-display text-lg leading-none text-bg-base">{paso + 1}</span>
        <p className="min-w-0 text-[17px] font-bold leading-tight text-text-primary [overflow-wrap:anywhere]">
          <span className="sr-only">{en ? `Step ${paso + 1} of 3: ` : `Paso ${paso + 1} de 3: `}</span>{textos[paso]}
        </p>
      </div>
    </div>
  );
}
