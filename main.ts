import { bootstrap } from "./src/core/bootstrap.ts";
import { createMainWindow } from "./src/desktop/window.ts";
import { handleRequest } from "./src/server/router.ts";

await bootstrap();

function listenOptions(): Deno.ServeTcpOptions {
  const raw = Deno.env.get("DENO_SERVE_ADDRESS");
  if (raw) {
    const idx = raw.lastIndexOf(":");
    const port = Number(raw.slice(idx + 1));
    if (Number.isFinite(port) && port > 0) {
      return { hostname: "127.0.0.1", port };
    }
  }
  return { hostname: "127.0.0.1" };
}

const opts = listenOptions();
createMainWindow({ title: "RND Workflow" });

Deno.serve(opts, handleRequest);

console.log(`RND Workflow listening on 127.0.0.1:${opts.port ?? "(auto)"}`);
