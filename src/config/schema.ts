import { z } from "zod";

export const IntegrationKind = z.enum(["llm", "docmost", "jira", "github"]);
export const SingletonKind = z.enum(["docmost", "jira", "github"]);
export type SingletonKind = z.infer<typeof SingletonKind>;
export type IntegrationKind = z.infer<typeof IntegrationKind>;

export const IntegrationMode = z.enum(["api", "mcp"]);
export type IntegrationMode = z.infer<typeof IntegrationMode>;

const optionalText = z
  .string()
  .trim()
  .max(400)
  .optional()
  .transform((v) => (v === "" ? undefined : v));

const httpOnly = (value: string) => /^https?:\/\//i.test(value);
const httpUrl = z
  .string()
  .trim()
  .url()
  .refine(httpOnly, { message: "URL harus http(s)" });

export const ProjectInput = z.object({
  name: z.string().trim().min(1).max(120),
  workspacePath: optionalText,
  documentPath: optionalText,
  docmostSpaceId: optionalText,
  jiraProjectKey: optionalText,
  githubRepo: optionalText,
});
export type ProjectInput = z.infer<typeof ProjectInput>;

export const ProjectUpdateInput = ProjectInput.partial();
export type ProjectUpdateInput = z.infer<typeof ProjectUpdateInput>;

export const IntegrationInput = z.object({
  kind: IntegrationKind,
  mode: IntegrationMode.default("api"),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type IntegrationInput = z.infer<typeof IntegrationInput>;

const optionalUrl = z.preprocess(
  (v) => (v === "" ? undefined : v),
  httpUrl.optional(),
);

export const LlmProviderInput = z.object({
  name: z.string().trim().min(1).max(80),
  provider: z.string().trim().min(1).max(40).default("openai"),
  model: optionalText,
  baseUrl: optionalUrl,
  apiKey: optionalText,
  mode: IntegrationMode.default("api"),
});
export type LlmProviderInput = z.infer<typeof LlmProviderInput>;

export const ChatVariant = z.enum(["low", "medium", "high"]);
export type ChatVariant = z.infer<typeof ChatVariant>;

export const ChatMode = z.enum(["plan", "build"]);
export type ChatMode = z.infer<typeof ChatMode>;

export const ChatAttachmentInput = z
  .object({
    type: z.enum(["image", "text", "workspace"]),
    name: z.string().trim().min(1).max(200),
    mime: z.string().trim().max(120).optional(),
    path: z.string().trim().max(500).optional(),
    data: z.string().max(8_000_000).optional(),
  })
  .refine((value) => (value.type === "workspace" ? Boolean(value.path) : Boolean(value.data)), {
    message: "Lampiran tidak lengkap",
  });
export type ChatAttachmentInput = z.infer<typeof ChatAttachmentInput>;

export const ChatInput = z.object({
  providerId: z.string().trim().optional(),
  sessionId: z.string().trim().optional(),
  variant: ChatVariant.default("medium"),
  mode: ChatMode.default("build"),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().min(1).max(8000),
        attachments: z.array(ChatAttachmentInput).max(6).optional(),
      }),
    )
    .min(1)
    .max(60),
});
export type ChatInput = z.infer<typeof ChatInput>;

export const ChatApproveInput = z.object({
  runId: z.string().trim().min(1),
  id: z.string().trim().min(1),
  action: z.enum(["once", "always", "deny"]),
});
export type ChatApproveInput = z.infer<typeof ChatApproveInput>;

export const McpTransport = z.enum(["stdio", "http"]);
export type McpTransport = z.infer<typeof McpTransport>;

const optionalHttpUrl = z.preprocess((v) => (v === "" ? undefined : v), httpUrl.optional());
const envRecord = z.record(z.string().trim().min(1).max(100), z.string().max(2000));

export const McpServerInput = z
  .object({
    id: z.string().trim().min(1).max(80).optional(),
    name: z.string().trim().min(1).max(80),
    transport: McpTransport.default("stdio"),
    command: z.string().trim().max(300).optional(),
    args: z.array(z.string().max(300)).max(30).default([]),
    url: optionalHttpUrl,
    headers: envRecord.optional(),
    env: envRecord.optional(),
    enabled: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.transport === "stdio" && !value.command) {
      ctx.addIssue({
        code: "custom",
        message: "Command wajib untuk transport stdio.",
        path: ["command"],
      });
    }
    if (value.transport === "http" && !value.url) {
      ctx.addIssue({ code: "custom", message: "URL wajib untuk transport http.", path: ["url"] });
    }
  });
export type McpServerInput = z.infer<typeof McpServerInput>;

export const McpSettingsInput = z.object({
  servers: z.array(McpServerInput).max(20),
  enabled: z.boolean().default(true),
  disabledTools: z.array(z.string().trim().min(1).max(200)).max(1000).default([]),
});

export const SkillsSettingsInput = z.object({
  enabled: z.boolean(),
  disabled: z.array(z.string().trim().min(1).max(120)).max(200),
});
export type McpSettingsInput = z.infer<typeof McpSettingsInput>;

export const LocalTicketStatus = z.enum(["Backlog", "To Do", "In Progress", "Test", "Done"]);
export type LocalTicketStatus = z.infer<typeof LocalTicketStatus>;

export const LocalTicketPriority = z.enum(["Low", "Medium", "High", "Urgent"]);
export const LocalTicketType = z.enum(["Task", "Bug", "Story"]);

export const LocalTicketInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).optional(),
  status: LocalTicketStatus.default("Backlog"),
  priority: LocalTicketPriority.optional(),
  type: LocalTicketType.default("Task"),
  assignee: z.string().trim().max(120).optional(),
  labels: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
});
export type LocalTicketInput = z.infer<typeof LocalTicketInput>;

export const LocalTicketUpdateInput = LocalTicketInput.partial();
export type LocalTicketUpdateInput = z.infer<typeof LocalTicketUpdateInput>;

export const LocalDocumentInput = z.object({
  title: z.string().trim().min(1).max(200),
});

export const LocalDocumentUpdateInput = z.object({
  path: z.string().trim().min(1).max(500),
  title: z.string().trim().max(200).optional(),
  content: z.string().max(500_000).optional(),
});

export const LocalDocumentSyncInput = z.object({
  path: z.string().trim().min(1).max(500),
});

export const CreateDocumentInput = z.object({
  title: z.string().trim().min(1).max(200),
  parentPageId: z.string().trim().max(200).optional(),
});
export type CreateDocumentInput = z.infer<typeof CreateDocumentInput>;

export const UpdateDocumentInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(500_000),
});
export type UpdateDocumentInput = z.infer<typeof UpdateDocumentInput>;

export const DocmostConfig = z.object({
  baseUrl: httpUrl,
  apiToken: z.string().trim().optional(),
  workspace: z.string().trim().optional(),
  spaceId: z.string().trim().optional(),
});

export const JiraConfig = z.object({
  baseUrl: httpUrl,
  deployment: z.enum(["cloud", "data-center"]).default("cloud"),
  cloudId: z.string().trim().optional(),
  projectKey: z.string().trim().default(""),
  email: z.string().trim().optional(),
  apiToken: z.string().trim().optional(),
});

export const GithubConfig = z.object({
  baseUrl: httpUrl.default("https://api.github.com"),
  token: z.string().trim().optional(),
  org: z.string().trim().optional(),
  repo: z.string().trim().optional(),
  defaultBranch: z.string().trim().default("main"),
});
export type DocmostConfig = z.infer<typeof DocmostConfig>;
export type JiraConfig = z.infer<typeof JiraConfig>;
export type GithubConfig = z.infer<typeof GithubConfig>;
