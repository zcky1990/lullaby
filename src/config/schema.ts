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
