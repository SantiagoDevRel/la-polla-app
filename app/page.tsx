// app/page.tsx — Página raíz que redirige al dashboard o login
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/dashboard");
}
