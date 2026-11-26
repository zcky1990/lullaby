/**
 * Registry tipe dokumen untuk menu Doc Studio.
 *
 * Tipe bawaan sengaja tanpa DB: menambah tipe baru = tambah entri di sini (atau
 * lewat "tipe kustom" di Global Settings → Doc Studio, yang disimpan sebagai
 * JSON di `app_settings.doc_studio`).
 */

export interface DocTemplate {
  id: string;
  label: string;
  description: string;
  /** Kerangka bagian dokumen hasil akhir (dipakai saat finalize). */
  outline: string[];
  /** Topik yang harus digali AI saat interview. */
  interviewTopics: string[];
}

export const BUILTIN_DOC_TEMPLATES: DocTemplate[] = [
  {
    id: "prd",
    label: "PRD",
    description: "Product Requirements Document — apa yang dibangun dan untuk siapa.",
    outline: [
      "Problem",
      "Goals & Success Metrics",
      "Target Users",
      "Scope (In / Out)",
      "User Stories",
      "Functional Requirements",
      "Non-functional Requirements",
      "UX Notes",
      "Dependencies",
      "Risks",
      "Rollout Plan",
      "Open Questions",
    ],
    interviewTopics: [
      "masalah yang diselesaikan",
      "siapa penggunanya",
      "tujuan & metrik keberhasilan",
      "ruang lingkup (termasuk yang tidak dikerjakan)",
      "alur/UX utama",
      "batasan teknis atau dependensi",
    ],
  },
  {
    id: "brd",
    label: "BRD",
    description: "Business Requirements Document — kebutuhan bisnis dan ukuran nilainya.",
    outline: [
      "Business Context",
      "Business Objectives",
      "Scope",
      "Stakeholders",
      "Current Process (As-Is)",
      "Proposed Process (To-Be)",
      "Business Requirements",
      "Success Metrics (KPI)",
      "Assumptions & Constraints",
      "Risks",
      "Cost & Benefit",
      "Approval",
    ],
    interviewTopics: [
      "latar belakang bisnis",
      "pemangku kepentingan",
      "proses saat ini dan masalahnya",
      "proses yang diinginkan",
      "KPI keberhasilan",
      "asumsi, batasan, dan risiko bisnis",
    ],
  },
  {
    id: "rfc",
    label: "RFC",
    description: "Request for Comments — usulan desain teknis untuk dibahas tim.",
    outline: [
      "Summary",
      "Motivation",
      "Guide-level Explanation",
      "Reference-level Design",
      "Alternatives Considered",
      "Drawbacks",
      "Migration & Backward Compatibility",
      "Security & Privacy",
      "Observability",
      "Unresolved Questions",
    ],
    interviewTopics: [
      "masalah teknis yang diusulkan untuk dipecahkan",
      "batasan sistem saat ini",
      "opsi desain yang dipertimbangkan",
      "dampak kompatibilitas & migrasi",
      "risiko keamanan/datanya",
      "pertanyaan terbuka untuk reviewer",
    ],
  },
  {
    id: "rca",
    label: "RCA",
    description: "Root Cause Analysis — analisis penyebab insiden/bug produksi.",
    outline: [
      "Incident Summary",
      "Impact",
      "Timeline",
      "Detection",
      "Root Cause",
      "Contributing Factors",
      "Resolution & Recovery",
      "Why It Happened (5 Whys)",
      "Action Items",
      "Prevention & Lessons Learned",
    ],
    interviewTopics: [
      "apa yang terjadi dan kapan",
      "dampak ke pengguna/bisnis",
      "cara masalah terdeteksi",
      "penyebab utama",
      "faktor pendukung",
      "cara pemulihan dan pencegahan",
    ],
  },
  {
    id: "adr",
    label: "ADR",
    description: "Architecture Decision Record — catatan satu keputusan teknis.",
    outline: [
      "Context",
      "Decision",
      "Options Considered",
      "Consequences",
      "Status",
      "References",
    ],
    interviewTopics: [
      "konteks keputusan",
      "keputusan yang diambil",
      "alternatif yang ditolak beserta alasannya",
      "konsekuensi jangka panjang",
    ],
  },
  {
    id: "tech-spec",
    label: "Tech Spec",
    description: "Technical Specification — rencana implementasi tingkat teknis.",
    outline: [
      "Overview",
      "Background",
      "Goals",
      "Non-Goals",
      "Architecture",
      "Data Model",
      "API Contracts",
      "Error Handling",
      "Security",
      "Testing Strategy",
      "Rollout",
      "Open Questions",
    ],
    interviewTopics: [
      "tujuan teknis dan non-tujuan",
      "arsitektur & komponen terdampak",
      "data dan kontrak API",
      "penanganan error",
      "strategi testing",
      "rencana rilis/rollout",
    ],
  },
  {
    id: "postmortem",
    label: "Postmortem",
    description: "Postmortem blameless — pembelajaran dari sebuah insiden.",
    outline: [
      "Summary",
      "Impact",
      "Timeline",
      "Root Causes",
      "What Went Well",
      "What Went Wrong",
      "Action Items",
      "Lessons Learned",
    ],
    interviewTopics: [
      "ringkasan insiden",
      "dampak terukur",
      "urut waktu kejadian",
      "akar masalah",
      "hal yang berjalan baik dan buruk",
    ],
  },
  {
    id: "runbook",
    label: "Runbook",
    description: "Runbook operasional — langkah mitigasi saat alarm berbunyi.",
    outline: [
      "Service Overview",
      "Preconditions",
      "Symptoms & Alerts",
      "Diagnosis Steps",
      "Mitigation",
      "Rollback",
      "Escalation",
      "Post-Incident",
    ],
    interviewTopics: [
      "service/komponen yang dicakup",
      "gejala dan alarm pemicu",
      "langkah diagnosis",
      "langkah mitigasi & rollback",
      "jalur eskalasi",
    ],
  },
];

export const MAX_CUSTOM_TEMPLATES = 20;
export const MAX_TEMPLATE_ID = 64;
/** Minimal dua bagian supaya dokumen hasil tidak berupa satu paragraf. */
export const MIN_TEMPLATE_OUTLINE = 2;

/** Cari tipe dokumen: tipe kustom menang atas tipe bawaan dengan id sama. */
export function resolveDocTemplate(
  id: string,
  custom: DocTemplate[] = [],
): DocTemplate | null {
  const key = id.trim().toLowerCase();
  if (!key) return null;
  return (
    custom.find((template) => template.id.toLowerCase() === key) ??
    BUILTIN_DOC_TEMPLATES.find((template) => template.id === key) ??
    null
  );
}

export function listDocTemplates(custom: DocTemplate[] = []): DocTemplate[] {
  const overridden = new Set(custom.map((template) => template.id.toLowerCase()));
  return [
    ...BUILTIN_DOC_TEMPLATES.filter((template) => !overridden.has(template.id)),
    ...custom,
  ];
}
