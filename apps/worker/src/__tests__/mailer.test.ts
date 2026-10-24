import { describe, expect, it, vi } from "vitest";

// Рассылка идёт только под замком: параллельные запуски (стартовый, плановый, ручной) не должны брать
// одни и те же письма «pending». БД здесь не нужна — при занятом замке задача её не трогает.
const withLock = vi.fn();
vi.mock("../lock", () => ({ withLock: (...args: unknown[]) => withLock(...args) }));
vi.mock("../db", () => ({ db: {} }));

const { mailer, MAILER_LOCK, MAILER_LOCK_TTL_SECONDS } = await import("../jobs/mailer");

describe("mailer", () => {
  it("выполняется под замком mailer и пропускается, если замок занят", async () => {
    withLock.mockResolvedValueOnce(null);
    await expect(mailer.run({ data: {} } as never)).resolves.toEqual({ skipped: true });
    expect(withLock).toHaveBeenCalledWith(
      MAILER_LOCK,
      MAILER_LOCK_TTL_SECONDS,
      expect.any(Function),
    );
  });

  it("возвращает итог отправки, когда замок взят", async () => {
    withLock.mockResolvedValueOnce({ sent: 3, failed: 0 });
    await expect(mailer.run({ data: {} } as never)).resolves.toEqual({ sent: 3, failed: 0 });
  });

  it("срок замка с запасом: не меньше 10 минут", () => {
    expect(MAILER_LOCK_TTL_SECONDS).toBeGreaterThanOrEqual(10 * 60);
  });
});
