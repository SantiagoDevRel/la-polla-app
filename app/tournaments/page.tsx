// app/tournaments/page.tsx — English alias de /torneos.
// Re-exporta el componente y generateMetadata; el path-locale-aware
// dentro del componente ya hace lo correcto en cada dominio.
export { default, generateMetadata, revalidate } from "@/app/torneos/page";
