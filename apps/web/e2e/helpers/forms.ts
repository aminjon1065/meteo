import type { Locator } from "@playwright/test";

/** Выбирает option нативного <select> по тексту (регулярное выражение), затем по его value. */
export async function selectByText(select: Locator, text: RegExp): Promise<void> {
  const option = select.locator("option", { hasText: text }).first();
  const value = await option.getAttribute("value");
  if (value === null) throw new Error(`[e2e] option ${text} не найден`);
  await select.selectOption(value);
}
