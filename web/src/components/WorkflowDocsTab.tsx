import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import docs from "@/docs/workflow-docs.md?raw";

const MarkdownView = lazy(() => import("@/components/MarkdownView"));

export function WorkflowDocsTab() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-6">
        <Suspense
          fallback={
            <div className="flex flex-col gap-2">
              <Skeleton className="h-6 w-64" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          }
        >
          <MarkdownView content={docs} />
        </Suspense>
      </div>
    </div>
  );
}
