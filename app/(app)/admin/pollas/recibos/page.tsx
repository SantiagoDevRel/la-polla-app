import { AdminPaymentReview } from "@/components/casa/AdminPaymentReview";

export const dynamic = "force-dynamic";

export default async function PendingReceiptsPage({ searchParams }: { searchParams: Promise<{ pollaId?: string }> }) {
  const { pollaId } = await searchParams;
  return <AdminPaymentReview status="pendiente" pollaId={typeof pollaId === "string" ? pollaId : undefined} />;
}
