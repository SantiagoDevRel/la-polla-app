// app/page.tsx — Página raíz que entra directo a la casa
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/casa");
}
