// app/(auth)/layout.tsx — Layout para las páginas de autenticación (login, verify)
// Shares the same AppBackground as the authenticated shell so the
// stadium ambience is visible before sign-in. Auth pages previously
// had their own static radial gradients; those stay on the page as a
// local highlight, layered on top of the global ambient.
import { AppBackground } from "@/components/layout/AppBackground";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <AppBackground />
      {children}
    </>
  );
}
