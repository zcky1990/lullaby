import type { MessageDict } from "../../types";
import { app } from "./app";
import { chat } from "./chat";
import { common } from "./common";
import { documents } from "./documents";
import { explorer } from "./explorer";
import { git } from "./git";
import { language } from "./language";
import { nav } from "./nav";
import { review } from "./review";
import { settings } from "./settings";
import { settingsAdvanced } from "./settingsAdvanced";
import { terminal } from "./terminal";
import { tickets } from "./tickets";
import { workflow } from "./workflow";

export const en: MessageDict = {
  ...common,
  ...nav,
  ...language,
  ...app,
  ...chat,
  ...documents,
  ...explorer,
  ...git,
  ...review,
  ...settings,
  ...settingsAdvanced,
  ...terminal,
  ...tickets,
  ...workflow,
};
