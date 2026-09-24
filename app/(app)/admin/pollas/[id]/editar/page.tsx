// /admin/pollas/[id]/editar — editor administrativo de una polla (2026-09-14).
// Se llega desde la tuerca de /casa y desde Administrar pollas. El layout de
// /admin ya exige administrador; aquí se vuelve a comprobar antes de leer.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { getPollaEditorState } from "@/lib/casa/editor-state";
import { EditarPollaForm } from "@/components/casa/EditarPollaForm";
import { HeroFrame, Label } from "@/components/street";
import { getAdminPollaAccess } from "@/lib/casa/private-draft-query";

export const dynamic = "force-dynamic";

export default async function EditarPollaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const user = await getAuthenticatedUser();
  if (!user) redirect(`/login?returnTo=/admin/pollas/${id}/editar`);
  if (!user.is_admin) redirect("/inicio");

  const access = await getAdminPollaAccess(id, user);
  if (!access) notFound();
  if (access.privateDraft) redirect(`/admin/pollas/${id}/preview`);
  const state = await getPollaEditorState(id, user.id);
  if (!state) notFound();

  return (
    <div className="pb-28">
      <HeroFrame height="min-h-[176px]">
        <Link href="/admin/pollas" className="mb-3 inline-flex min-h-11 items-center gap-2 self-start text-[13px] text-text-secondary transition-colors hover:text-text-primary">
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" /> Administrar pollas
        </Link>
        <Label>Editar polla</Label>
        <h1 className="lp-display mt-1 text-[32px] leading-[1.05] [overflow-wrap:anywhere]">{state.polla.name}</h1>
      </HeroFrame>
      <div className="px-4 pt-5">
        <EditarPollaForm state={state} />
      </div>
    </div>
  );
}
