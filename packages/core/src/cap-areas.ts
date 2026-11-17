/**
 * Сопоставление области CAP (<area>) с регионом портала по названию района.
 *
 * Редактор SmartMet Alert пишет у области только контур и название района (areaDesc: «Rudaki»,
 * «Рудаки», «Рўдакӣ»), без геокода. Контуры районов у FMI грубее наших и местами не совпадают:
 * у «Рудаки» нет «дырки» под Душанбе, поэтому по одной геометрии предупреждение для района попадало
 * и в Душанбе, и в соседнюю область. По названию район находится однозначно.
 *
 * Написание у FMI и в нашем справочнике разное (Faizobod / Fayzobod, Dangara / Danghara, «Мир Сайид
 * Али Хамадони» / «Хамадони», «Файзабадский район»), поэтому сравниваются «скелеты» слов: без служебных
 * слов (район, город, ноҳияи…), с общими заменами букв и без гласных. Нужен только регион, поэтому
 * совпадение с городом и районом одного названия (Куляб, Вахдат) не мешает.
 */

/** Место справочника: название района, города или самого региона на любом языке и код региона. */
export interface CapPlaceName {
  name: string;
  regionCode: string;
}

export interface CapPlaceIndex {
  places: Array<{ words: string[]; regionCode: string }>;
}

const STOP_WORDS = new Set([
  "district",
  "city",
  "town",
  "region",
  "the",
  "район",
  "р-н",
  "город",
  "г",
  "область",
  "обл",
  "ноҳияи",
  "ноҳия",
  "шаҳри",
  "вилояти",
  "вилоят",
]);

const CYRILLIC_MAP: Record<string, string> = {
  ё: "е",
  ӯ: "у",
  ў: "у",
  ӣ: "и",
  й: "и",
  ҳ: "х",
  ҷ: "ч",
  қ: "к",
  ғ: "г",
  ъ: "",
  ь: "",
  з: "с",
};
const VOWELS = /[aeiouаеиоуыэюя]/g;

/** Слово → скелет: общие замены букв, первая буква и согласные без повторов. */
function skeleton(word: string): string {
  let w = word.normalize("NFC").toLowerCase();
  if (/[a-z]/.test(w)) {
    w = w
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/gh/g, "g")
      .replace(/kh/g, "h")
      .replace(/y/g, "i")
      .replace(/z/g, "s")
      .replace(/q/g, "k")
      .replace(/w/g, "v");
  } else {
    // Русские прилагательные: «Файзабадский район» → «файзабад» (до замены «й»).
    w = w.replace(/(ин|ен)?ск(ий|ой|ая)$/, "");
    w = w.replace(/дж/g, "ч").replace(/[ёӯўӣйҳҷқғъьз]/g, (c) => CYRILLIC_MAP[c] ?? c);
  }
  w = w.replace(/[^a-zа-я]/g, "");
  if (!w) return "";
  const rest = w.slice(1).replace(VOWELS, "");
  return (w[0] + rest).replace(/(.)\1+/g, "$1");
}

/** Значимые слова названия (скелеты), без служебных слов. */
export function capPlaceWords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[\s\-‐–.,()«»"']+/u)
    .filter((w) => w && !STOP_WORDS.has(w))
    .map(skeleton)
    .filter(Boolean);
}

export function buildCapPlaceIndex(names: CapPlaceName[]): CapPlaceIndex {
  return {
    places: names
      .map((n) => ({ words: capPlaceWords(n.name), regionCode: n.regionCode }))
      .filter((p) => p.words.length > 0),
  };
}

/** Регионы одного названия (части areaDesc); null - не найдено. */
function matchPart(part: string, index: CapPlaceIndex): Set<string> | null {
  const words = capPlaceWords(part);
  if (words.length === 0) return null;
  const have = new Set(words);
  const codes = new Set<string>();
  for (const place of index.places) {
    if (place.words.every((w) => have.has(w))) codes.add(place.regionCode);
  }
  return codes.size > 0 ? codes : null;
}

/** Регионы по одному названию области (одного языка); null - хотя бы одна часть не найдена. */
function matchName(name: string, index: CapPlaceIndex): Set<string> | null {
  const parts = name
    .split(/[,;]|\s+(?:and|и|ва)\s+/iu)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const codes = new Set<string>();
  for (const part of parts) {
    const found = matchPart(part, index);
    if (!found) return null;
    for (const c of found) codes.add(c);
  }
  return codes;
}

/**
 * Коды регионов для области CAP по её названиям на разных языках (areaDesc одной и той же области
 * из info en/ru/tg). Названия, которые не удалось разобрать, пропускаются; если разобранные дают
 * разные регионы, берётся их пересечение. null - по названию регион не определить (тогда - геометрия).
 */
export function matchCapAreaRegions(names: string[], index: CapPlaceIndex): string[] | null {
  const results = names
    .filter((n) => n?.trim())
    .map((n) => matchName(n, index))
    .filter((r): r is Set<string> => r !== null);
  if (results.length === 0) return null;
  let codes = results[0] as Set<string>;
  for (const r of results.slice(1)) codes = new Set([...codes].filter((c) => r.has(c)));
  return codes.size > 0 ? [...codes].sort() : null;
}
