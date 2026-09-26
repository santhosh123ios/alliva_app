import { ListSkeleton, Skeleton } from '@alliva/ui';

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy>
      <div className="space-y-2">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-3.5 w-64" />
      </div>
      <ListSkeleton rows={5} />
    </div>
  );
}
