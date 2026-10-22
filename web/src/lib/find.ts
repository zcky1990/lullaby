export interface FindContext {
  preferTerminal: boolean;
}

type Finder = (context: FindContext) => boolean;

const finders = new Set<Finder>();

export function registerFinder(finder: Finder): () => void {
  finders.add(finder);
  return () => {
    finders.delete(finder);
  };
}

export function triggerFind(): boolean {
  const active = document.activeElement;
  const preferTerminal =
    active instanceof Element &&
    (!!active.closest(".xterm") || !!active.closest("[data-terminal-find]"));
  for (const finder of finders) {
    try {
      if (finder({ preferTerminal })) return true;
    } catch {
      // ignore broken finder
    }
  }
  return false;
}
