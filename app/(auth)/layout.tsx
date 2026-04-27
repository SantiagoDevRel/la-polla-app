// app/(auth)/layout.tsx — Layout para las páginas de autenticación (login, verify)
// Shares the same AppBackground as the authenticated shell so the
// stadium ambience is visible before sign-in. Auth pages previously
// had their own static radial gradients; those stay on the page as a
// local highlight, layered on top of the global ambient.
//
// WelcomeIntro is mounted here so it covers /login and /onboarding —
// the first two surfaces a brand-new visitor lands on. It self-gates
// via localStorage and renders nothing for returning users.
import { AppBackground } from "@/components/layout/AppBackground";
import { WelcomeIntro } from "@/components/auth/WelcomeIntro";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <AppBackground />
      <WelcomeIntro />
      {children}
    </>
  );
}
