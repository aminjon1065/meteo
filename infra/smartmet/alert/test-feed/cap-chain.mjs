#!/usr/bin/env node
/**
 * Тестовая цепочка CAP для приёмки M3 на staging: выпуски «как у редактора SmartMet Alert»
 * (publishedCap/<год>/<месяц>/<YYYYMMDDHHmmss>/<ts>_0000_<ТИП>_<событие>.xml) со свежими датами.
 * Файлы пишутся в тестовый каталог, который читает отдельная лента alert-web-test (только staging),
 * поэтому в production тестовые сообщения не попадают.
 *
 *   node cap-chain.mjs --out <каталог> --step alert      Alert (tg/ru/en), регион DU, Moderate, 12 ч
 *   node cap-chain.mjs --out <каталог> --step update     Update: Severe, 24 ч, + регион RRP
 *   node cap-chain.mjs --out <каталог> --step cancel     Cancel без <info> (отмена последнего сообщения)
 *   node cap-chain.mjs --out <каталог> --step withdraw   пустой выпуск: предупреждение просто снято
 *   node cap-chain.mjs --out <каталог> --step reset      начать новую цепочку (забыть состояние)
 *
 * Параметры: --region DU (код warning_regions), --status Actual|Exercise|Test, --event "Wind".
 * Состояние цепочки (identifier и sent последнего сообщения) — в <каталог>/.cap-chain.json.
 * Без зависимостей: Node 18+.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const out = args.out;
const step = args.step;
if (!out || !["alert", "update", "cancel", "withdraw", "reset"].includes(step)) {
  console.error("usage: cap-chain.mjs --out <dir> --step alert|update|cancel|withdraw|reset");
  process.exit(2);
}
const region = (args.region ?? "DU").toUpperCase();
const status = args.status ?? "Actual";
const eventEn = args.event ?? "Wind";
const sender = "alert@havo.tj";
const statePath = join(out, ".cap-chain.json");

const pad = (n) => String(n).padStart(2, "0");
/** Время с часовым поясом Душанбе (+05:00), как пишет редактор. */
function capTime(d) {
  const t = new Date(d.getTime() + 5 * 3600_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}+05:00`;
}
function stamp(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}
const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const TEXT = {
  tg: {
    language: "tg-TJ",
    event: "Шамоли сахт",
    headline: (sev) => `ТЕСТ: шамоли сахт (${sev})`,
    description: "Паёми санҷишӣ барои қабули модули M3. Ба он аҳамият надиҳед.",
    instruction: "Амал лозим нест — ин санҷиш аст.",
  },
  ru: {
    language: "ru-RU",
    event: "Сильный ветер",
    headline: (sev) => `ТЕСТ: сильный ветер (${sev})`,
    description: "Тестовое сообщение для приёмки модуля M3. Не обращайте внимания.",
    instruction: "Действий не требуется — это проверка.",
  },
  en: {
    language: "en-US",
    event: eventEn,
    headline: (sev) => `TEST: strong wind (${sev})`,
    description: "Test message for M3 acceptance. Please ignore.",
    instruction: "No action needed — this is a test.",
  },
};

function infoBlock(lang, { severity, onset, expires, regions }) {
  const t = TEXT[lang];
  const areas = regions
    .map(
      (code) => `    <area>
      <areaDesc>${xmlEsc(code)}</areaDesc>
      <geocode>
        <valueName>region</valueName>
        <value>${xmlEsc(code)}</value>
      </geocode>
    </area>`,
    )
    .join("\n");
  return `  <info>
    <language>${t.language}</language>
    <category>Met</category>
    <event>${xmlEsc(t.event)}</event>
    <urgency>Expected</urgency>
    <severity>${severity}</severity>
    <certainty>Likely</certainty>
    <onset>${capTime(onset)}</onset>
    <expires>${capTime(expires)}</expires>
    <senderName>Агентии обуҳавошиносӣ (ТЕСТ)</senderName>
    <headline>${xmlEsc(t.headline(severity))}</headline>
    <description>${xmlEsc(t.description)}</description>
    <instruction>${xmlEsc(t.instruction)}</instruction>
${areas}
  </info>`;
}

function alertXml({ identifier, sent, msgType, references, note, infos }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>${identifier}</identifier>
  <sender>${sender}</sender>
  <sent>${capTime(sent)}</sent>
  <status>${status}</status>
  <msgType>${msgType}</msgType>
  <scope>Public</scope>
${note ? `  <note>${xmlEsc(note)}</note>\n` : ""}${references ? `  <references>${references}</references>\n` : ""}${infos ?? ""}
</alert>
`;
}

/** Новый выпуск редактора: каталог с меткой времени, внутри — файлы выпуска (может быть пустым). */
function writeIssue(now, files) {
  const ts = stamp(now);
  const dir = join(
    out,
    "publishedCap",
    String(now.getUTCFullYear()),
    pad(now.getUTCMonth() + 1),
    ts,
  );
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  for (const [name, body] of files) {
    writeFileSync(join(dir, `${ts}_0000_${name}.xml`), body, { mode: 0o644 });
  }
  return dir;
}

process.umask(0o022);
mkdirSync(out, { recursive: true });
if (step === "reset") {
  rmSync(statePath, { force: true });
  console.log("состояние цепочки сброшено");
  process.exit(0);
}
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null;
const now = new Date(Math.floor(Date.now() / 1000) * 1000);
const event = eventEn.replace(/\W+/g, "");

if (step === "alert") {
  const identifier = `havo.test.${stamp(now)}.1`;
  const infos = ["tg", "ru", "en"]
    .map((l) =>
      infoBlock(l, {
        severity: "Moderate",
        onset: now,
        expires: new Date(now.getTime() + 12 * 3600_000),
        regions: [region],
      }),
    )
    .join("\n");
  const dir = writeIssue(now, [[`ALERT_${event}`, alertXml({ identifier, sent: now, msgType: "Alert", infos })]]);
  writeFileSync(statePath, JSON.stringify({ identifier, sent: capTime(now), n: 1 }));
  console.log(`Alert ${identifier} → ${dir}`);
} else if (step === "update" || step === "cancel") {
  if (!state) {
    console.error("сначала --step alert");
    process.exit(1);
  }
  const identifier = `${state.identifier.replace(/\.\d+$/, "")}.${state.n + 1}`;
  const references = `${sender},${state.identifier},${state.sent}`;
  let file;
  if (step === "update") {
    const infos = ["tg", "ru", "en"]
      .map((l) =>
        infoBlock(l, {
          severity: "Severe",
          onset: now,
          expires: new Date(now.getTime() + 24 * 3600_000),
          regions: [region, region === "RRP" ? "DU" : "RRP"],
        }),
      )
      .join("\n");
    file = [`UPDATE_${event}`, alertXml({ identifier, sent: now, msgType: "Update", references, infos })];
  } else {
    file = [
      `CANCEL_${event}`,
      alertXml({
        identifier,
        sent: now,
        msgType: "Cancel",
        references,
        note: "Тестовое предупреждение отменено.",
      }),
    ];
  }
  const dir = writeIssue(now, [file]);
  writeFileSync(statePath, JSON.stringify({ identifier, sent: capTime(now), n: state.n + 1 }));
  console.log(`${step === "update" ? "Update" : "Cancel"} ${identifier} (ссылается на ${state.identifier}) → ${dir}`);
} else {
  const dir = writeIssue(now, []);
  console.log(`пустой выпуск (предупреждение снято без Cancel) → ${dir}`);
}
