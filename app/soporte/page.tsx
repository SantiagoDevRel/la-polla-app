// app/soporte/page.tsx — Página de soporte público (Apple/Play requirement)
export const metadata = {
  title: "Soporte · La Polla Colombiana",
  description:
    "Ayuda, contacto y respuestas a las preguntas frecuentes sobre La Polla Colombiana.",
};

export default function SoportePage() {
  return (
    <div
      style={{
        background: "#080c10",
        minHeight: "100vh",
        color: "#f0f4ff",
        fontFamily: "'Outfit', sans-serif",
      }}
    >
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 20px" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          Soporte
        </h1>
        <p style={{ fontSize: 13, color: "#7a8499", marginBottom: 32 }}>
          La Polla Colombiana · Última actualización: mayo 2026
        </p>

        <section style={{ marginBottom: 28 }}>
          <h2
            style={{
              fontSize: 17,
              fontWeight: 600,
              marginBottom: 8,
              color: "#FFD700",
            }}
          >
            Contacto directo
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            ¿Necesitas ayuda o tienes una sugerencia? Escríbenos a{" "}
            <a
              href="mailto:santiagotrujillozuluaga@gmail.com"
              style={{ color: "#FFD700", textDecoration: "underline" }}
            >
              santiagotrujillozuluaga@gmail.com
            </a>
            . Respondemos en máximo 48 horas hábiles.
          </p>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2
            style={{
              fontSize: 17,
              fontWeight: 600,
              marginBottom: 8,
              color: "#FFD700",
            }}
          >
            Reportar un problema desde la app
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            Dentro de la app, en la parte superior derecha, hay un botón
            &quot;Reportar problema&quot; con un ícono de alerta. Al tocarlo
            puedes enviarnos un mensaje detallado y recibimos la notificación al
            instante.
          </p>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2
            style={{
              fontSize: 17,
              fontWeight: 600,
              marginBottom: 8,
              color: "#FFD700",
            }}
          >
            Preguntas frecuentes
          </h2>

          <h3
            style={{
              fontSize: 15,
              fontWeight: 600,
              marginTop: 18,
              marginBottom: 6,
              color: "#f0f4ff",
            }}
          >
            ¿Cómo me uno a una polla?
          </h3>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            Pídele al organizador el código de la polla o el link de invitación
            (formato lapollacolombiana.com/unirse/...). Toca el link, inicia
            sesión con tu número de WhatsApp y aceptas unirte.
          </p>

          <h3
            style={{
              fontSize: 15,
              fontWeight: 600,
              marginTop: 18,
              marginBottom: 6,
              color: "#f0f4ff",
            }}
          >
            ¿Cómo creo una polla nueva?
          </h3>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            Desde la pantalla de inicio, toca el botón dorado con el símbolo
            &quot;+&quot;. Eliges el torneo (Champions, Mundial, La Liga,
            Premier o Serie A), defines el nombre del parche, el modo de pago y
            listo. Te damos un código y un link para invitar.
          </p>

          <h3
            style={{
              fontSize: 15,
              fontWeight: 600,
              marginTop: 18,
              marginBottom: 6,
              color: "#f0f4ff",
            }}
          >
            ¿Cómo se calculan los puntos?
          </h3>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            Acertar el resultado exacto suma más puntos que solo acertar el
            ganador. Encontrarás la guía completa de puntaje en tu perfil
            dentro de la app, en la sección &quot;Cómo se gana&quot;.
          </p>

          <h3
            style={{
              fontSize: 15,
              fontWeight: 600,
              marginTop: 18,
              marginBottom: 6,
              color: "#f0f4ff",
            }}
          >
            No me llega el SMS de verificación
          </h3>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            Verifica que el número esté escrito con el indicativo del país
            (ej. +57 para Colombia). Si después de un minuto no llega, usa la
            opción &quot;Recibir por WhatsApp&quot; en la pantalla de login.
          </p>

          <h3
            style={{
              fontSize: 15,
              fontWeight: 600,
              marginTop: 18,
              marginBottom: 6,
              color: "#f0f4ff",
            }}
          >
            ¿La Polla maneja dinero?
          </h3>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            No. La Polla es solo una herramienta de pronósticos entre amigos.
            Si tu polla tiene un monto de inscripción, ese dinero se mueve
            directamente entre los participantes (por fuera de la app). La
            Polla no procesa pagos.
          </p>

          <h3
            style={{
              fontSize: 15,
              fontWeight: 600,
              marginTop: 18,
              marginBottom: 6,
              color: "#f0f4ff",
            }}
          >
            ¿Cómo elimino mi cuenta?
          </h3>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            Escríbenos a{" "}
            <a
              href="mailto:santiagotrujillozuluaga@gmail.com"
              style={{ color: "#FFD700", textDecoration: "underline" }}
            >
              santiagotrujillozuluaga@gmail.com
            </a>{" "}
            con tu número de WhatsApp registrado. Eliminamos tu cuenta y todos
            tus datos asociados en máximo 30 días.
          </p>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2
            style={{
              fontSize: 17,
              fontWeight: 600,
              marginBottom: 8,
              color: "#FFD700",
            }}
          >
            Política de privacidad
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            Puedes leer cómo manejamos tus datos en{" "}
            <a
              href="/privacy"
              style={{ color: "#FFD700", textDecoration: "underline" }}
            >
              lapollacolombiana.com/privacy
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
