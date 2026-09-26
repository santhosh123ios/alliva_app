import { CardGridSkeleton, Skeleton } from '@alliva/ui';

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy>
      <Skeleton className="h-8 w-48" />
      <CardGridSkeleton count={6} />
    </div>
  );
}
