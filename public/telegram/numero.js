// public/telegram/numero.js — Lógica de la mini app de numero.html.
// Sin dependencias ni llamadas a nuestro servidor: solo la ventana nativa de
// Telegram (requestContact, Bot API 6.9+). El contacto lo manda Telegram al chat.
(function () {
  "use strict";

  var COPY = {
    es: {
      title: "Compartir mi número",
      asking: "Telegram te va a preguntar si quieres compartir tu número con La Polla. Toca Compartir o Aceptar.",
      retry: "Toca el botón para compartir tu número. Solo lo usamos para crear o encontrar tu cuenta.",
      share: "Compartir mi número",
      close: "Volver al chat",
      done: "Listo. Vuelve al chat: ahí te respondemos.",
      busy: "Telegram ya te está preguntando. Revisa la ventana que se abrió.",
      old: "Tu versión de Telegram no permite compartir el número desde aquí. Actualiza Telegram, o vuelve al chat y toca «Compartir mi número» en la parte de abajo.",
      outside: "Esta página solo funciona dentro de Telegram. Abre el chat de La Polla en Telegram y toca «Compartir mi número».",
    },
    en: {
      title: "Share my number",
      asking: "Telegram will ask whether you want to share your number with Chicken Picks. Tap Share or OK.",
      retry: "Tap the button to share your number. We only use it to create or find your account.",
      share: "Share my number",
      close: "Back to the chat",
      done: "Done. Go back to the chat: we reply there.",
      busy: "Telegram is already asking. Check the window that opened.",
      old: "Your Telegram version cannot share the number from here. Update Telegram, or go back to the chat and tap “Share my number” at the bottom.",
      outside: "This page only works inside Telegram. Open the Chicken Picks chat in Telegram and tap “Share my number”.",
    },
  };

  var lang = /[?&]lang=en(&|$)/.test(window.location.search) ? "en" : "es";
  var t = COPY[lang];
  document.documentElement.lang = lang;

  var title = document.getElementById("title");
  var text = document.getElementById("text");
  var shareBtn = document.getElementById("share");
  var closeBtn = document.getElementById("close");
  title.textContent = t.title;
  shareBtn.textContent = t.share;
  closeBtn.textContent = t.close;

  var tg = window.Telegram && window.Telegram.WebApp;

  function show(message, options) {
    text.textContent = message;
    shareBtn.hidden = !options.share;
    closeBtn.hidden = !options.close;
  }

  // Fuera de Telegram el script igual define WebApp, con plataforma "unknown".
  if (!tg || tg.platform === "unknown") {
    show(t.outside, { share: false, close: false });
    return;
  }

  tg.ready();
  closeBtn.addEventListener("click", function () { tg.close(); });

  if (typeof tg.isVersionAtLeast !== "function" || !tg.isVersionAtLeast("6.9") || typeof tg.requestContact !== "function") {
    show(t.old, { share: false, close: true });
    return;
  }

  var finished = false;

  function ask() {
    if (finished) return;
    show(t.asking, { share: false, close: false });
    try {
      tg.requestContact(function (shared) {
        if (shared) {
          finished = true;
          show(t.done, { share: false, close: true });
          // Un instante para leer «Listo» antes de volver al chat.
          window.setTimeout(function () { tg.close(); }, 900);
        } else {
          show(t.retry, { share: true, close: true });
        }
      });
    } catch (err) {
      var busy = err && /ContactRequested/.test(String(err.message || err));
      show(busy ? t.busy : t.retry, { share: !busy, close: true });
    }
  }

  shareBtn.addEventListener("click", ask);
  // Sin pasos extra: la ventana de Telegram aparece apenas abre la página.
  ask();
})();
