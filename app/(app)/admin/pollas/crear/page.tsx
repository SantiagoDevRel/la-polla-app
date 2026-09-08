import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { CrearPollaForm } from "@/components/casa/CrearPollaForm";
import { HeroFrame, Label } from "@/components/street";

export const dynamic = "force-dynamic";

export default async function CrearCasaPollaPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?returnTo=/admin/pollas/crear");
  if (!user.is_admin) redirect("/casa");

  return (
    <div className="pb-28">
      <HeroFrame height="min-h-[176px]">
        <Link href="/admin/pollas" className="mb-3 inline-flex min-h-11 items-center gap-2 self-start text-[13px] text-text-secondary transition-colors hover:text-text-primary">
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" /> Administrar pollas
        </Link>
        <Label>Administración</Label>
        <h1 className="lp-display mt-1 text-[38px] leading-none">Crear polla</h1>
        <p className="mt-3 text-[13px] text-text-secondary">Define la entrada, los pronósticos y el cierre de tu nueva polla.</p>
      </HeroFrame>
      <div className="px-4 pt-5">
        <CrearPollaForm />
      </div>
    </div>
  );
}
