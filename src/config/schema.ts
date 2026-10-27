import { z } from "zod";

export const IntegrationKind = z.enum([
  "llm",
  "docmost",
  "notion",
  "confluence",
  "jira",
  "github",
]);
export const SingletonKind = z.enum(["docmost", "notion", "confluence", "jira", "github"]);
export type SingletonKind = z.infer<typeof SingletonKind>;
export type IntegrationKind = z.infer<typeof IntegrationKind>;

export const DocumentSource = z.enum(["docmost", "notion", "confluence"]);
export type DocumentSource = z.infer<typeof DocumentSource>;

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

export const RoleInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  persona: z.string().trim().min(1).max(8000),
  providerId: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().trim().max(80).optional(),
  ),
});
export type RoleInput = z.infer<typeof RoleInput>;

export const ChatInput = z.object({
  providerId: z.string().trim().optional(),
  sessionId: z.string().trim().optional(),
  roleId: z.string().trim().optional(),
  skillName: z
    .preprocess(
      (value) => (value === "" || value == null ? undefined : value),
      z.string().trim().max(64).regex(/^[a-z0-9][a-z0-9_-]*$/i).optional(),
    ),
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

export const GitPathsInput = z.object({
  paths: z.array(z.string().trim().min(1).max(1000)).min(1).max(200),
});

export const GitCommitInput = z.object({
  message: z.string().trim().min(1).max(2000),
});

export const GitCheckoutInput = z.object({
  branch: z.string().trim().min(1).max(200),
});

export const GitStashApplyInput = z.object({
  index: z.number().int().min(0).max(100),
  pop: z.boolean().optional().default(false),
});
export type GitStashApplyInput = z.infer<typeof GitStashApplyInput>;

export const GitBranchCreateInput = z.object({
  name: z.string().trim().min(1).max(200),
  checkout: z.boolean().optional().default(true),
});
export type GitBranchCreateInput = z.infer<typeof GitBranchCreateInput>;

export const GitMergeInput = z.object({
  branch: z.string().trim().min(1).max(200),
});
export type GitMergeInput = z.infer<typeof GitMergeInput>;

export const GitStashCreateInput = z.object({
  message: z.string().trim().max(200).optional(),
  includeUntracked: z.boolean().optional().default(true),
});
export type GitStashCreateInput = z.infer<typeof GitStashCreateInput>;

export const GitCloneProtocol = z.enum(["https", "ssh"]);
export type GitCloneProtocol = z.infer<typeof GitCloneProtocol>;

export const GitCloneInput = z.object({
  url: z.string().trim().min(1).max(2000),
  protocol: GitCloneProtocol.default("https"),
});
export type GitCloneInput = z.infer<typeof GitCloneInput>;

export const UpdateFileInput = z.object({
  path: z.string().trim().min(1).max(1000),
  content: z.string().max(2_000_000),
});

export const GenerateTicketsInput = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(200_000),
  providerId: z.string().trim().optional(),
  variant: ChatVariant.default("medium"),
});
export type GenerateTicketsInput = z.infer<typeof GenerateTicketsInput>;

export const ChatChangeInput = z.object({
  runId: z.string().trim().min(1),
  callId: z.string().trim().min(1),
  hunk: z.number().int().min(0),
  accept: z.boolean(),
});
export type ChatChangeInput = z.infer<typeof ChatChangeInput>;

export const ChatChangeAllInput = z.object({
  runId: z.string().trim().min(1),
  accept: z.boolean(),
});
export type ChatChangeAllInput = z.infer<typeof ChatChangeAllInput>;

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

export const PromptsSettingsInput = z.object({
  systemPrompt: z.string().max(20_000),
  planPrompt: z.string().max(20_000),
});

export const SkillsSettingsInput = z.object({
  enabled: z.boolean(),
  disabled: z.array(z.string().trim().min(1).max(120)).max(200),
});
export type McpSettingsInput = z.infer<typeof McpSettingsInput>;
export type SkillsSettingsInput = z.infer<typeof SkillsSettingsInput>;

export const AutomationSettingsInput = z.object({
  autoBuildOnInProgress: z.boolean().default(false),
});
export type AutomationSettingsInput = z.infer<typeof AutomationSettingsInput>;

export const TerminalShell = z.enum(["zsh", "bash"]);
export type TerminalShell = z.infer<typeof TerminalShell>;

export const TerminalSettingsInput = z.object({
  shell: TerminalShell,
});
export type TerminalSettingsInput = z.infer<typeof TerminalSettingsInput>;

export const AutoskillsInput = z.object({
  dryRun: z.boolean().optional().default(false),
});
export type AutoskillsInput = z.infer<typeof AutoskillsInput>;

export const LocalTicketStatus = z.enum(["Backlog", "To Do", "In Progress", "Test", "Done"]);
export type LocalTicketStatus = z.infer<typeof LocalTicketStatus>;

export const LocalTicketPriority = z.enum(["Low", "Medium", "High", "Urgent"]);
export const LocalTicketType = z.enum(["Task", "Bug", "Story"]);

export const LocalTicketInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).optional(),
  status: LocalTicketStatus.default("Backlog"),
  priority: LocalTicketPriority.nullable().optional(),
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

export const TicketTransitionInput = z.object({
  status: z.string().trim().min(1).max(80),
});
export type TicketTransitionInput = z.infer<typeof TicketTransitionInput>;

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

export const NotionConfig = z.object({
  apiToken: z.string().trim().optional(),
  parentPageId: optionalText,
});

export const ConfluenceConfig = z.object({
  baseUrl: httpUrl,
  email: z.string().trim().optional(),
  apiToken: z.string().trim().optional(),
  spaceKey: optionalText,
});

export type DocmostConfig = z.infer<typeof DocmostConfig>;
export type JiraConfig = z.infer<typeof JiraConfig>;
export type GithubConfig = z.infer<typeof GithubConfig>;
export type NotionConfig = z.infer<typeof NotionConfig>;
export type ConfluenceConfig = z.infer<typeof ConfluenceConfig>;

export function parseIntegrationConfig(kind: IntegrationKind, config: Record<string, unknown>) {
  switch (kind) {
    case "docmost":
      return DocmostConfig.safeParse(config);
    case "notion":
      return NotionConfig.safeParse(config);
    case "confluence":
      return ConfluenceConfig.safeParse(config);
    case "jira":
      return JiraConfig.safeParse(config);
    case "github":
      return GithubConfig.safeParse(config);
    case "llm":
      return { success: true as const, data: config };
  }
}
