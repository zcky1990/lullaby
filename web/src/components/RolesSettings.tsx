import { useEffect, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
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
import type { LlmProvider, Role } from "@/lib/api";

interface RolePayload {
  name: string;
  description?: string;
  persona: string;
  providerId?: string;
}

interface Props {
  roles: Role[];
  providers: LlmProvider[];
  addingRole: boolean;
  onAddRole: (value: boolean) => void;
  onSaveRole: (id: string | null, payload: RolePayload) => Promise<void>;
  onDeleteRole: (id: string) => Promise<void>;
}

export function RolesSettings({
  roles,
  providers,
  addingRole,
  onAddRole,
  onSaveRole,
  onDeleteRole,
}: Props) {
  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-medium tracking-wider text-muted-foreground uppercase">
              Roles
            </h2>
            <p className="text-sm text-muted-foreground">
              Role menentukan persona dan provider LLM yang dipakai otomatis saat chat.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAddRole(true)}
            data-icon="inline-start"
          >
            <Plus />
            Role
          </Button>
        </div>
        <Separator />
      </div>

      {roles.length === 0 && !addingRole ? (
        <p className="text-sm text-muted-foreground">
          Belum ada role. Tambahkan role untuk persona + provider khusus.
        </p>
      ) : null}

      {roles.map((role) => (
        <Collapsible key={role.id + role.updatedAt} defaultOpen={false} className="rounded-md border">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between px-3">
              <span className="truncate text-left">
                {role.name}
                {role.description ? ` · ${role.description}` : ""}
              </span>
              <ChevronDown className="size-4 shrink-0" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t p-3">
            <RoleForm
              role={role}
              providers={providers}
              onSave={(payload) => onSaveRole(role.id, payload)}
              onDelete={() => onDeleteRole(role.id)}
            />
          </CollapsibleContent>
        </Collapsible>
      ))}

      {addingRole ? (
        <Collapsible defaultOpen className="rounded-md border">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between px-3">
              Role baru
              <ChevronDown className="size-4 shrink-0" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t p-3">
            <RoleForm
              providers={providers}
              onSave={(payload) => onSaveRole(null, payload)}
              onCancel={() => onAddRole(false)}
            />
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </section>
  );
}

function RoleForm({
  role,
  providers,
  onSave,
  onDelete,
  onCancel,
}: {
  role?: Role;
  providers: LlmProvider[];
  onSave: (payload: RolePayload) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [persona, setPersona] = useState(role?.persona ?? "");
  const [providerId, setProviderId] = useState(role?.providerId ?? "none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
    setPersona(role?.persona ?? "");
    setProviderId(role?.providerId ?? "none");
    setError(undefined);
  }, [role]);

  const save = async () => {
    if (!name.trim() || !persona.trim()) {
      setError("Nama dan persona wajib diisi.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        persona: persona.trim(),
        providerId: providerId === "none" ? undefined : providerId,
      });
      onCancel?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!onDelete) return;
    if (!confirm(`Hapus role "${role?.name}"?`)) return;
    setBusy(true);
    setError(undefined);
    try {
      await onDelete();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Nama</span>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="mis. Backend Engineer"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Deskripsi singkat</span>
        <Input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="opsional"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Persona</span>
        <textarea
          value={persona}
          onChange={(event) => setPersona(event.target.value)}
          rows={7}
          placeholder="Kamu adalah senior backend engineer. Selalu pertimbangkan performa, keamanan, dan test…"
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Provider LLM</span>
        <Select value={providerId} onValueChange={setProviderId}>
          <SelectTrigger size="sm" className="w-full" aria-label="Provider role">
            <SelectValue placeholder="Ikuti pilihan chat" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="none">Ikuti pilihan chat</SelectItem>
              {providers.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}
                  {provider.model ? ` · ${provider.model}` : ""}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <span className="text-[11px] text-muted-foreground">
          Jika dipilih, chat otomatis memakai provider ini saat role aktif.
        </span>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy} data-icon="inline-start">
          {busy ? <Spinner /> : null}
          Simpan
        </Button>
        {onCancel ? (
          <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
            Batal
          </Button>
        ) : null}
        {onDelete ? (
          <Button
            size="sm"
            variant="outline"
            onClick={remove}
            disabled={busy}
            className="text-destructive"
          >
            Hapus
          </Button>
        ) : null}
      </div>
    </div>
  );
}
