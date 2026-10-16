import { subscribe, subscriberCount } from "./bus.ts";

const MAX_SSE_CLIENTS = 20;

export function sse(req: Request): Response {
  if (subscriberCount() >= MAX_SSE_CLIENTS) {
    return new Response("too many event streams", { status: 429 });
  }
  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };
      send(JSON.stringify({ type: "hello", ts: new Date().toISOString() }));
      unsubscribe = subscribe(send);
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          unsubscribe();
        }
      }, 15000);

      const cleanup = () => {
        if (heartbeat !== undefined) clearInterval(heartbeat);
        unsubscribe();
      };
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      if (heartbeat !== undefined) clearInterval(heartbeat);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
