import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env";
import { logger } from "../logger";

let transport: Transporter | null = null;

/** SMTP из SMTP_URL; без него — jsonTransport: письмо пишется в лог, статус «отправлено» (dev). */
export function getTransport(): { transport: Transporter; dev: boolean } {
  if (!transport) {
    if (env.SMTP_URL) {
      // Таймауты на одно письмо: зависший SMTP не держит рассылку (и её замок) десятки минут.
      transport = nodemailer.createTransport({
        url: env.SMTP_URL,
        connectionTimeout: 30_000,
        greetingTimeout: 30_000,
        socketTimeout: 60_000,
      });
      logger.info("smtp transport configured");
    } else {
      transport = nodemailer.createTransport({ jsonTransport: true });
      logger.warn("SMTP_URL не задан: письма пишутся в лог (jsonTransport)");
    }
  }
  return { transport, dev: !env.SMTP_URL };
}
