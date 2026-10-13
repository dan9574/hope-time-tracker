/** Which desktop the page runs on; stylesheets key off `html[data-platform]`. */
export type Platform = "mac" | "windows" | "other";

export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  return ua.includes("Mac") ? "mac" : ua.includes("Windows") ? "windows" : "other";
}

export function applyPlatform(): void {
  document.documentElement.dataset.platform = detectPlatform();
}
