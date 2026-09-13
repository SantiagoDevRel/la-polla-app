import { AdminPaymentReview } from "@/components/casa/AdminPaymentReview";

export const dynamic = "force-dynamic";

export default async function ApprovedPaymentsPage({ searchParams }: { searchParams: Promise<{ pollaId?: string }> }) {
  const { pollaId } = await searchParams;
  return <AdminPaymentReview status="pagada" pollaId={typeof pollaId === "string" ? pollaId : undefined} />;
}
