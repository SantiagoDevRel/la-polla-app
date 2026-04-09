// app/(app)/layout.tsx — Layout para las páginas de la aplicación (requiere autenticación)
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
