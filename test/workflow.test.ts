import { equal, throws } from "node:assert/strict";
import {
  collectAgentParamAttachments,
  resolveWorkflowLlmSelection,
} from "../src/server/workflow/params.ts";
import { parseWorkflow, slugName, workflowTemplate } from "../src/server/workflow/parse.ts";

Deno.test("parseWorkflow builds dependencies, defaults and parallel layers", () => {
  const definition = parseWorkflow(
    `
name: build-test
description: Demo
env:
  GLOBAL: yes
defaults:
  retry_policy:
    limit: 2
    interval_sec: 1
  timeout_sec: 30
steps:
  - id: checkout
    run: echo checkout
  - id: test
    depends: checkout
    run: echo test
  - id: build
    depends: [checkout]
    run: echo build
    retry_policy:
      limit: 3
      interval_sec: 2
    env:
      MODE: ci
  - id: package
    depends: [test, build]
    run: echo package
    continue_on: failure
`,
    "build-test",
  );
  equal(definition.name, "build-test");
  equal(definition.env.GLOBAL, "yes");
  equal(definition.steps.length, 4);
  equal(definition.steps[0].retry.limit, 2);
  equal(definition.steps[0].timeoutSec, 30);
  equal(definition.steps[2].retry.limit, 3);
  equal(definition.steps[2].env.MODE, "ci");
  equal(definition.steps[3].continueOn, "failure");
  equal(definition.layers.length, 3);
  equal(definition.layers[0].join(","), "checkout");
  equal(definition.layers[1].sort().join(","), "build,test");
  equal(definition.layers[2].join(","), "package");
});

Deno.test("parseWorkflow rejects unknown dependencies, cycles and duplicates", () => {
  throws(() =>
    parseWorkflow(
      "steps:\n  - id: a\n    run: echo a\n    depends: missing\n",
      "bad",
    )
  );
  throws(() =>
    parseWorkflow(
      "steps:\n  - id: a\n    run: echo a\n    depends: b\n  - id: b\n    run: echo b\n    depends: a\n",
      "cycle",
    )
  );
  throws(() =>
    parseWorkflow(
      "steps:\n  - id: same\n    run: echo 1\n  - id: same\n    run: echo 2\n",
      "dup",
    )
  );
  throws(() => parseWorkflow("steps: []\n", "empty"));
});

Deno.test("workflowTemplate is valid and slugName normalizes names", () => {
  const yaml = workflowTemplate("My Workflow!");
  const definition = parseWorkflow(yaml, "fallback");
  equal(definition.name, "my-workflow");
  equal(definition.steps[0].id, "hello");
  equal(slugName("Hello World"), "hello-world");
  throws(() => slugName("!!!"));
});

Deno.test("parseWorkflow supports chat.completion steps and outputs", () => {
  const definition = parseWorkflow(
    `
name: ai-flow
llm:
  provider: Global LLM
  model: test-model
  system: Base system
  session: review-thread
steps:
  - id: ask
    action: chat.completion
    with:
      prompt: "Hello \${NAME}"
      temperature: 0.2
      max_tokens: 100
    output: ANSWER
  - id: use
    depends: ask
    run: echo "\${ANSWER}"
`,
    "ai-flow",
  );
  equal(definition.llm?.provider, "Global LLM");
  equal(definition.llm?.session, "review-thread");
  const ask = definition.steps[0];
  equal(ask.kind, "llm");
  equal(ask.output, "ANSWER");
  equal(ask.with?.prompt, "Hello ${NAME}");
  equal(ask.with?.temperature, 0.2);
  equal(ask.with?.maxTokens, 100);
  equal(definition.steps[1].kind, "shell");
});

Deno.test("parseWorkflow supports agent steps", () => {
  const definition = parseWorkflow(
    `
name: agent-flow
llm:
  provider: Global LLM
steps:
  - id: implement
    action: agent
    with:
      mode: build
      skill: code-review
      prompt: "Implement \${TICKET}"
      max_steps: 8
      variant: medium
    output: RESULT
  - id: done
    depends: implement
    run: echo "\${RESULT}"
`,
    "agent-flow",
  );
  const step = definition.steps[0];
  equal(step.kind, "agent");
  equal(step.action, "agent");
  equal(step.with?.mode, "build");
  equal(step.with?.skill, "code-review");
  equal(step.with?.maxSteps, 8);
  equal(step.with?.variant, "medium");
  equal(step.output, "RESULT");
  equal(definition.steps[1].kind, "shell");
});

Deno.test("parseWorkflow rejects bad agent mode and missing prompt", () => {
  throws(() =>
    parseWorkflow(
      "steps:\n  - id: x\n    action: agent\n    with:\n      mode: ship\n      prompt: hi\n",
      "bad",
    )
  );
  throws(() =>
    parseWorkflow(
      "steps:\n  - id: x\n    action: agent\n",
      "bad",
    )
  );
});

Deno.test("parseWorkflow rejects unsupported LLM actions", () => {
  throws(() =>
    parseWorkflow(
      "steps:\n  - id: x\n    action: http.request\n    with: {}\n",
      "bad",
    )
  );
  throws(() =>
    parseWorkflow(
      "steps:\n  - id: x\n    action: chat.completion\n",
      "bad",
    )
  );
});

Deno.test("parseWorkflow accepts Dagu-style params, array env, outputs and router.route", () => {
  const definition = parseWorkflow(
    `
name: ai-development
description: AI development with automatic RuboCop and RSpec repair loop
type: graph
params:
  - name: PROMPT
    type: string
    default: "Create a simple API"
    description: Task or feature to implement
  - name: WORKING_DIRECTORY
    type: string
    default: /tmp/app
    description: Project working directory
  - name: MAX_ATTEMPTS
    type: integer
    default: 5
    description: Maximum validation attempts per stage
timeout_sec: 3600
steps:
  - id: development
    timeout_sec: 1800
    working_dir: "\${params.WORKING_DIRECTORY}"
    env:
      - PROMPT: "\${params.PROMPT}"
    run: |
      openhands --headless -t "$PROMPT"
  - id: rubocop
    depends: development
    working_dir: "\${params.WORKING_DIRECTORY}"
    env:
      - MAX_ATTEMPTS: "\${params.MAX_ATTEMPTS}"
    run: |
      echo status=success >> "$DAGU_OUTPUT_FILE"
    outputs:
      - name: status
  - id: rubocop_router
    depends: rubocop
    action: router.route
    with:
      value: \${steps.rubocop.outputs.status}
      routes:
        success: [rspec]
        failed: [lint_failed]
  - id: rspec
    working_dir: "\${params.WORKING_DIRECTORY}"
    env:
      - MAX_ATTEMPTS: "\${params.MAX_ATTEMPTS}"
    run: |
      echo status=success >> "$DAGU_OUTPUT_FILE"
    outputs:
      - name: status
  - id: rspec_router
    depends: rspec
    action: router.route
    with:
      value: \${steps.rspec.outputs.status}
      routes:
        success: [workflow_success]
        failed: [tests_failed]
  - id: workflow_success
    run: echo "passed"
  - id: lint_failed
    run: |
      echo failed
      exit 1
  - id: tests_failed
    run: |
      echo failed
      exit 1
`,
    "ai-development",
  );
  equal(definition.name, "ai-development");
  equal(definition.type, "graph");
  equal(definition.timeoutSec, 3600);
  equal(definition.params.length, 3);
  equal(definition.env.PROMPT, "Create a simple API");
  equal(definition.env.MAX_ATTEMPTS, "5");
  const development = definition.steps.find((step) => step.id === "development")!;
  equal(development.timeoutSec, 1800);
  equal(development.env.PROMPT, "${params.PROMPT}");
  const rubocop = definition.steps.find((step) => step.id === "rubocop")!;
  equal(rubocop.outputs.join(","), "status");
  const router = definition.steps.find((step) => step.id === "rubocop_router")!;
  equal(router.kind, "router");
  equal(router.router?.routes.success.join(","), "rspec");
  const rspec = definition.steps.find((step) => step.id === "rspec")!;
  equal(rspec.depends.includes("rubocop_router"), true);
  equal(rspec.routeGate?.routerId, "rubocop_router");
  const lintFailed = definition.steps.find((step) => step.id === "lint_failed")!;
  equal(lintFailed.routeGate?.routerId, "rubocop_router");
  equal(definition.steps.find((step) => step.id === "workflow_success")?.routeGate?.routerId, "rspec_router");
});

Deno.test("parseWorkflow supports loop-back routes and next", () => {
  const definition = parseWorkflow(
    `
name: rubocop-loop
steps:
  - id: rubocop
    run: echo rubocop
  - id: check
    depends: rubocop
    run: |
      printf 'STATUS=failed\\n' >> "$DAGU_OUTPUT_FILE"
    outputs:
      - name: STATUS
  - id: route
    depends: check
    action: router.route
    with:
      value: \${steps.check.outputs.STATUS}
      max_loops: 5
      routes:
        success: [done]
        failed: [fix]
  - id: fix
    action: agent
    with:
      prompt: fix it
    next: rubocop
  - id: done
    run: echo done
`,
    "rubocop-loop",
  );
  const route = definition.steps.find((step) => step.id === "route")!;
  equal(route.kind, "router");
  equal(route.router?.maxLoops, 5);
  equal(route.router?.loopBacks.join(","), "");
  const fix = definition.steps.find((step) => step.id === "fix")!;
  equal(fix.next.join(","), "rubocop");
  equal(fix.routeGate?.routerId, "route");
  const done = definition.steps.find((step) => step.id === "done")!;
  equal(done.routeGate?.routerId, "route");

  const withLoopBack = parseWorkflow(
    `
name: direct-loop
steps:
  - id: work
    run: echo work
  - id: check
    depends: work
    run: printf 'STATUS=failed\\n' >> "$DAGU_OUTPUT_FILE"
    outputs:
      - name: STATUS
  - id: route
    depends: check
    action: router.route
    with:
      value: \${steps.check.outputs.STATUS}
      routes:
        success: [done]
        failed: [work]
  - id: done
    run: echo done
`,
    "direct-loop",
  );
  const loopRoute = withLoopBack.steps.find((step) => step.id === "route")!;
  equal(loopRoute.router?.loopBacks.join(","), "work");
  equal(withLoopBack.steps.find((step) => step.id === "work")?.routeGate, undefined);
});

Deno.test("parseWorkflow accepts agent param type and resolves provider/model companions", () => {
  const definition = parseWorkflow(
    `
name: agent-param
params:
  - name: TASK
    type: agent
    description: Prompt + model
steps:
  - id: run
    action: agent
    with:
      prompt: "\${params.TASK}"
`,
    "agent-param",
  );
  equal(definition.params[0]?.type, "agent");
  const step = definition.steps[0]!;
  const selection = resolveWorkflowLlmSelection(
    definition,
    step.with ?? {},
    {
      TASK: "do the thing",
      TASK__provider: "prov-1",
      TASK__model: "composer-2",
      TASK__attachments: JSON.stringify([
        { type: "image", name: "a.png", mime: "image/png", data: "data:image/png;base64,xx" },
      ]),
    },
    (value) =>
      value.replace(/\$\{params\.TASK\}/g, "do the thing"),
  );
  equal(selection.providerKey, "prov-1");
  equal(selection.model, "composer-2");
  const attachments = collectAgentParamAttachments(
    definition,
    step.with ?? {},
    {
      TASK__attachments: JSON.stringify([
        { type: "image", name: "a.png", mime: "image/png", data: "data:image/png;base64,xx" },
      ]),
    },
  );
  equal(attachments.length, 1);
  equal(attachments[0]?.name, "a.png");
});
