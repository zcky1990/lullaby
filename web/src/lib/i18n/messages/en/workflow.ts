import type { MessageDict } from "../../types";

/** Workflow, cron, dan dialog parameter. */
export const workflow: MessageDict = {
  // WorkflowPanel
  "workflow.panel.title": "Workflows",
  "workflow.panel.newWorkflow": "New workflow",
  "workflow.panel.docsTitle": "Workflow documentation",
  "workflow.panel.refresh": "Refresh workflows",
  "workflow.panel.refreshTitle": "Refresh",
  "workflow.panel.sourceWorkspace": "workspace",
  "workflow.panel.sourceApp": "app data",
  "workflow.panel.sourceInfo": "{source}: {root}",
  "workflow.panel.empty":
    "No workflows yet. Click “New workflow” or create a `.yaml` file in the folder above.",
  "workflow.panel.stepCount": "{count} steps",
  "workflow.panel.cronOff": " (off)",
  "workflow.panel.recentRuns": "Recent runs",
  "workflow.panel.noRuns": "No runs yet.",

  // WorkflowTab
  "workflow.tab.noSelection":
    "Select a workflow in the left panel or create a new one.",
  "workflow.tab.confirmDeleteRun": "Delete this run from history?",
  "workflow.tab.confirmDeleteWorkflow": "Delete workflow \"{name}\"?",
  "workflow.tab.deleteWorkflow": "Delete workflow",
  "workflow.tab.yamlError": "YAML error: {error}",
  "workflow.tab.schedule": "Schedule",
  "workflow.tab.nextRun": "next: {value}",
  "workflow.tab.editor": "Editor",
  "workflow.tab.graph": "Graph",
  "workflow.tab.log": "Log",
  "workflow.tab.noLog": "(no log yet)",
  "workflow.tab.steps": "Steps",
  "workflow.tab.run": "Run",
  "workflow.tab.cancelRun": "Cancel run",
  "workflow.tab.continueRun": "Continue from failed (use cached outputs)",
  "workflow.tab.playFromStep": "Re-run from {step}",
  "workflow.tab.playFromStepAria": "Re-run workflow from step {step}",

  // WorkflowTab — run list
  "workflow.runs.title": "Runs",
  "workflow.runs.refresh": "Refresh workflow",
  "workflow.runs.empty": "No runs yet.",
  "workflow.runs.delete": "Delete run",
  "workflow.runs.deleteAria": "Delete run {id}",

  // WorkflowParamsDialog
  "workflow.params.title": "Workflow parameters",
  "workflow.params.descriptionAgent":
    "Fill in the parameters before running. Agent params support a prompt, file attachments, and model selection.",
  "workflow.params.descriptionPlain":
    "Fill in the parameter values before running the workflow. Defaults from the YAML are pre-filled.",
  "workflow.params.agentPlaceholder":
    "Agent prompt… attach files or drop them here",
  "workflow.params.removeAttachment": "Remove {name}",
  "workflow.params.attachFile": "Attach file",
  "workflow.params.attachTitle": "Attach image/text file",
  "workflow.params.noProviders":
    "No LLM provider yet (Global Settings → LLM Providers).",
  "workflow.params.cancel": "Cancel",
  "workflow.params.run": "Run",

  // CronPanel
  "workflow.cronPanel.title": "Cron",
  "workflow.cronPanel.docs": "Documentation",
  "workflow.cronPanel.docsTitle": "Cron & event documentation",
  "workflow.cronPanel.refresh": "Refresh schedules",
  "workflow.cronPanel.refreshTitle": "Refresh",
  "workflow.cronPanel.hint": "Workflows with `schedule` or `on` in the YAML.",
  "workflow.cronPanel.empty":
    "No schedules yet. Add `schedule` / `on` to the workflow YAML, then Save.",
  "workflow.cronPanel.on": "on",
  "workflow.cronPanel.off": "off",
  "workflow.cronPanel.eventCount": "{count} events",
  "workflow.cronPanel.next": "next {value}",

  // CronTab
  "workflow.cron.title": "Cron & Event",
  "workflow.cron.scheduleCount": "{count} schedules",
  "workflow.cron.refresh": "Refresh",
  "workflow.cron.empty": "No scheduled workflows yet.",
  "workflow.cron.emptyHintPrefix": "Add ",
  "workflow.cron.emptyHintOr": " or ",
  "workflow.cron.emptyHintSuffix":
    " to the YAML (Workflows menu), Save, then refresh here.",
  "workflow.cron.schedule": "Schedule",
  "workflow.cron.openWorkflow": "Open workflow",
  "workflow.cron.openWorkflowAria": "Open workflow {name}",
  "workflow.cron.next": "next: {value}",
  "workflow.cron.last": "last: {value}",
};
