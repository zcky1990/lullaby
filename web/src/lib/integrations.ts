export interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  type?: "select" | "password";
  options?: string[];
  secret?: boolean;
}

export interface SingletonDef {
  kind: string;
  label: string;
  fields: FieldDef[];
}

export const SINGLETONS: SingletonDef[] = [
  {
    kind: "docmost",
    label: "Docmost (PRD)",
    fields: [
      { key: "baseUrl", label: "Base URL", placeholder: "https://docmost.example.com" },
      {
        key: "apiToken",
        label: "API Token",
        placeholder: "docmost bearer token",
        type: "password",
        secret: true,
      },
      {
        key: "spaceId",
        label: "Space ID (id, bukan nama)",
        placeholder: "UUID space — kosongkan bila hanya ada 1 space",
      },
    ],
  },
  {
    kind: "jira",
    label: "Jira (Board)",
    fields: [
      { key: "baseUrl", label: "Base URL", placeholder: "https://acme.atlassian.net" },
      {
        key: "deployment",
        label: "Deployment",
        type: "select",
        options: ["cloud", "data-center"],
      },
      { key: "cloudId", label: "Cloud ID (OAuth 3LO)", placeholder: "xxxxxxxx" },
      { key: "projectKey", label: "Project Key", placeholder: "PROJ" },
      { key: "email", label: "Email", placeholder: "bot@example.com" },
      {
        key: "apiToken",
        label: "API Token",
        placeholder: "jira api token",
        type: "password",
        secret: true,
      },
    ],
  },
  {
    kind: "github",
    label: "GitHub (Code)",
    fields: [
      { key: "baseUrl", label: "Base URL", placeholder: "https://api.github.com" },
      { key: "org", label: "Org", placeholder: "acme" },
      { key: "repo", label: "Repo", placeholder: "storefront" },
      { key: "defaultBranch", label: "Default Branch", placeholder: "main" },
      {
        key: "token",
        label: "Token",
        placeholder: "ghp_… or app token",
        type: "password",
        secret: true,
      },
    ],
  },
];

export const PROVIDER_FIELDS: FieldDef[] = [
  { key: "name", label: "Name", placeholder: "Anthropic Cloud" },
  { key: "provider", label: "Provider", placeholder: "anthropic | openai | ollama" },
  { key: "model", label: "Model", placeholder: "claude-sonnet-4" },
  { key: "baseUrl", label: "Base URL", placeholder: "https://api.anthropic.com/v1" },
  {
    key: "apiKey",
    label: "API Key",
    placeholder: "sk-ant-…",
    type: "password",
    secret: true,
  },
];
