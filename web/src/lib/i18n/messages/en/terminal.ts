import type { MessageDict } from "../../types";

/** Panel + sesi terminal. */
export const terminal: MessageDict = {
  // TerminalPanel
  "terminal.panel.title": "Terminal",
  "terminal.panel.resize": "Resize terminal",
  "terminal.panel.closeTab": "Close {title}",
  "terminal.panel.shellLabel": "Shell for new terminal",
  "terminal.panel.newSession": "New terminal",
  "terminal.panel.newSessionTitle": "New terminal ({shell})",
  "terminal.panel.clear": "Clear",
  "terminal.panel.clearSession": "Clear terminal",
  "terminal.panel.killSession": "Kill terminal",
  "terminal.panel.hide": "Hide panel",
  "terminal.panel.hideSession": "Hide terminal",
  "terminal.panel.noProject": "No project yet",
  "terminal.panel.noProjectHint":
    "Select a project in Workspace to open a terminal.",
  "terminal.panel.empty": "No terminals",
  "terminal.panel.emptyHint": "Click + to create a new session.",
  "terminal.panel.connecting": "Connecting…",
  "terminal.panel.error": "Terminal error",

  // Terminal session status labels
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
