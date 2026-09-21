// e2e/traduccion.spec.ts — que el traductor del navegador no tumbe la app.
//
// El 21-sep-2026 alguien entró desde un Android en portugués: Chrome tradujo
// la página, y al pasar de «tu número» a «ingresa tu código» React se cayó con
// `NotFoundError: Failed to execute 'insertBefore' on 'Node'`. La persona veía
// «Algo salió mal» aunque el SMS sí le llegaba, una y otra vez.
//
// El traductor reemplaza cada nodo de texto por `<font><font>…</font></font>`,
// así que los nodos que React guardó dejan de ser hijos de su padre. Acá se
// simula esa misma reescritura y se comprueba que las dos operaciones que
// fallaban ahora aguantan (lib/dom/traduccion-segura.ts, cableado en el <head>
// de app/layout.tsx para correr ANTES de la hidratación).

import { test, expect } from "@playwright/test";

/** Reescribe el DOM como lo hace Google Translate. Devuelve cuántos nodos tocó. */
const TRADUCIR = () => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodos: Text[] = [];
  while (walker.nextNode()) {
    const n = walker.currentNode as Text;
    if (n.nodeValue && n.nodeValue.trim()) nodos.push(n);
  }
  for (const nodo of nodos) {
    const fuera = document.createElement("font");
    const dentro = document.createElement("font");
    dentro.appendChild(document.createTextNode(nodo.nodeValue ?? ""));
    fuera.appendChild(dentro);
    nodo.parentNode?.replaceChild(fuera, nodo);
  }
  return nodos.length;
};

test.describe("página traducida por el navegador", () => {
  test("el login sobrevive a que el traductor reemplace los textos", async ({ page }) => {
    const fallos: string[] = [];
    page.on("pageerror", (e) => fallos.push(String(e)));

    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("lp_welcome_seen_v1", "1");
      } catch {
        /* modo incógnito */
      }
    });
    await page.goto("/login");
    await page.waitForSelector('input[type="tel"]');

    expect(await page.evaluate(TRADUCIR)).toBeGreaterThan(0);

    // Las dos operaciones exactas con las que React se caía sobre un texto ya
    // traducido: insertar antes de un nodo que dejó de ser hijo, y quitar un
    // hijo que el traductor movió dentro de su propio <font>.
    const resultado = await page.evaluate(() => {
      const padre = document.createElement("div");
      const texto = document.createTextNode("hola");
      padre.appendChild(texto);
      document.body.appendChild(padre);

      // El traductor envuelve el texto: `texto` ya no cuelga de `padre`.
      const envoltura = document.createElement("font");
      padre.replaceChild(envoltura, texto);
      envoltura.appendChild(texto);

      const nuevo = document.createElement("span");
      nuevo.textContent = "nuevo";
      let insertOk = true;
      try {
        padre.insertBefore(nuevo, texto);
      } catch {
        insertOk = false;
      }

      let removeOk = true;
      try {
        padre.removeChild(texto);
      } catch {
        removeOk = false;
      }

      const salida = {
        insertOk,
        removeOk,
        nuevoEnElDom: nuevo.parentNode === padre,
        textoFuera: texto.parentNode === null,
      };
      padre.remove();
      return salida;
    });

    expect(resultado.insertOk, "insertBefore con el nodo ya traducido no puede lanzar").toBe(true);
    expect(resultado.removeOk, "removeChild con el nodo ya traducido no puede lanzar").toBe(true);
    expect(resultado.nuevoEnElDom, "el nodo nuevo igual tiene que quedar en pantalla").toBe(true);
    expect(resultado.textoFuera, "el nodo que se quita no puede quedarse pegado").toBe(true);

    // La app sigue en pie: nada de «Algo salió mal» ni errores sin atrapar.
    await expect(page.locator('input[type="tel"]')).toBeVisible();
    await expect(page.getByText("Algo salió mal")).toHaveCount(0);
    expect(fallos, `errores de JS: ${fallos.join(" | ")}`).toHaveLength(0);
  });
});
