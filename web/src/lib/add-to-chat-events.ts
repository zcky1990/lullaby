export const ADD_TO_CHAT_EVENT = "rnd:add-to-chat";

export interface AddToChatDetail {
  selection: string;
  prompt: string;
  sourceLabel?: string;
}

export function dispatchAddToChat(detail: AddToChatDetail): void {
  window.dispatchEvent(new CustomEvent<AddToChatDetail>(ADD_TO_CHAT_EVENT, { detail }));
}
