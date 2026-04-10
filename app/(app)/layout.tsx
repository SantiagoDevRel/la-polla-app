// app/(app)/layout.tsx — Layout para páginas autenticadas
// Fondo bg-base, ToastProvider global, BottomNav mobile, padding inferior para la barra
import { ToastProvider } from "@/components/ui/Toast";
import BottomNav from "@/components/ui/BottomNav";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <div className="relative z-10 pb-[72px]">{children}</div>
      <BottomNav />
    </ToastProvider>
  );
}
