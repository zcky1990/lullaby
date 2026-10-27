import { equal, throws } from "node:assert/strict";
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
