import { and, emailOutbox, eq, finalizeSentBulletins, sql } from "@meteo/db";
import { db } from "../db";
import { env } from "../env";
import { logger } from "../logger";
import { renderEmail } from "../mail/templates";
import { getTransport } from "../mail/transport";
import type { JobDefinition } from "./types";

const MAX_ATTEMPTS = 5;
const BATCH = 50;

/** Отправка очереди писем: до 50 за запуск, до 5 попыток на письмо. */
export const mailer: JobDefinition = {
  name: "mailer",
  schedule: { every: 60_000 },
  async run() {
    const pending = await db
      .select()
      .from(emailOutbox)
      .where(and(eq(emailOutbox.status, "pending"), sql`${emailOutbox.attempts} < ${MAX_ATTEMPTS}`))
      .orderBy(emailOutbox.createdAt)
      .limit(BATCH);
    if (pending.length === 0) {
      await finalizeSentBulletins(db);
      return { sent: 0, failed: 0 };
    }
    const { transport, dev } = getTransport();
    let sent = 0;
    let failed = 0;
    for (const mail of pending) {
      try {
        const rendered = renderEmail(mail.template, mail.locale, mail.payload);
        const info = await transport.sendMail({
          from: env.MAIL_FROM,
          to: mail.to,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          headers: { "X-Meteo-Template": mail.template },
        });
        if (dev)
          logger.info(
            { to: mail.to, subject: rendered.subject, preview: rendered.text.slice(0, 200) },
            "email (dev transport)",
          );
        await db
          .update(emailOutbox)
          .set({ status: "sent", sentAt: new Date(), attempts: mail.attempts + 1, lastError: null })
          .where(eq(emailOutbox.id, mail.id));
        sent += 1;
        void info;
      } catch (error) {
        failed += 1;
        const attempts = mail.attempts + 1;
        await db
          .update(emailOutbox)
          .set({
            attempts,
            status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
            lastError: error instanceof Error ? error.message : String(error),
          })
          .where(eq(emailOutbox.id, mail.id));
        logger.error({ err: error, id: mail.id }, "email send failed");
      }
    }
    const bulletinsDone = await finalizeSentBulletins(db);
    if (bulletinsDone > 0) logger.info({ bulletins: bulletinsDone }, "bulletins marked as sent");
    return { sent, failed };
  },
};
