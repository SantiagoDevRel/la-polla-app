// app/page.tsx — Página raíz que redirige a inicio o login
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/inicio");
}
