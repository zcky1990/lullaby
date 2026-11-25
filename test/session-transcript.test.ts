import { deepEqual, equal } from "node:assert/strict";
import { mergeSessionTranscript } from "../src/server/chat/session-transcript.ts";

Deno.test("mergeSessionTranscript: new session uses incoming as transcript", () => {
  const merged = mergeSessionTranscript([], [
    {
      role: "user",
      content: "halo",
      attachments: [{ type: "text", name: "a.txt", data: "x" }],
    },
  ]);
  equal(merged.append.length, 1);
  equal(merged.transcript.length, 1);
  equal(merged.transcript[0].content, "halo");
  equal(merged.transcript[0].attachments?.length, 1);
});

Deno.test("mergeSessionTranscript: follow-up appends only latest user turn", () => {
  const merged = mergeSessionTranscript(
    [
      { role: "user", content: "satu" },
      { role: "assistant", content: "jawab panjang ".repeat(1000) },
    ],
    [{ role: "user", content: "lanjut" }],
  );
  deepEqual(merged.append, [{ role: "user", content: "lanjut" }]);
  equal(merged.transcript.length, 3);
  equal(merged.transcript[2].content, "lanjut");
});

Deno.test("mergeSessionTranscript: full client history only takes last user as delta", () => {
  const merged = mergeSessionTranscript(
    [
      { role: "user", content: "satu" },
      { role: "assistant", content: "dua" },
    ],
    [
      { role: "user", content: "satu" },
      { role: "assistant", content: "dua" },
      { role: "user", content: "tiga" },
    ],
  );
  deepEqual(merged.append, [{ role: "user", content: "tiga" }]);
  equal(merged.transcript.map((item) => item.content).join("|"), "satu|dua|tiga");
});

Deno.test("mergeSessionTranscript: duplicate last user keeps attachments for this run", () => {
  const merged = mergeSessionTranscript(
    [
      { role: "user", content: "sama" },
    ],
    [{
      role: "user",
      content: "sama",
      attachments: [{ type: "image", name: "a.png", data: "qq" }],
    }],
  );
  equal(merged.append.length, 0);
  equal(merged.transcript.length, 1);
  equal(merged.transcript[0].attachments?.[0].name, "a.png");
});
