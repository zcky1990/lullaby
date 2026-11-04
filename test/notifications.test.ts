import { equal } from "node:assert/strict";
import { NotificationSettingsInput } from "../src/config/schema.ts";
import { sendToChannel } from "../src/server/notifications/send.ts";
import { parseWorkflow } from "../src/server/workflow/parse.ts";
import { isAllowedParamOverrideKey } from "../src/server/workflow/params.ts";

Deno.test("NotificationSettingsInput validates channels only", () => {
  const parsed = NotificationSettingsInput.parse({
    channels: [
      {
        name: "team-slack",
        type: "slack",
        webhookUrl: "https://hooks.slack.com/services/T/B/X",
      },
    ],
  });
  equal(parsed.channels.length, 1);
  equal(parsed.channels[0]?.name, "team-slack");
});

Deno.test("sendToChannel posts Slack-shaped body from message payload", async () => {
  const originalFetch = globalThis.fetch;
  let seen: { url: string; body: string } | undefined;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    seen = {
      url: String(url),
      body: String(init?.body ?? ""),
    };
    return Promise.resolve(new Response("ok", { status: 200 }));
  }) as typeof fetch;
  try {
    const result = await sendToChannel(
      {
        id: "c1",
        name: "Slack",
        type: "slack",
        enabled: true,
        webhookUrl: "https://hooks.slack.com/services/T/B/X",
      },
      { text: "hello from workflow" },
    );
    equal(result.ok, true);
    equal(seen?.url.includes("hooks.slack.com"), true);
    const body = JSON.parse(seen?.body ?? "{}") as { text?: string };
    equal(body.text, "hello from workflow");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("sendToChannel uses content for Discord and event for webhook", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: string[] = [];
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    return Promise.resolve(new Response("ok", { status: 200 }));
  }) as typeof fetch;
  try {
    await sendToChannel(
      {
        id: "d1",
        name: "Discord",
        type: "discord",
        enabled: true,
        webhookUrl: "https://discord.com/api/webhooks/1/2",
      },
      { text: "discord hi" },
    );
    await sendToChannel(
      {
        id: "w1",
        name: "Hook",
        type: "webhook",
        enabled: true,
        webhookUrl: "https://example.com/hook",
      },
      {
        text: "generic",
        workflowName: "build",
        runId: "run-1",
        stepId: "ping",
      },
    );
    const discord = JSON.parse(bodies[0]!) as { content?: string };
    const webhook = JSON.parse(bodies[1]!) as {
      event?: string;
      text?: string;
      stepId?: string;
    };
    equal(discord.content, "discord hi");
    equal(webhook.event, "workflow.notification");
    equal(webhook.text, "generic");
    equal(webhook.stepId, "ping");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("parseWorkflow accepts action: notification step", () => {
  const definition = parseWorkflow(
    `
name: notify-demo
steps:
  - id: work
    run: echo ok
    output: RESULT
  - id: ping
    depends: work
    action: notification
    with:
      channel: team-slack
      message: "done \${RESULT}"
`,
    "notify-demo",
  );
  const ping = definition.steps.find((step) => step.id === "ping")!;
  equal(ping.kind, "notify");
  equal(ping.notify?.channel, "team-slack");
  equal(ping.notify?.message.includes("RESULT"), true);
});

Deno.test("parseWorkflow accepts agent companion keys", () => {
  const definition = parseWorkflow(
    `
name: agent-param
params:
  - name: TASK
    type: agent
steps:
  - id: run
    action: agent
    with:
      prompt: "\${params.TASK}"
`,
    "agent-param",
  );
  equal(isAllowedParamOverrideKey(definition.params, "TASK"), true);
  equal(isAllowedParamOverrideKey(definition.params, "TASK__provider"), true);
  equal(isAllowedParamOverrideKey(definition.params, "OTHER"), false);
});
