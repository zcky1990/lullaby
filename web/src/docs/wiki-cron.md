# Cara Pakai Cron & Event Workflow

Menjalankan workflow **otomatis** pada jadwal waktu (cron) atau saat event aplikasi terjadi
(misalnya tiket pindah status). Run manual tetap tersedia di menu Workflows.

## Menu Cron

1. Pilih project dan pastikan workspace sudah diatur.
2. Buka **Cron** di activity bar kiri.
3. Panel menampilkan workflow yang punya jadwal (`schedule`) atau pemicu event (`on`).
4. Di tab utama, aktifkan/nonaktifkan jadwal dengan switch **Schedule** (tanpa edit YAML).
5. Klik nama workflow untuk membuka editor di **Workflows**.

Tombol **Dokumentasi** di panel membuka halaman wiki ini.

## Menambah jadwal cron

Edit YAML workflow (menu **Workflows**), lalu Save:

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

- `cron` memakai **5 field**: menit jam tanggal bulan hari-minggu.
- `timezone` opsional (IANA, contoh `Asia/Jakarta`); kosong = zona lokal mesin.
- Setelah Save, menu Cron menampilkan **next** run.

### Contoh cron

| Ekspresi | Arti |
| --- | --- |
| `0 2 * * *` | Setiap hari jam 02:00 |
| `*/15 * * * *` | Setiap 15 menit |
| `0 9-17 * * 1-5` | Tiap jam 09–17, hari kerja |
| `30 8 1 * *` | Tanggal 1 tiap bulan, 08:30 |

## Menambah pemicu event

```yaml
name: on-in-progress
on:
  - ticket.transitioned
  - event: ticket.transitioned
    status: In Progress
steps:
  - id: ping
    run: echo "ticket moved"
```

- Bentuk singkat: cukup nama event (`ticket.transitioned`).
- Bentuk objek: `event` + filter `status` opsional.
- Di riwayat run, `trigger` bertuliskan `event:ticket.transitioned` (atau `cron` / `manual`).

## Yang perlu diingat

- Aplikasi harus **berjalan** agar cron/event terpicu.
- Satu workflow hanya satu run aktif; jika masih berjalan, jadwal berikutnya dilewati.
- Chat/AI tidak menjalankan workflow otomatis.
- Matikan jadwal dari menu Cron (switch) atau set `schedule.enabled: false` di YAML.

## Troubleshooting

- Jadwal tidak muncul di Cron → pastikan YAML punya `schedule` atau `on`, lalu **Save**.
- Next run kosong → jadwal dimatikan, atau hanya ada `on` (tanpa cron).
- Event tidak jalan → cek ejaan nama event dan filter `status`.
- Run bentrok → buka Workflows, Cancel run aktif, atau tunggu selesai.
