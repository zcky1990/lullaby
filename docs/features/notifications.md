# Notifications

Kembali ke [indeks](../README.md).

## Ringkas

1. **Global Settings → Notifications** — daftar channel (Slack / Google Chat / Discord /
   webhook generik) dengan Incoming Webhook URL.
2. **Workflow YAML** — step `action: notification` memilih channel dan mengirim pesan
   (boleh interpolate `${params.*}` / `${steps.*}`).

Notifikasi **tidak** otomatis di akhir run; hanya dikirim jika ada step notification.

## Channel (global)

1. Buka **Global Settings → Notifications**
2. Tambah channel: nama, tipe, Incoming Webhook URL
3. Opsional: **Test** per channel

Disimpan di `app_settings.notifications` sebagai `{ channels: [...] }` (`webhookUrl`
terenkripsi at-rest; di-mask di API). Lihat [data-model.md](../data-model.md#secrets-at-rest).

Nama channel dipakai di YAML (`with.channel`). Id channel juga diterima.

## Step workflow

```yaml
name: build-and-notify
params:
  - name: TASK
    type: string
    default: ship it
steps:
  - id: work
    run: echo done
    output: RESULT
  - id: ping
    depends: work
    action: notification
    with:
      channel: team-slack          # nama channel di Global Settings
      message: |
        Workflow selesai.
        Task: ${params.TASK}
        Result: ${RESULT}
```

Field `with`:

| Field | Wajib | Keterangan |
| ----- | ----- | ---------- |
| `channel` | ya | Nama atau id channel global |
| `message` | ya* | Isi pesan (`text` / `prompt` juga diterima sebagai alias) |

Jika channel tidak ditemukan / nonaktif, step **gagal** (exit 1) dengan log
`[notify error] …`.

## API

| Method | Path | Body |
| ------ | ---- | ---- |
| `GET` / `PUT` | `/api/settings/notifications` | `{ channels: [...] }` |
| `POST` | `/api/settings/notifications/test` | `{ channelId? }` |

## Payload webhook

| Tipe | Body |
| ---- | ---- |
| `slack` / `google_chat` | `{ text }` |
| `discord` | `{ content }` |
| `webhook` | JSON `{ event: "workflow.notification", text, projectId, … }` |
