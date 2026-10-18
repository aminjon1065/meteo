import type { Page } from "@playwright/test";

/**
 * Собирает сообщения браузера о нарушениях Content Security Policy. Любое «Refused to …»
 * означает, что политика блокирует ресурс портала (скрипт без nonce, worker, картинку).
 */
export function trackCspViolations(page: Page): () => string[] {
  const violations: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (/Content Security Policy|Refused to (load|execute|apply|connect|create)/i.test(text)) {
      violations.push(text);
    }
  });
  return () => violations;
}
