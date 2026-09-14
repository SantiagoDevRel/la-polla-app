import { Skeleton } from "@/components/ui/Skeleton";

export default function EditarPollaLoading() {
  return (
    <div role="status" className="space-y-6 px-4 pb-28 pt-8">
      <span className="sr-only">Cargando editor...</span>
      <div aria-hidden="true" className="space-y-5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-3/4" />
        {[0, 1, 2].map((field) => (
          <div key={field} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-12 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
