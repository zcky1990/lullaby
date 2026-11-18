import type { MessageDict } from "../../types";

/** Workflow, cron, dan dialog parameter. */
export const workflow: MessageDict = {
  // WorkflowPanel
  "workflow.panel.title": "Workflows",
  "workflow.panel.newWorkflow": "Workflow baru",
  "workflow.panel.docsTitle": "Dokumentasi workflow",
  "workflow.panel.refresh": "Refresh workflows",
  "workflow.panel.refreshTitle": "Refresh",
  "workflow.panel.sourceWorkspace": "workspace",
  "workflow.panel.sourceApp": "app data",
  "workflow.panel.sourceInfo": "{source}: {root}",
  "workflow.panel.empty":
    "Belum ada workflow. Klik “Workflow baru” atau buat file `.yaml` di folder di atas.",
  "workflow.panel.stepCount": "{count} step",
  "workflow.panel.cronOff": " (off)",
  "workflow.panel.recentRuns": "Recent runs",
  "workflow.panel.noRuns": "Belum ada run.",

  // WorkflowTab
  "workflow.tab.noSelection":
    "Pilih workflow di panel kiri atau buat workflow baru.",
  "workflow.tab.confirmDeleteRun": "Hapus run ini dari riwayat?",
  "workflow.tab.confirmDeleteWorkflow": "Hapus workflow \"{name}\"?",
  "workflow.tab.deleteWorkflow": "Hapus workflow",
  "workflow.tab.yamlError": "YAML error: {error}",
  "workflow.tab.schedule": "Schedule",
  "workflow.tab.nextRun": "next: {value}",
  "workflow.tab.editor": "Editor",
  "workflow.tab.graph": "Graph",
  "workflow.tab.log": "Log",
  "workflow.tab.noLog": "(belum ada log)",
  "workflow.tab.steps": "Steps",
  "workflow.tab.run": "Jalankan",
  "workflow.tab.cancelRun": "Batalkan run",
  "workflow.tab.continueRun": "Lanjutkan dari gagal (pakai output cache)",

  // WorkflowTab — daftar run
  "workflow.runs.title": "Runs",
  "workflow.runs.refresh": "Refresh workflow",
  "workflow.runs.empty": "Belum ada run.",
  "workflow.runs.delete": "Hapus run",
  "workflow.runs.deleteAria": "Hapus run {id}",

  // WorkflowParamsDialog
  "workflow.params.title": "Parameter workflow",
  "workflow.params.descriptionAgent":
    "Isi param sebelum run. Param bertipe agent mendukung prompt, lampiran file, dan pilihan model.",
  "workflow.params.descriptionPlain":
    "Isi nilai param sebelum menjalankan workflow. Default dari YAML sudah terisi.",
  "workflow.params.agentPlaceholder":
    "Prompt agent… lampirkan file atau seret ke sini",
  "workflow.params.removeAttachment": "Hapus {name}",
  "workflow.params.attachFile": "Lampirkan file",
  "workflow.params.attachTitle": "Lampirkan gambar/file teks",
  "workflow.params.noProviders":
    "Belum ada provider LLM (Global Settings → LLM Providers).",
  "workflow.params.cancel": "Batal",
  "workflow.params.run": "Jalankan",

  // CronPanel
  "workflow.cronPanel.title": "Cron",
  "workflow.cronPanel.docs": "Dokumentasi",
  "workflow.cronPanel.docsTitle": "Dokumentasi cron & event",
  "workflow.cronPanel.refresh": "Refresh jadwal",
  "workflow.cronPanel.refreshTitle": "Refresh",
  "workflow.cronPanel.hint": "Workflow dengan `schedule` atau `on` di YAML.",
  "workflow.cronPanel.empty":
    "Belum ada jadwal. Tambahkan `schedule` / `on` di YAML workflow, lalu Save.",
  "workflow.cronPanel.on": "on",
  "workflow.cronPanel.off": "off",
  "workflow.cronPanel.eventCount": "{count} event",
  "workflow.cronPanel.next": "next {value}",

  // CronTab
  "workflow.cron.title": "Cron & Event",
  "workflow.cron.scheduleCount": "{count} jadwal",
  "workflow.cron.refresh": "Refresh",
  "workflow.cron.empty": "Belum ada workflow berjadwal.",
  "workflow.cron.emptyHintPrefix": "Tambahkan ",
  "workflow.cron.emptyHintOr": " atau ",
  "workflow.cron.emptyHintSuffix":
    " di YAML (menu Workflows), Save, lalu refresh di sini.",
  "workflow.cron.schedule": "Schedule",
  "workflow.cron.openWorkflow": "Buka workflow",
  "workflow.cron.openWorkflowAria": "Buka workflow {name}",
  "workflow.cron.next": "next: {value}",
  "workflow.cron.last": "last: {value}",
};
