import { eq } from "@meteo/db";
import { emailOutbox, subscribers } from "@meteo/db/schema";
import { expect, test } from "@playwright/test";
import { closeE2eDb, e2eDb } from "../helpers/db";
import { t } from "../helpers/messages";

test.afterAll(async () => {
  await closeE2eDb();
});

test("подписка с двойным подтверждением: форма → письмо в email_outbox → ссылка подтверждения", async ({
  page,
}) => {
  const email = `e2e-${Date.now()}@example.com`;
  await page.goto("/ru/subscribe");
  await expect(page.getByText(t("ru", "subscribe.title"), { exact: true })).toBeVisible();
  await page.getByLabel(t("ru", "subscribe.email")).fill(email);
  await page.getByRole("checkbox", { name: t("ru", "subscribe.newsletter") }).click();
  await page.getByRole("checkbox", { name: t("ru", "subscribe.consent") }).click();
  await page.getByRole("button", { name: t("ru", "subscribe.submit") }).click();
  await expect(page.getByText(t("ru", "subscribe.doneTitle"))).toBeVisible();

  const db = e2eDb();
  const [pending] = await db.select().from(subscribers).where(eq(subscribers.email, email));
  expect(pending?.status).toBe("pending");
  expect(pending?.topics).toMatchObject({ all: true, newsletter: true });
  const [mail] = await db.select().from(emailOutbox).where(eq(emailOutbox.to, email));
  expect(mail?.template).toBe("confirm");
  const confirmUrl = String(
    (mail?.payload as { confirmUrl?: string } | undefined)?.confirmUrl ?? "",
  );
  expect(confirmUrl).toMatch(/\/ru\/subscribe\/confirm\?token=[a-f0-9]{40}$/);

  await page.goto(new URL(confirmUrl).pathname + new URL(confirmUrl).search);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    t("ru", "subscribe.confirm.confirmed.title"),
  );
  const [confirmed] = await db.select().from(subscribers).where(eq(subscribers.email, email));
  expect(confirmed?.status).toBe("confirmed");
  expect(confirmed?.confirmedAt).not.toBeNull();

  // Повторный переход по ссылке — «уже подтверждено», неверный токен — «ссылка недействительна».
  await page.goto(new URL(confirmUrl).pathname + new URL(confirmUrl).search);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    t("ru", "subscribe.confirm.already.title"),
  );
  await page.goto("/ru/subscribe/confirm?token=deadbeef");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    t("ru", "subscribe.confirm.invalid.title"),
  );

  // Ревью 10.2026: повторная форма для подтверждённого адреса не меняет темы без подтверждения —
  // иначе любой, кто знает e-mail, переписал бы чужую подписку. Изменения ждут ссылки из письма.
  await page.goto("/en/subscribe");
  await page.getByRole("textbox", { name: t("en", "subscribe.email"), exact: true }).fill(email);
  await page.getByRole("checkbox", { name: t("en", "subscribe.consent") }).click();
  await page.getByRole("button", { name: t("en", "subscribe.submit") }).click();
  await expect(page.getByText(t("en", "subscribe.doneTitle"))).toBeVisible();
  const [untouched] = await db.select().from(subscribers).where(eq(subscribers.email, email));
  expect(untouched?.status).toBe("confirmed");
  expect(untouched?.locale).toBe("ru");
  expect(untouched?.topics).toMatchObject({ all: true, newsletter: true });
  expect(untouched?.topics.pending).toMatchObject({ all: true, newsletter: false, locale: "en" });
  expect(untouched?.confirmToken).not.toBe(pending?.confirmToken);
  const mails = await db.select().from(emailOutbox).where(eq(emailOutbox.to, email));
  expect(mails.length).toBe(2);
  const changeUrl = String(
    (mails.find((m) => m.id !== mail?.id)?.payload as { confirmUrl?: string } | undefined)
      ?.confirmUrl ?? "",
  );
  expect(changeUrl).toContain(`token=${untouched?.confirmToken}`);
  await page.goto(new URL(changeUrl).pathname + new URL(changeUrl).search);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    t("en", "subscribe.confirm.confirmed.title"),
  );
  const [applied] = await db.select().from(subscribers).where(eq(subscribers.email, email));
  expect(applied?.status).toBe("confirmed");
  expect(applied?.locale).toBe("en");
  expect(applied?.topics).toMatchObject({ all: true, newsletter: false });
  expect(applied?.topics.pending).toBeUndefined();
});
