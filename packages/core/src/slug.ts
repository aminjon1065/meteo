/** Транслитерация кириллицы (русский и таджикский алфавиты) в латиницу для slug'ов и кодов. */
const map: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
  // таджикские буквы
  ғ: "gh",
  ӣ: "i",
  қ: "q",
  ӯ: "u",
  ҳ: "h",
  ҷ: "j",
};

export function transliterate(input: string): string {
  return Array.from(input.toLowerCase())
    .map((ch) => (ch in map ? map[ch] : ch))
    .join("");
}

/** slug: латиница, цифры и дефисы; не длиннее max символов. */
export function slugify(input: string, max = 64): string {
  const s = transliterate(input)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return s.slice(0, max).replace(/-+$/g, "");
}
