// app/(app)/rifas/crear/page.tsx — «Crear mi rifa».
//
// Solo creadores habilitados por un administrador (SQL: rifa_is_creator). A
// quien no tiene el permiso no se le explica nada: es un 404, igual que con el
// flag apagado. La cuenta de cobro se prellena con la de su última rifa.
import { notFound, redirect } from "next/navigation";
import { getMyRifas, getRifaViewer, lastPaymentAccount, rifasEnabled } from "@/lib/rifas/server";
import { HeroFrame, Label } from "@/components/street";
import { RifaForm } from "@/components/rifas/RifaForm";
import { nextColombiaSaturdayInput } from "@/lib/time/colombia";

export const dynamic = "force-dynamic";

export default async function CrearRifaPage() {
  if (!rifasEnabled()) notFound();
  const viewer = await getRifaViewer();
  if (!viewer) redirect("/login?returnTo=/rifas/crear");
  const { data } = await getMyRifas(viewer.id);
  if (!data?.can_create) notFound();
  const last = await lastPaymentAccount(viewer.id);

  return (
    <div className="pb-28">
      <HeroFrame height="min-h-[120px]">
        <Label>Rifas</Label>
        <h1 className="lp-display mt-1 text-[30px]">Crear mi rifa</h1>
      </HeroFrame>
      <RifaForm defaultDrawAt={nextColombiaSaturdayInput().replace("T12:00", "T22:30")}
        prefill={{
          method: (last?.payment_method as "nequi" | "bancolombia" | "daviplata" | "otro" | undefined) ?? "nequi",
          account: last?.payment_account ?? "",
          holder: last?.payment_holder ?? viewer.display_name ?? "",
        }} />
    </div>
  );
}
