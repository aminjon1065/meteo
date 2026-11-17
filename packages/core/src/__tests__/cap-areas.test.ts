import { describe, expect, it } from "vitest";
import { buildCapPlaceIndex, capPlaceWords, matchCapAreaRegions } from "../cap-areas";

// Фрагмент справочника портала (districts + warning_regions) в том виде, как он лежит в базе.
const index = buildCapPlaceIndex(
  [
    ["DU", "Dushanbe city", "Город Душанбе", "Шаҳри Душанбе"],
    [
      "RRP",
      "Districts of Republican Subordination",
      "Районы республиканского подчинения",
      "Ноҳияҳои тобеи ҷумҳурӣ",
    ],
    ["KT", "Khatlon region", "Хатлонская область", "Вилояти Хатлон"],
    ["DU", "Sino district", "Район Сино", "Ноҳияи Сино"],
    ["RRP", "Rudaki district", "Район Рудаки", "Ноҳияи Рӯдакӣ"],
    ["RRP", "Fayzobod district", "Файзабадский район", "Ноҳияи Файзобод"],
    ["RRP", "Vahdat city", "Город Вахдат", "Шаҳри Ваҳдат"],
    ["RRP", "Vahdat district", "Вахдатский район", "Ноҳияи Ваҳдат"],
    ["KT", "Khuroson district", "Хуросонский район", "Ноҳияи Хуросон"],
    ["KT", "Danghara district", "Дангаринский район", "Ноҳияи Данғара"],
    ["KT", "Hamadoni district", "Район Хамадони", "Ноҳияи Ҳамадонӣ"],
    ["KT", "Panj district", "Пянджский район", "Ноҳияи Панҷ"],
    ["KT", "Yovon district", "Яванский район", "Ноҳияи Ёвон"],
    ["SU", "Panjakent city", "Город Пенджикент", "Шаҳри Панҷакент"],
    ["SU", "Jabbor Rasulov district", "Джаббор-Расуловский район", "Ноҳияи Ҷаббор Расулов"],
  ].flatMap(([code, ...names]) => names.map((name) => ({ name, regionCode: code as string }))),
);

describe("capPlaceWords", () => {
  it("убирает служебные слова и сводит разные написания к одному скелету", () => {
    expect(capPlaceWords("Faizobod")).toEqual(capPlaceWords("Fayzobod district"));
    expect(capPlaceWords("Dangara")).toEqual(capPlaceWords("Danghara district"));
    expect(capPlaceWords("Рўдакӣ")).toEqual(capPlaceWords("Ноҳияи Рӯдакӣ"));
    expect(capPlaceWords("Файзабад")).toEqual(capPlaceWords("Файзабадский район"));
    expect(capPlaceWords("Яван")).toEqual(capPlaceWords("Яванский район"));
  });
});

describe("matchCapAreaRegions", () => {
  it("район редактора FMI - в свою область, а не во все, что задевает его контур", () => {
    expect(matchCapAreaRegions(["Rudaki", "Рудаки", "Рўдакӣ"], index)).toEqual(["RRP"]);
    expect(matchCapAreaRegions(["Faizobod", "Файзабад", "Файзобод"], index)).toEqual(["RRP"]);
    expect(matchCapAreaRegions(["Dushanbe", "Душанбе", "Душанбе"], index)).toEqual(["DU"]);
  });

  it("длинное название у FMI и короткое в справочнике", () => {
    expect(matchCapAreaRegions(["Mir Said Ali Hamadoni", "Мир Сайид Али Хамадони"], index)).toEqual(
      ["KT"],
    );
  });

  it("город и район с одним названием - один регион", () => {
    expect(matchCapAreaRegions(["Vahdat", "Вахдат", "Ваҳдат"], index)).toEqual(["RRP"]);
  });

  it("слово целиком: Panj не совпадает с Panjakent", () => {
    expect(matchCapAreaRegions(["Panj"], index)).toEqual(["KT"]);
    expect(matchCapAreaRegions(["Panjakent"], index)).toEqual(["SU"]);
  });

  it("несколько районов через запятую или «и» - все их регионы", () => {
    expect(matchCapAreaRegions(["Rudaki, Khuroson"], index)).toEqual(["KT", "RRP"]);
    expect(matchCapAreaRegions(["Рудаки и Хуросон"], index)).toEqual(["KT", "RRP"]);
  });

  it("язык, который не разобран, не мешает остальным", () => {
    expect(matchCapAreaRegions(["Yovon", "Неизвестно", "Ёвон"], index)).toEqual(["KT"]);
  });

  it("неизвестное название или часть списка - null (тогда регион по геометрии)", () => {
    expect(matchCapAreaRegions(["the whole country"], index)).toBeNull();
    expect(matchCapAreaRegions(["Rudaki, Atlantis"], index)).toBeNull();
    expect(matchCapAreaRegions([], index)).toBeNull();
  });
});
