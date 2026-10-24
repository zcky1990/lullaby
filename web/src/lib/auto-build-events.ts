export const AUTO_BUILD_EVENT = "rnd:auto-build";

export interface AutoBuildDetail {
  projectId: string;
  key: string;
  summary: string;
  description?: string;
}

export function dispatchAutoBuild(detail: AutoBuildDetail): void {
  window.dispatchEvent(new CustomEvent<AutoBuildDetail>(AUTO_BUILD_EVENT, { detail }));
}
