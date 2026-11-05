# Workflow Cron & Event

Menjalankan workflow secara berulang tanpa klik **Run** setiap kali: lewat **cron** (jadwal
waktu) atau **event** bus aplikasi (mis. tiket berpindah status).

Panduan produk ini melengkapi [workflows.md](workflows.md). Di aplikasi, buka menu **Cron**
(activity bar) atau tombol dokumentasi di panel tersebut.

## Ringkas

| Pemicu | YAML | `trigger` di run |
| --- | --- | --- |
| Manual | — (tombol Run) | `manual` |
| Jadwal | `schedule.cron` | `cron` |
| Event | `on: […]` | `event:<nama>` |

Chat/AI **tidak** boleh menjalankan workflow otomatis; hanya Run, cron, atau event yang
terdaftar di YAML.

## Menu Cron

Activity bar → **Cron** (butuh project + workspace):

- Panel kiri: daftar workflow yang punya `schedule` dan/atau `on`
- Tab utama: ringkasan jadwal (cron, event, next run) + toggle enable
- **Dokumentasi**: tab wiki in-app (`wiki-cron`)

Toggle enable memanggil `PATCH /api/projects/:id/workflows/:slug/schedule` tanpa mengubah YAML.
Untuk mengubah ekspresi cron atau daftar event, edit YAML di tab **Workflows** lalu Save.

## YAML: `schedule`

```yaml
name: nightly-test
schedule:
  cron: "0 2 * * *"
  enabled: true
  timezone: Asia/Jakarta
steps:
  - id: test
    run: npm test
```

| Field | Wajib | Keterangan |
| --- | --- | --- |
| `cron` | ya | 5 field: `minute hour day-of-month month day-of-week` |
| `enabled` | tidak | Default `true` |
| `timezone` | tidak | IANA (mis. `Asia/Jakarta`); kosong = zona lokal mesin |

### Contoh ekspresi

| Cron | Arti |
| --- | --- |
| `0 2 * * *` | Setiap hari pukul 02:00 |
| `*/15 * * * *` | Setiap 15 menit |
| `0 9-17 * * 1-5` | Tiap jam 09–17, Senin–Jumat |
| `30 8 1 * *` | Tanggal 1 tiap bulan, 08:30 |

Validasi saat Save: ekspresi / timezone tidak valid → error YAML.

## YAML: `on` (event)

```yaml
name: on-ticket-progress
on:
  - ticket.transitioned
  - event: ticket.transitioned
    status: In Progress
steps:
  - id: notify
    action: notification
    with:
      channel: slack-eng
      message: "Tiket masuk In Progress"
```

- Bentuk singkat: string nama event.
- Bentuk objek: `event` + filter opsional `status` (cocokkan `payload.status`, case-insensitive).
- Event yang relevan harus membawa `projectId` di payload agar hanya project yang sama yang
  dijalankan (contoh: `ticket.transitioned`).

Event workflow internal (`workflow.*`, `app.started`, …) **tidak** memicu schedule (hindari loop).

## Perilaku runtime

- Ticker in-process ±30 detik setelah bootstrap (`src/server/workflow/scheduler.ts`).
- Jadwal disimpan di `workflow_schedules` (sync saat create/save/delete workflow).
- Satu run aktif per slug: jika masih `running`, pemicu cron/event dilewati (next cron tetap
  dihitung ulang).
- Butuh `workspace_path`; tanpa workspace schedule dilewati dengan log peringatan.
- App harus **berjalan** agar cron/event terpicu (bukan daemon OS terpisah).

## API terkait

| Method | Path | Keterangan |
| --- | --- | --- |
| `GET` | `/api/projects/:id/workflows` | List + `schedule` (next/last run) |
| `PATCH` | `/api/projects/:id/workflows/:slug/schedule` | `{ enabled }` |
| `GET` | `/api/projects/:id/workflow-runs` | Riwayat; lihat field `trigger` |

## Troubleshooting

- **Jadwal tidak jalan** → pastikan app terbuka, schedule enabled, workspace ada, cron valid.
- **Next run kosong** → schedule disabled atau tidak ada `cron` (hanya `on`).
- **Event tidak memicu** → cek nama event & filter `status`; pastikan payload punya `projectId`.
- **409 / dilewati** → masih ada run aktif untuk slug yang sama.
