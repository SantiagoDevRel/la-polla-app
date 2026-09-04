// app/tournaments/[slug]/page.tsx — English alias de /torneos/[slug].
export {
  default,
  generateMetadata,
  generateStaticParams,
} from "@/app/torneos/[slug]/page";

export const revalidate = 600;
