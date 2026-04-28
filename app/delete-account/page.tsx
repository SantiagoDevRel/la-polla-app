// app/delete-account/page.tsx — Solicitud de eliminacion de cuenta.
// Requerido por Google Play (data deletion URL para el store listing).
// Linkeado desde Play Console > App content > Data safety.

export const metadata = {
  title: "Eliminar cuenta — La Polla Colombiana",
  description:
    "Cómo solicitar la eliminación de tu cuenta y datos en La Polla Colombiana.",
};

export default function DeleteAccountPage() {
  return (
    <div style={{ background: "#080c10", minHeight: "100vh", color: "#f0f4ff", fontFamily: "'Outfit', sans-serif" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 20px" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          Eliminar cuenta — La Polla Colombiana
        </h1>
        <p style={{ fontSize: 13, color: "#7a8499", marginBottom: 32 }}>
          Última actualización: abril 2026
        </p>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            1. Cómo solicitar la eliminación
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            Para eliminar tu cuenta de La Polla Colombiana y todos los datos asociados,
            envíanos un correo a{" "}
            <a
              href="mailto:santiagotrujillozuluaga@gmail.com?subject=Eliminar%20cuenta%20La%20Polla%20Colombiana"
              style={{ color: "#FFD700", textDecoration: "underline" }}
            >
              santiagotrujillozuluaga@gmail.com
            </a>{" "}
            con el asunto <strong>&quot;Eliminar cuenta La Polla Colombiana&quot;</strong> e incluye
            en el cuerpo del correo el número de teléfono celular con el que iniciaste sesión
            (formato internacional, ej. +57 311 234 5678).
          </p>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8", marginTop: 12 }}>
            Confirmaremos la recepción dentro de 72 horas y procesaremos la eliminación
            completa en un plazo máximo de 30 días desde la solicitud.
          </p>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            2. Datos que se eliminan
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            Eliminamos los siguientes datos asociados a tu cuenta:
          </p>
          <ul style={{ fontSize: 14, lineHeight: 1.8, color: "#b0b8c8", paddingLeft: 20, marginTop: 8 }}>
            <li>Tu perfil (nombre de visualización, pollito-avatar)</li>
            <li>Tu número de teléfono / WhatsApp</li>
            <li>Tus predicciones y puntos en todas las pollas en las que participaste</li>
            <li>Tu participación en pollas (te removemos como miembro)</li>
            <li>Tus mensajes de feedback / reportes de problema enviados</li>
            <li>Tu historial de inicios de sesión (login events) y notificaciones</li>
            <li>Tu estado de conversación con el bot de WhatsApp (si lo usaste)</li>
            <li>Tokens de acceso y sesión activos</li>
          </ul>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            3. Datos que se mantienen (anonimizados)
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            Para preservar la integridad histórica de las pollas en las que jugaste, las
            estadísticas agregadas y resultados pasados pueden mantenerse de forma{" "}
            <strong>anónima</strong> (sin datos identificables a tu persona):
          </p>
          <ul style={{ fontSize: 14, lineHeight: 1.8, color: "#b0b8c8", paddingLeft: 20, marginTop: 8 }}>
            <li>Resultados pasados de partidos (no contienen PII)</li>
            <li>
              Configuraciones globales de pollas (montos de buy-in, premios) — sin asociar
              a tu identidad
            </li>
            <li>
              Estadísticas agregadas a nivel de torneo (ningún dato individual, solo conteos)
            </li>
          </ul>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8", marginTop: 12 }}>
            Tu nombre, número y predicciones específicas <strong>no se mantienen</strong> en
            ningún registro identificable después de los 30 días.
          </p>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            4. Período de retención
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            Período máximo de retención desde la solicitud: <strong>30 días</strong>. Durante
            ese período eliminamos tus datos de nuestras bases de datos primarias y de los
            backups que rotamos en ese mismo plazo.
          </p>
        </section>

        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#FFD700" }}>
            5. Contacto
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#b0b8c8" }}>
            Si tienes preguntas sobre el proceso de eliminación, escríbenos a{" "}
            <a
              href="mailto:santiagotrujillozuluaga@gmail.com"
              style={{ color: "#FFD700", textDecoration: "underline" }}
            >
              santiagotrujillozuluaga@gmail.com
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
