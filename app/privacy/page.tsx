// app/privacy/page.tsx — Política de Privacidad
export default function PrivacyPage() {
  return (
    <div style={{ background: "#080c10", minHeight: "100vh", color: "#f0f4ff", fontFamily: "'Outfit', sans-serif" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 20px" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          Política de Privacidad
        </h1>
        <p style={{ fontSize: 13, color: "#7a8499", marginBottom: 32 }}>
          La Polla Colombiana · Última actualización: abril 2026
        </p>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            1. Información que recopilamos
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            Recopilamos la siguiente información cuando usas La Polla: tu nombre de perfil,
            número de WhatsApp, tus pronósticos de partidos y los resultados de tus predicciones
            (puntos, posición en la tabla). No recopilamos datos de ubicación, contactos ni
            información financiera.
          </p>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            2. Cómo usamos tu información
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            Usamos tu información para: calcular los puntos de tus pronósticos, mostrar las
            tablas de posiciones dentro de cada polla, enviar notificaciones y resultados por
            WhatsApp, y permitir que otros participantes de tu polla vean tu nombre y puntuación.
          </p>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            3. Compartimos tu información
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            No vendemos ni compartimos tus datos con terceros. La única información visible
            para otros usuarios es tu nombre y puntuación dentro de las pollas en las que
            participas. Tu número de WhatsApp no es visible para otros participantes.
          </p>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            4. Eliminación de datos
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            Si deseas eliminar tu cuenta y todos tus datos, escríbenos a{" "}
            <a href="mailto:santiagotrujillozuluaga@gmail.com" style={{ color: "#FFD700", textDecoration: "underline" }}>
              santiagotrujillozuluaga@gmail.com
            </a>{" "}
            y procesaremos tu solicitud en un plazo máximo de 30 días.
          </p>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            5. Contacto
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            Para cualquier pregunta sobre esta política de privacidad, contáctanos en{" "}
            <a href="mailto:santiagotrujillozuluaga@gmail.com" style={{ color: "#FFD700", textDecoration: "underline" }}>
              santiagotrujillozuluaga@gmail.com
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
