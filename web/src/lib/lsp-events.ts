export const LSP_SETTINGS_CHANGED_EVENT = "rnd:lsp-settings-changed";

export function dispatchLspSettingsChanged(): void {
  window.dispatchEvent(new CustomEvent(LSP_SETTINGS_CHANGED_EVENT));
}
