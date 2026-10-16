const STORAGE_KEY = "rnd.zoom:v1";
const MIN = 0.7;
const MAX = 1.8;
const STEP = 0.1;

let current = 1;

function clamp(value: number): number {
  return Math.min(MAX, Math.max(MIN, Math.round(value * 100) / 100));
}

function apply(value: number): void {
  current = clamp(value);
  document.documentElement.style.zoom = String(current);
  try {
    localStorage.setItem(STORAGE_KEY, String(current));
  } catch {
    // ignore storage errors
  }
}

export function installZoomShortcuts(): void {
  let stored = 1;
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(value) && value >= MIN && value <= MAX) stored = value;
  } catch {
    stored = 1;
  }
  apply(stored);

  window.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const { key, code } = event;
    if (key === "=" || key === "+" || code === "Equal" || code === "NumpadAdd") {
      apply(current + STEP);
    } else if (key === "-" || key === "_" || code === "Minus" || code === "NumpadSubtract") {
      apply(current - STEP);
    } else if (key === "0" || code === "Digit0" || code === "Numpad0") {
      apply(1);
    } else {
      return;
    }
    event.preventDefault();
  });
}
