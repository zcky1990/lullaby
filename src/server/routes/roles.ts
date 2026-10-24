import { RoleInput } from "../../config/schema.ts";
import {
  createRole,
  deleteRole,
  getLlmProvider,
  getRole,
  listRoles,
  updateRole,
} from "../../db/db.ts";
import { json, readJson, record } from "../http.ts";
import { serializeRole } from "../serializers.ts";

async function roleProviderExists(providerId?: string): Promise<boolean> {
  if (!providerId) return true;
  return (await getLlmProvider(providerId)) !== null;
}

export async function listRolesHandler(): Promise<Response> {
  return json({ roles: (await listRoles()).map(serializeRole) });
}

export async function createRoleHandler(req: Request): Promise<Response> {
  const parsed = RoleInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  if (!(await roleProviderExists(parsed.data.providerId))) {
    return json({ error: "provider_not_found" }, 400);
  }
  const role = await createRole(parsed.data);
  await record("role.created", { id: role.id, name: role.name });
  return json({ role: serializeRole(role) }, 201);
}

export async function updateRoleHandler(roleId: string, req: Request): Promise<Response> {
  const existing = await getRole(roleId);
  if (!existing) return json({ error: "role_not_found" }, 404);
  const parsed = RoleInput.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }
  if (!(await roleProviderExists(parsed.data.providerId))) {
    return json({ error: "provider_not_found" }, 400);
  }
  const role = await updateRole(roleId, parsed.data);
  await record("role.saved", { id: roleId });
  return json({ role: serializeRole(role!) });
}

export async function deleteRoleHandler(roleId: string): Promise<Response> {
  const existing = await getRole(roleId);
  if (!existing) return json({ error: "role_not_found" }, 404);
  await deleteRole(roleId);
  await record("role.deleted", { id: roleId });
  return json({ ok: true });
}
