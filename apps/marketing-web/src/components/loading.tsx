import { Skeleton } from '@alliva/ui';

export function Loading() {
  return (
    <div className="space-y-4" aria-busy>
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-4 w-96" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-28 rounded-2xl" />)}
      </div>
      <Skeleton className="h-48 rounded-2xl" />
    </div>
  );
}
