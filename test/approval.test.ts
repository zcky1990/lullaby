import { equal } from "node:assert/strict";
import { APPROVAL_REQUIRED_TOOLS, needsToolPermission } from "../src/server/chat/approval.ts";

const base = { disabledTools: [], autoApproveTools: [] } as const;

Deno.test("approval: write_file is never gated by a per-call permission prompt", () => {
  equal(APPROVAL_REQUIRED_TOOLS.has("write_file"), true);
  equal(needsToolPermission({ ...base, toolName: "write_file" }), false);
});

Deno.test("approval: read-only tools never prompt", () => {
  for (const toolName of ["read_file", "list_files", "get_ticket", "use_skill"]) {
    equal(needsToolPermission({ ...base, toolName }), false);
  }
});

Deno.test("approval: other approval-required tools still prompt", () => {
  const approvalRequiredTools = new Set(["shell"]);
  equal(needsToolPermission({ ...base, toolName: "shell", approvalRequiredTools }), true);
});

Deno.test("approval: disabled, always-allowed, and run-allowed tools skip the prompt", () => {
  const approvalRequiredTools = new Set(["shell"]);
  equal(
    needsToolPermission({
      toolName: "shell",
      approvalRequiredTools,
      disabledTools: ["shell"],
      autoApproveTools: [],
    }),
    false,
  );
  equal(
    needsToolPermission({
      toolName: "shell",
      approvalRequiredTools,
      disabledTools: [],
      autoApproveTools: ["shell"],
    }),
    false,
  );
  equal(
    needsToolPermission({
      toolName: "shell",
      approvalRequiredTools,
      disabledTools: [],
      autoApproveTools: [],
      allowedTools: new Set(["shell"]),
    }),
    false,
  );
});

Deno.test("approval: write tools in the approval set never prompt", () => {
  const approvalRequiredTools = new Set(["shell", "patch"]);
  const writeTools = new Set(["patch"]);
  equal(
    needsToolPermission({
      toolName: "patch",
      approvalRequiredTools,
      writeTools,
      disabledTools: [],
      autoApproveTools: [],
    }),
    false,
  );
});
