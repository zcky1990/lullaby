import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export type WorkflowRouterNodeData = {
  label: string;
  borderColor: string;
};

function WorkflowRouterNodeComponent({ data }: NodeProps) {
  const nodeData = data as WorkflowRouterNodeData;
  return (
    <div className="relative flex h-[88px] w-[88px] items-center justify-center">
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-muted-foreground"
      />
      <div
        className="flex h-[62px] w-[62px] rotate-45 items-center justify-center border-2 bg-card shadow-sm"
        style={{ borderColor: nodeData.borderColor }}
      >
        <span className="-rotate-45 max-w-[70px] truncate text-center font-mono text-[10px] leading-tight text-card-foreground">
          {nodeData.label}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-muted-foreground"
      />
    </div>
  );
}

export const WorkflowRouterNode = memo(WorkflowRouterNodeComponent);
