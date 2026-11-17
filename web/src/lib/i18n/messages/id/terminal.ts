import type { MessageDict } from "../../types";

/** Panel + sesi terminal. */
export const terminal: MessageDict = {
  // TerminalPanel
  "terminal.panel.title": "Terminal",
  "terminal.panel.resize": "Resize terminal",
  "terminal.panel.closeTab": "Tutup {title}",
  "terminal.panel.shellLabel": "Shell untuk terminal baru",
  "terminal.panel.newSession": "Terminal baru",
  "terminal.panel.newSessionTitle": "Terminal baru ({shell})",
  "terminal.panel.clear": "Clear",
  "terminal.panel.clearSession": "Clear terminal",
  "terminal.panel.killSession": "Kill terminal",
  "terminal.panel.hide": "Sembunyikan panel",
  "terminal.panel.hideSession": "Sembunyikan terminal",
  "terminal.panel.noProject": "Belum ada project",
  "terminal.panel.noProjectHint":
    "Pilih project di Workspace untuk membuka terminal.",
  "terminal.panel.empty": "Tidak ada terminal",
  "terminal.panel.emptyHint": "Klik + untuk membuat session baru.",
  "terminal.panel.connecting": "Connecting…",
  "terminal.panel.error": "Terminal error",

  // Label status sesi terminal
  "terminal.status.ready": "Ready",
  "terminal.status.connecting": "Connecting",
  "terminal.status.error": "Error",
  "terminal.status.closed": "Exited",

  // TerminalSession
  "terminal.session.findPlaceholder": "Find",
  "terminal.session.previous": "Previous",
  "terminal.session.previousMatch": "Previous match",
  "terminal.session.next": "Next",
  "terminal.session.nextMatch": "Next match",
  "terminal.session.close": "Close",
  "terminal.session.closeFind": "Close find",
};
