// app/(auth)/layout.tsx — Layout para las páginas de autenticación (login, verify)
// Shares the same AppBackground as the authenticated shell so the
// stadium ambience is visible before sign-in. Auth pages previously
// had their own static radial gradients; those stay on the page as a
// local highlight, layered on top of the global ambient.
//
// WelcomeIntro is mounted here so it covers /login and /onboarding —
// the first two surfaces a brand-new visitor lands on. It self-gates
// via localStorage and renders nothing for returning users.
//
// WelcomeIntroLoader owns the client-only dynamic import (`ssr: false`) so
// this layout can remain a Server Component on Next.js 16. Its motion bundle
// (~50 kB) only loads in the browser, after the login form has
// painted. On returning users (sessionStorage gate), the component
// early-returns, so the chunk download is wasted only on the first
// visit per session — acceptable trade for shaving ~50 kB off /login
// First Load JS (was 312 kB, now ~260 kB).
import { AppBackground } from "@/components/layout/AppBackground";
import { WelcomeIntroLoader } from "@/components/auth/WelcomeIntroLoader";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <AppBackground />
      <WelcomeIntroLoader />
      <div className="contents" data-auth-content>
        {children}
      </div>
    </>
  );
}
