import { bootstrap } from "./src/core/bootstrap.ts";
import { createMainWindow } from "./src/desktop/window.ts";
import { handleRequest } from "./src/server/router.ts";

await bootstrap();

const port = Deno.env.get("DENO_SERVE_ADDRESS")?.split(":").pop() ?? "?";
createMainWindow({ title: "RND Workflow" });

Deno.serve(handleRequest);

console.log(`RND Workflow listening on 127.0.0.1:${port}`);
