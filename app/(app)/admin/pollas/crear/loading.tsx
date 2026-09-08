import { Skeleton } from "@/components/ui/Skeleton";

export default function CrearPollaLoading() {
  return (
    <div role="status" className="space-y-6 px-4 pb-28 pt-8">
      <span className="sr-only">Cargando formulario...</span>
      <div aria-hidden="true" className="space-y-5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-3/4" />
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((item) => <Skeleton key={item} className="h-12 w-full" />)}
        </div>
        {[0, 1, 2, 3].map((field) => (
          <div key={field} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-12 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
