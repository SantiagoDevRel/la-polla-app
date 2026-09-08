import { Skeleton } from "@/components/ui/Skeleton";

export default function AdminPollasLoading() {
  return (
    <div role="status" className="space-y-5 px-4 pb-28 pt-8">
      <span className="sr-only">Cargando pollas...</span>
      <div aria-hidden="true" className="space-y-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-4/5" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
        <Skeleton className="h-12 w-full" />
        {[0, 1, 2].map((row) => (
          <div key={row} className="lp-card space-y-3 p-4">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-6 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
