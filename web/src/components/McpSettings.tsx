import { lazy, Suspense, useEffect, useState } from "react";
import { Braces, Pencil, Plus, Server, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { useTheme } from "@/components/ThemeProvider";
import { api, type McpServer } from "@/lib/api";

const MonacoViewer = lazy(() => import("@/components/MonacoViewer"));

function parsePairs(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (key) result[key] = line.slice(index + 1).trim();
  }
  return result;
}

function formatPairs(value?: Record<string, string>): string {
  return Object.entries(value ?? {})
    .map(([key, item]) => `${key}=${item}`)
    .join("\n");
}


interface CursorServerJson {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  url?: unknown;
  headers?: unknown;
  enabled?: unknown;
}

const ADD_TEMPLATE = `{
  "mcpServers": {
    "server-baru": {
      "command": "npx",
      "args": ["-y", "nama-paket-mcp"]
    }
  }
}`;

function pairObject(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key) result[key] = String(item ?? "");
  }
  return Object.keys(result).length ? result : undefined;
}

function serverFromJson(name: string, raw: unknown): McpServer {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`"${name}": harus berupa objek.`);
  }
  const cfg = raw as CursorServerJson;
  const command = typeof cfg.command === "string" ? cfg.command.trim() : "";
  const url = typeof cfg.url === "string" ? cfg.url.trim() : "";
  if (!command && !url) throw new Error(`"${name}": butuh "command" atau "url".`);
  if (url && !/^https?:\/\//i.test(url)) throw new Error(`"${name}": url harus http(s).`);
  const args = Array.isArray(cfg.args) ? cfg.args.map(String) : [];
  return {
    id: "",
    name,
    transport: url ? "http" : "stdio",
    command: command || undefined,
    args: url ? [] : args,
    url: url || undefined,
    headers: pairObject(cfg.headers),
    env: pairObject(cfg.env),
    enabled: cfg.enabled !== false,
  };
}

function parseMcpJson(text: string): Array<{ name: string; server: McpServer }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`JSON tidak valid: ${(error as Error).message}`);
  }
  const servers = (parsed as { mcpServers?: unknown } | null)?.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    throw new Error('JSON harus berisi objek "mcpServers".');
  }
  const entries = Object.entries(servers as Record<string, unknown>);
  if (!entries.length) throw new Error("Minimal satu server di mcpServers.");
  return entries.map(([name, raw]) => ({ name, server: serverFromJson(name, raw) }));
}

function serversToJson(servers: McpServer[]): string {
  const mcpServers: Record<string, unknown> = {};
  for (const server of servers) {
    const entry: Record<string, unknown> = server.transport === "stdio"
      ? { command: server.command, args: server.args }
      : { url: server.url };
    if (server.transport === "stdio" && server.env) entry.env = server.env;
    if (server.transport === "http" && server.headers) entry.headers = server.headers;
    if (!server.enabled) entry.enabled = false;
    mcpServers[server.name] = entry;
  }
  return JSON.stringify({ mcpServers }, null, 2);
}

export function McpSettings() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonMode, setJsonMode] = useState<"add" | "edit">("add");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | undefined>();
  const [jsonSaving, setJsonSaving] = useState(false);
  const { resolvedEditorTheme } = useTheme();

  useEffect(() => {
    api
      .getMcpSettings()
      .then((res) => setServers(res.servers))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const persist = async (next: McpServer[]) => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.saveMcpSettings(next);
      setServers(res.servers);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (server: McpServer) => {
    try {
      await persist(
        servers.map((item) => (item.id === server.id ? { ...item, enabled: !item.enabled } : item)),
      );
    } catch {
      // error shown above
    }
  };

  const remove = async (server: McpServer) => {
    try {
      await persist(servers.filter((item) => item.id !== server.id));
    } catch {
      // error shown above
    }
  };

  const saveServer = async (server: McpServer) => {
    const exists = servers.some((item) => item.id === server.id);
    await persist(
      exists ? servers.map((item) => (item.id === server.id ? server : item)) : [...servers, server],
    );
    setDialogOpen(false);
  };

  const openJson = (mode: "add" | "edit") => {
    setJsonMode(mode);
    setJsonText(mode === "add" ? ADD_TEMPLATE : serversToJson(servers));
    setJsonError(undefined);
    setJsonOpen(true);
  };

  const saveJson = async () => {
    setJsonSaving(true);
    setJsonError(undefined);
    try {
      const entries = parseMcpJson(jsonText);
      let next: McpServer[];
      if (jsonMode === "edit") {
        const byName = new Map(servers.map((item) => [item.name, item]));
        next = entries.map(({ name, server }) => ({
          ...server,
          id: byName.get(name)?.id ?? crypto.randomUUID(),
        }));
      } else {
        next = [...servers];
        for (const { name, server } of entries) {
          const index = next.findIndex((item) => item.name === name);
          if (index >= 0) next[index] = { ...server, id: next[index].id };
          else next.push({ ...server, id: crypto.randomUUID() });
        }
      }
      await persist(next);
      setJsonOpen(false);
    } catch (e) {
      setJsonError((e as Error).message);
    } finally {
      setJsonSaving(false);
    }
  };

  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium tracking-wider text-muted-foreground uppercase">MCP</h2>
        <p className="text-sm text-muted-foreground">
          Konfigurasi server MCP global (Model Context Protocol). Server disimpan lokal di app dan
          dipakai oleh agent saat integrasi MCP diaktifkan.
        </p>
        <Separator />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{servers.length} server</span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            data-icon="inline-start"
            onClick={() => openJson("edit")}
          >
            <Braces />
            Edit JSON
          </Button>
          <Button size="sm" data-icon="inline-start" onClick={() => openJson("add")}>
            <Plus />
            Tambah server
          </Button>
        </div>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Memuat konfigurasi MCP…
        </div>
      ) : servers.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Belum ada server MCP. Tambahkan server stdio (command) atau http (url).
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {servers.map((server) => (
            <div key={server.id} className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Server className="size-4 text-muted-foreground" />
                <span className="font-medium">{server.name}</span>
                <Badge variant="outline">{server.transport}</Badge>
                <Badge variant={server.enabled ? "secondary" : "outline"}>
                  {server.enabled ? "Aktif" : "Nonaktif"}
                </Badge>
                <div className="ml-auto flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => toggle(server)} disabled={busy}>
                    {server.enabled ? "Nonaktifkan" : "Aktifkan"}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Edit ${server.name}`}
                    onClick={() => {
                      setEditing(server);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Hapus ${server.name}`}
                    onClick={() => remove(server)}
                    disabled={busy}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {server.transport === "stdio"
                  ? [server.command, ...(server.args ?? [])].join(" ")
                  : server.url}
              </p>
            </div>
          ))}
        </div>
      )}

      <McpServerDialog
        server={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={saveServer}
      />

      <Dialog open={jsonOpen} onOpenChange={setJsonOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {jsonMode === "add" ? "Tambah server MCP (JSON)" : "Edit konfigurasi MCP (JSON)"}
            </DialogTitle>
            <DialogDescription>
              Format sama seperti <span className="font-mono">mcp.json</span> di Cursor:
              <span className="font-mono"> mcpServers</span> berisi command/args/env atau
              url/headers.
            </DialogDescription>
          </DialogHeader>
          <div className="h-80 overflow-hidden rounded-md border">
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Spinner />
                </div>
              }
            >
              <MonacoViewer
                path="mcp.json"
                language="json"
                content={jsonText}
                theme={resolvedEditorTheme}
                readOnly={false}
                onChange={setJsonText}
              />
            </Suspense>
          </div>
          {jsonError ? <p className="text-xs text-destructive">{jsonError}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setJsonOpen(false)} disabled={jsonSaving}>
              Batal
            </Button>
            <Button onClick={saveJson} disabled={jsonSaving} data-icon="inline-start">
              {jsonSaving ? <Spinner /> : <Braces />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function McpServerDialog({
  server,
  open,
  onOpenChange,
  onSave,
}: {
  server: McpServer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (server: McpServer) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState("");
  const [env, setEnv] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    setName(server?.name ?? "");
    setTransport(server?.transport ?? "stdio");
    setCommand(server?.command ?? "");
    setArgs((server?.args ?? []).join("\n"));
    setUrl(server?.url ?? "");
    setHeaders(formatPairs(server?.headers));
    setEnv(formatPairs(server?.env));
    setError(undefined);
  }, [open, server]);

  const submit = async () => {
    const clean = name.trim();
    if (!clean) {
      setError("Nama server wajib diisi.");
      return;
    }
    if (transport === "stdio" && !command.trim()) {
      setError("Command wajib untuk transport stdio.");
      return;
    }
    if (transport === "http" && !url.trim()) {
      setError("URL wajib untuk transport http.");
      return;
    }
    const payload: McpServer = {
      id: server?.id ?? crypto.randomUUID(),
      name: clean,
      transport,
      command: transport === "stdio" ? command.trim() : undefined,
      args: transport === "stdio"
        ? args.split("\n").map((line) => line.trim()).filter(Boolean)
        : [],
      url: transport === "http" ? url.trim() : undefined,
      headers: transport === "http" ? parsePairs(headers) : undefined,
      env: transport === "stdio" ? parsePairs(env) : undefined,
      enabled: server?.enabled ?? true,
    };
    setSaving(true);
    setError(undefined);
    try {
      await onSave(payload);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{server ? "Edit server MCP" : "Tambah server MCP"}</DialogTitle>
          <DialogDescription>
            Konfigurasi disimpan lokal. Header/env dapat berisi token.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mcp-name">Nama</Label>
            <Input
              id="mcp-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="mis. filesystem"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Transport</Label>
            <Select
              value={transport}
              onValueChange={(value) => setTransport(value as "stdio" | "http")}
            >
              <SelectTrigger size="sm" className="w-full" aria-label="Transport MCP">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="stdio">stdio (command)</SelectItem>
                  <SelectItem value="http">http (url)</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {transport === "stdio" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-command">Command</Label>
                <Input
                  id="mcp-command"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="npx"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-args">Args (satu per baris)</Label>
                <textarea
                  id="mcp-args"
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                  rows={3}
                  placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/path"}
                  className="border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-none rounded-md border bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-env">Env (KEY=VALUE per baris)</Label>
                <textarea
                  id="mcp-env"
                  value={env}
                  onChange={(event) => setEnv(event.target.value)}
                  rows={2}
                  placeholder="API_KEY=..."
                  className="border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-none rounded-md border bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px]"
                />
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-url">URL</Label>
                <Input
                  id="mcp-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://example.com/mcp"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-headers">Headers (KEY=VALUE per baris)</Label>
                <textarea
                  id="mcp-headers"
                  value={headers}
                  onChange={(event) => setHeaders(event.target.value)}
                  rows={2}
                  placeholder="Authorization=Bearer ..."
                  className="border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-none rounded-md border bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px]"
                />
              </div>
            </>
          )}

          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Batal
          </Button>
          <Button onClick={submit} disabled={saving} data-icon="inline-start">
            {saving ? <Spinner /> : <Plus />}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
