import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * (2026-09-18, migración 142) Con premio en objeto el empate no se sortea: gana
 * quien se registró primero. Ese dato decide la polla, así que la tabla lo
 * muestra en público, debajo de cada participación.
 *
 * Con `scoring_mode='marcador'` y solo el marcador exacto sumando, el empate
 * arriba es lo normal: OFIGOLAZO (43 inscritos) terminó con tres personas
 * empatadas en el primer puesto.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { PollaTabs } from "@/components/casa/PollaTabs";
import type { CasaLeaderboardRow } from "@/lib/casa/types";

const rows: CasaLeaderboardRow[] = [
  {
    entry_id: "e1", user_id: "u1", display_name: "Marlon", avatar_url: "millos",
    points: 3, aciertos: 1, puesto: 1, registered_at: "2026-09-15T20:37:22.548Z",
  },
  {
    entry_id: "e2", user_id: "u2", display_name: "Queso", avatar_url: "junior",
    points: 3, aciertos: 1, puesto: 1, registered_at: "2026-09-16T03:00:44.543Z",
  },
];

const render = (tiebreakByRegistration: boolean) => renderToStaticMarkup(createElement(PollaTabs, {
  slug: "polla-regalo", firstLabel: "Partidos", initialRows: rows,
  entryStatus: null, pollaStatus: "abierta" as const, userId: "u1",
  tiebreakByRegistration, children: null,
}));

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("fecha de registro en la tabla", () => {
  it("la muestra para cada participación cuando el premio es un objeto", () => {
    const html = text(render(true));
    // Hora de Colombia (UTC-5), nunca UTC: 20:37 UTC son las 3:37 p. m. acá, y
    // las 03:00 UTC del 16 son las 10:00 p. m. del 15 — el día también cambia.
    expect(html).toContain("Se registró el 15/09/2026, 3:37 p. m.");
    expect(html).toContain("Se registró el 15/09/2026, 10:00 p. m.");
  });

  it("no la muestra en las pollas de dinero, donde el empate se reparte", () => {
    expect(text(render(false))).not.toContain("Se registró el");
  });

  it("deja el dato dentro de la celda del jugador, no en una columna nueva", () => {
    // Una columna más rompería la tabla en 320 px; va bajo el nombre, como el
    // premio provisional de la migración 133.
    const html = render(true);
    expect((html.match(/<th scope="col"/g) ?? [])).toHaveLength(3);
    expect(html).toMatch(/Marlon[\s\S]{0,400}Se registró el/);
  });
});
