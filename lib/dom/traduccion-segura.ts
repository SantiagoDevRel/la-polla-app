// lib/dom/traduccion-segura.ts — que el traductor del navegador no tumbe la app.
//
// EL CASO REAL (2026-09-21, un Android en portugués): Chrome ofrece traducir
// la página y, al aceptar, REEMPLAZA cada nodo de texto por
// `<font><font>texto</font></font>`. React sigue apuntando a los nodos
// viejos, así que en el primer cambio de pantalla su `insertBefore` /
// `removeChild` apunta a un nodo que ya no es hijo de ese padre y el
// navegador lanza `NotFoundError`. Ese error sube hasta `app/global-error.tsx`
// y la persona ve «Algo salió mal» — en el login, justo al pasar de «tu
// número» a «ingresa tu código». El SMS ya había salido, así que parecía que
// el código nunca servía.
//
// EL ARREGLO: envolver los dos métodos del DOM que React usa para mover y
// quitar nodos, y que toleren el nodo desubicado en vez de lanzar. En el peor
// caso queda un texto traducido de más en pantalla; nunca una app caída.
// Se hace en el prototipo de Node porque el que muta el DOM es el traductor,
// no nuestro código: no hay un componente donde ponerlo.
//
// Va en un <script> del <head> (app/layout.tsx) porque tiene que estar en pie
// ANTES de que React hidrate: si hidrata primero, el primer re-render sobre
// texto ya traducido se cae igual.
//
// Sirve para cualquier traductor que reescriba el DOM (Chrome, el widget de
// Google Translate, los navegadores dentro de apps, extensiones), por eso NO
// se marca la app como `notranslate`: traducir sigue funcionando.

export const TRADUCCION_SEGURA_SCRIPT = [
  "(function(){",
  "if(typeof Node!=='function'||!Node.prototype)return;",
  "if(window.__lpDomSeguro)return;",
  "window.__lpDomSeguro=true;",
  "var insertar=Node.prototype.insertBefore;",
  "var quitar=Node.prototype.removeChild;",
  // El nodo de referencia ya no es hijo (el traductor lo envolvió): se agrega
  // al final en vez de lanzar. `insertar.call(this, nodo, null)` es appendChild.
  "Node.prototype.insertBefore=function(nodo,referencia){",
  "if(referencia&&referencia.parentNode!==this){return insertar.call(this,nodo,null);}",
  "return insertar.call(this,nodo,referencia);};",
  // El hijo colgó de otro padre (quedó dentro de un <font> del traductor):
  // se quita de donde esté de verdad. Si ya no está en el documento, no hay
  // nada que hacer y se devuelve tal cual.
  "Node.prototype.removeChild=function(hijo){",
  "if(hijo&&hijo.parentNode!==this){",
  "if(hijo.parentNode){hijo.parentNode.removeChild(hijo);}",
  "return hijo;}",
  "return quitar.call(this,hijo);};",
  "})();",
].join("");
