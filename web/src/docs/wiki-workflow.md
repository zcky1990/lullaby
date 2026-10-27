# Cara Pakai Workflow

Panduan langkah demi langkah menjalankan workflow di aplikasi ini. Workflow adalah rangkaian
perintah yang ditulis sebagai file **YAML** dan dijalankan secara **manual** dari tab Workflows.

## Sebelum mulai

1. Pilih project di menu **Workspace**.
2. Pastikan **workspace** project sudah diatur di **Project Settings → Workspace**.
3. Siapkan workflow berbasis AI (opsional): atur provider di **Global Settings → LLM Providers**.

## Membuat workflow

1. Buka menu **Workflows** di activity bar kiri.
2. Klik **Workflow baru**. File baru dibuat di `.workflows/<slug>.yaml` dan langsung terbuka.
3. Tulis definisi YAML di editor, lalu **Save**.

Workflow juga bisa dibuat manual dengan menambahkan file `.yaml` di folder `.workflows` pada
workspace project.

## Menjalankan workflow

1. Buka workflow dari daftar di panel kiri.
2. Periksa tab **Graph** untuk melihat urutan dan dependency antar step.
3. Klik **Run**.
4. Pantau status dan log tiap step di tab run. Log diperbarui saat proses berjalan.

Satu workflow hanya boleh memiliki satu run aktif. Jika menjalankan lagi, akan muncul konflik —
tunggu run selesai atau **Cancel** run yang sedang berjalan.

## Membaca hasil run

- **Status** tiap step: `success`, `failed`, `skipped`, atau `canceled`.
- **Log** memuat stdout/stderr step (dipotong jika terlalu panjang).
- **History** menyimpan snapshot YAML, jadi perubahan definisi tidak mengubah riwayat lama.
- Run yang terputus karena aplikasi restart ditandai `interrupted`.

## Contoh workflow sederhana

```yaml
name: ci
steps:
  - id: install
    run: npm ci
  - id: lint
    depends: install
    run: npm run lint
  - id: test
    depends: install
    run: npm test
  - id: build
    depends: [lint, test]
    run: npm run build
```

`lint` dan `test` berjalan paralel setelah `install`, lalu `build` menunggu keduanya selesai.

## Menggunakan output step

Simpan output dengan field `output`, lalu panggil dengan `${NAMA}`:

```yaml
steps:
  - id: diff
    run: git diff
  - id: report
    depends: diff
    run: echo "Perubahan: ${steps.diff.output}"
```

## Step AI (opsional)

```yaml
llm:
  provider: My Provider
  model: gpt-4.1-mini
  role: Backend
  session: review-thread
  temperature: 0.2

steps:
  - id: review
    action: chat.completion
    with:
      system: "Kamu reviewer senior."
      prompt: "Ringkas risiko perubahan berikut: ${steps.diff.output}"
      temperature: 0.3
      max_tokens: 800
    output: REVIEW
```

`action: chat.completion` menjalankan **satu completion** (belum ada tool-calling/agent loop). Hasil
disimpan ke field `output` atau `${steps.<id>.output}` untuk step berikutnya.

## Role

Role adalah persona siap pakai yang dikelola di **Global Settings → Roles** (`name`, `description`,
`persona`, `provider_id`). Pada step AI, role bisa dirujuk lewat `llm.role` atau `with.role`.

- Role membawa **persona** yang ditambahkan ke system prompt.
- Jika role punya `provider_id`, provider tersebut dipakai; jika tidak, dipakai `provider` step atau
  provider pertama yang tersedia.
- `with.role` menimpa `llm.role` untuk step tersebut.
- Nama role harus cocok dengan role di Global Settings; role yang tidak ditemukan membuat step gagal.
- `with.system` tetap bisa dipakai untuk menambah instruksi di atas persona role.

```yaml
llm:
  role: Backend
steps:
  - id: design
    action: chat.completion
    with:
      prompt: "Rancang migrasi tabel users."
```

## Session

Session menyimpan riwayat percakapan AI **per project** di tabel `workflow_sessions` dan
`workflow_session_messages`.

- `llm.session` menjadi default sesi semua step AI; `with.session` menimpanya per step.
- Nama sesi yang sama melanjutkan riwayat user/assistant, termasuk **antar-run**.
- Tanpa `session`, step bersifat **stateless** (tidak membawa riwayat).
- Riwayat yang dikirim maksimal **50 pesan terakhir**.
- Persona/system prompt tidak disimpan di sesi; hanya pesan user/assistant.

```yaml
llm:
  session: review-thread
steps:
  - id: first
    action: chat.completion
    with: { prompt: "Buat checklist review." }
  - id: second
    depends: first
    action: chat.completion
    with:
      prompt: "Lanjutkan dengan risiko keamanan."
      session: review-thread
```

## Params step AI

Field `with` mengatur parameter satu step AI. Nilai `llm` menjadi default untuk semua step AI.

| Param | Tipe | Keterangan |
| --- | --- | --- |
| `prompt` | string | Satu pesan user. Wajib jika `messages` tidak diisi. Mendukung interpolasi `${...}`. |
| `messages` | array | Daftar `{ role: system\|user\|assistant, content }` sebagai pengganti `prompt`. |
| `system` | string | System prompt tambahan; default memakai persona role. |
| `provider` | string | Id/nama provider global; menimpa `llm.provider`. |
| `model` | string | Nama model; menimpa `llm.model`. |
| `role` | string | Id/nama role; menimpa `llm.role`. |
| `session` | string | Nama sesi AI; menimpa `llm.session`. |
| `temperature` | number | 0–2. Semakin rendah semakin deterministik. |
| `max_tokens` | number | Batas panjang jawaban. |

Catatan:

- Semua nilai string (`prompt`, `system`, `messages[].content`, `env` step) mendukung interpolasi
  `${NAMA}`, `${steps.<id>.output}`, dan `${env.KEY}`.
- Provider/role harus sudah ada di Global Settings; jika tidak ditemukan, step gagal dengan log jelas.
- Gunakan `temperature` rendah untuk review/analisis dan lebih tinggi untuk eksplorasi ide.

## Tips

- Gunakan `retry_policy` dan `timeout_sec` untuk perintah yang tidak stabil atau berjalan lama.
- Gunakan `continue_on: failure` jika kegagalan step tidak boleh menghentikan seluruh run.
- Jangan menulis secret langsung di YAML.
- Perlakukan file workflow seperti kode: shell berjalan dengan hak user di workspace.

## Troubleshooting

| Masalah | Solusi |
| --- | --- |
| "Workspace belum diatur" | Atur workspace di Project Settings → Workspace. |
| Provider/role tidak ditemukan | Cek Global Settings → LLM Providers / Roles. |
| Step AI gagal | Lihat log step, periksa baseUrl, API key, dan model. |
| Run ditolak (409) | Masih ada run aktif; tunggu atau Cancel. |
| Dependency cycle | Periksa field `depends` antar step. |

Untuk referensi lengkap schema YAML, buka **Workflow Docs** dari tombol buku di panel Workflows.
