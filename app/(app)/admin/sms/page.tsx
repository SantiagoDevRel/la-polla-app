import { redirect } from "next/navigation";
import { getSmsOwner } from "@/lib/sms/campaigns/access";
import SmsCampaignPanel from "@/components/admin/SmsCampaignPanel";

export default async function SmsCampaignPage() {
  if (!await getSmsOwner()) redirect("/admin");
  return <SmsCampaignPanel />;
}
