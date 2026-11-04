import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import docs from "@/docs/workflow-docs.md?raw";

const SearchableMarkdown = lazy(() => import("@/components/SearchableMarkdown"));

export function WorkflowDocsTab() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-2 px-8 py-6">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      }
    >
      <SearchableMarkdown content={docs} className="mx-auto max-w-4xl" />
    </Suspense>
  );
}
