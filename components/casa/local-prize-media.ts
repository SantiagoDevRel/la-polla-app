import "server-only";
import { pollaPrizeMedia } from "./prize-media";

/** Visual review only: these files stay on this machine, outside public/. */
export function localPrizeMedia(id: string): ReturnType<typeof pollaPrizeMedia> {
  if (process.env.CASA_LOCAL_TEST !== "1"
    || !/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) return null;
  return pollaPrizeMedia(id, "/__local-prize-media/");
}
