// components/shared/WhatsAppBubble.tsx — Small clickable WhatsApp icon that
// opens a chat with the bot. Drops into the header next to "LA POLLA
// COLOMBIANA" so users always have a one-tap entry to the bot menu without
// the login flow needing to push them through it.
"use client";

import { botDeepLink } from "@/lib/whatsapp/bot-phone";

interface WhatsAppBubbleProps {
  /**
   * Pre-text the WhatsApp deep link types into the chat for the user. The
   * bot's greeting handler treats any common opener (hola, menu, parce, etc.)
   * as a request to render the main menu, so this default is fine.
   */
  prefilledText?: string;
  /** Visual size in px. Default 32. */
  size?: number;
  /** Optional className for outer button positioning tweaks. */
  className?: string;
}

const DEFAULT_PRETEXT = "hola parce, muestrame el menu porfa";

export default function WhatsAppBubble({
  prefilledText = DEFAULT_PRETEXT,
  size = 32,
  className = "",
}: WhatsAppBubbleProps) {
  const href = botDeepLink(prefilledText);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Abrir el bot de La Polla en WhatsApp"
      className={`inline-flex items-center justify-center rounded-full transition-all hover:scale-105 active:scale-95 ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: "#25D366",
        boxShadow: "0 0 12px rgba(37,211,102,0.35)",
      }}
    >
      {/* Inline SVG so we don't ship the lucide WA icon (which doesn't
          exist) or pull a brand asset. The path is the standard WhatsApp
          glyph, scaled to the bubble. */}
      <svg
        viewBox="0 0 24 24"
        width={size * 0.6}
        height={size * 0.6}
        fill="white"
        aria-hidden="true"
      >
        <path d="M19.05 4.91A9.93 9.93 0 0 0 12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.91-7.01zM12.05 20.15h-.01a8.23 8.23 0 0 1-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.21 8.21 0 0 1-1.26-4.39c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.23 8.24zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.16.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.14-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.22.88 2.4 1 2.57.12.17 1.74 2.66 4.22 3.73.59.26 1.05.41 1.4.52.59.19 1.13.16 1.55.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29z" />
      </svg>
    </a>
  );
}
