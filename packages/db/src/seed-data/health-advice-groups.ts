/**
 * Рекомендации для уязвимых групп (FR1.6) — черновик на согласование с медиками Агентства (D7).
 * Основа — рекомендации ВОЗ (WHO Global Air Quality Guidelines 2021, разделы о защите здоровья)
 * и EPA AirNow (Air Quality Guide for Particle Pollution) для категорий AQI.
 *
 * Тексты заданы по «ступеням риска» 1–6: национальная оперативная шкала (5 уровней) берёт
 * ступени 1–5, US AQI (6 категорий) — 1–6. Таджикский — черновой перевод (D10).
 */
import type { I18nText } from "@meteo/i18n";

export type VulnerableAudience = "children" | "pregnant" | "elderly" | "respiratory" | "cardio";

const t = (tg: string, ru: string, en: string): I18nText => ({ tg, ru, en });

/** Индекс массива = ступень риска − 1. */
export const GROUP_ADVICE: Record<VulnerableAudience, I18nText[]> = {
  children: [
    t(
      "Сайру гашт, бозӣ ва варзиш дар беруни бино — бе маҳдудият.",
      "Прогулки, игры и спорт на улице — без ограничений.",
      "Walks, play and outdoor sports without restrictions.",
    ),
    t(
      "Дар берун сайр кардан ва бозӣ кардан мумкин аст. Кӯдакони гирифтори астма ба ҳолати худ диққат диҳанд.",
      "Можно гулять и играть на улице. Детям с астмой — следить за самочувствием.",
      "Outdoor play is fine. Children with asthma should watch for symptoms.",
    ),
    t(
      "Бозиҳо ва варзиши тӯлонии фаъолро дар берун кам кунед, бештар танаффус гиред. Кӯдакони гирифтори астма ингаляторро дар назди худ нигоҳ доранд.",
      "Сократите долгие активные игры и спорт на улице, чаще делайте перерывы. Детям с астмой держать ингалятор под рукой.",
      "Cut down long, active play and sports outdoors and take more breaks. Children with asthma should keep their inhaler at hand.",
    ),
    t(
      "Дарси тарбияи ҷисмонӣ ва машқҳоро ба дохили бино гузаронед, сайрро кӯтоҳ кунед. Ҳангоми сулфа ё душвории нафаскашӣ ба духтур муроҷиат кунед.",
      "Перенесите физкультуру и тренировки в помещение, сократите прогулки. При кашле или затруднённом дыхании — к врачу.",
      "Move PE and training indoors and shorten walks. See a doctor if your child coughs or has trouble breathing.",
    ),
    t(
      "Дар хона бо тирезаҳои пӯшида бимонед, машғулиятҳои берунро бекор кунед. Агар дошта бошед, тозакунандаи ҳаворо истифода баред.",
      "Оставайтесь дома с закрытыми окнами, отмените занятия на улице. Используйте очиститель воздуха, если он есть.",
      "Stay at home with windows closed and cancel outdoor activities. Use an air purifier if you have one.",
    ),
    t(
      "Кӯдаконро ба берун набароред, тирезаҳоро пӯшида нигоҳ доред. Ҳангоми нафастангӣ, хиррос ё сустии ғайриодӣ фавран ба ёрии тиббӣ муроҷиат кунед (103).",
      "Не выводите детей на улицу, держите окна закрытыми. При одышке, свистящем дыхании или необычной вялости — срочно за медицинской помощью (103).",
      "Keep children indoors with windows closed. Seek urgent medical help (103) for shortness of breath, wheezing or unusual drowsiness.",
    ),
  ],
  pregnant: [
    t(
      "Маҳдудият нест — сайр дар ҳавои тоза фоиданок аст.",
      "Ограничений нет — прогулки на свежем воздухе полезны.",
      "No restrictions — walks in fresh air are good for you.",
    ),
    t(
      "Маҳдудият нест. Барои сайр боғҳо ва кӯчаҳои дуртар аз роҳҳои серҳаракатро интихоб кунед.",
      "Ограничений нет. Для прогулок выбирайте парки и улицы подальше от оживлённых дорог.",
      "No restrictions. Choose parks and streets away from busy roads for walks.",
    ),
    t(
      "Сайри тӯлонӣ дар канори роҳҳо ва сарбории шадидро дар берун кам кунед. Хонаро ҳангоми паст шудани сатҳи ифлосшавӣ ҳаво диҳед.",
      "Сократите долгие прогулки вдоль дорог и интенсивные нагрузки на улице. Проветривайте, когда уровень загрязнения снижается.",
      "Cut down long walks along roads and strenuous activity outdoors. Air your home when pollution levels drop.",
    ),
    t(
      "Бештар дар дохили бино бо тирезаҳои пӯшида бошед, аз сарборӣ дар берун даст кашед. Ҳангоми чарх задани сар, нафастангӣ ё бад шудани ҳол ба духтур муроҷиат кунед.",
      "Больше времени проводите в помещении с закрытыми окнами, откажитесь от нагрузок на улице. При головокружении, одышке или ухудшении самочувствия — к врачу.",
      "Spend more time indoors with windows closed and avoid exertion outdoors. See a doctor if you feel dizzy, short of breath or unwell.",
    ),
    t(
      "Дар дохили бино бимонед, агар имкон бошад — бо тозакунандаи ҳаво. Танҳо ҳангоми зарурат ва ба муддати кӯтоҳ ба берун бароед.",
      "Оставайтесь в помещении, по возможности с очистителем воздуха. Выходите только по необходимости и ненадолго.",
      "Stay indoors, with an air purifier if possible. Go out only when necessary and briefly.",
    ),
    t(
      "Бе зарурати ҷиддӣ ба берун набароед. Ҳангоми ҳар гуна бад шудани ҳол фавран ба ёрии тиббӣ муроҷиат кунед (103).",
      "Не выходите на улицу без крайней необходимости. При любом ухудшении самочувствия сразу обращайтесь за медицинской помощью (103).",
      "Do not go outside unless absolutely necessary. Seek medical help (103) immediately if you feel unwell in any way.",
    ),
  ],
  elderly: [
    t(
      "Маҳдудият нест — фаъолияти муқаррарӣ дар беруни бино.",
      "Ограничений нет — обычная активность на улице.",
      "No restrictions — normal outdoor activity.",
    ),
    t(
      "Фаъолияти муқаррарӣ. Одамони гирифтори бемориҳои музмин ба ҳолати худ диққат диҳанд.",
      "Обычная активность. Людям с хроническими болезнями — прислушиваться к самочувствию.",
      "Normal activity. People with chronic conditions should pay attention to how they feel.",
    ),
    t(
      "Сарбории тӯлонӣ ва вазнинро дар берун (кор дар наздиҳавлигӣ, сайри дароз) кам кунед. Доруҳоро дар назди худ нигоҳ доред.",
      "Сократите длительные и тяжёлые нагрузки на улице (работа в огороде, долгие прогулки). Держите лекарства под рукой.",
      "Reduce long or heavy exertion outdoors (gardening, long walks). Keep your medicines at hand.",
    ),
    t(
      "Бештар дар дохили бино бимонед, тирезаҳоро пӯшед ва аз сарборӣ дар берун худдорӣ кунед. Ҳангоми дарди қафаси сина, нафастангӣ ё заифӣ ба духтур муроҷиат кунед.",
      "Оставайтесь больше в помещении с закрытыми окнами, избегайте нагрузок на улице. При боли в груди, одышке или слабости — к врачу.",
      "Stay indoors more with windows closed and avoid exertion outdoors. See a doctor for chest pain, shortness of breath or weakness.",
    ),
    t(
      "Бе зарурат ба берун набароед, тозакунандаи ҳаворо истифода баред. Аз наздикон хоҳиш кунед, ки дар харид ва корҳои берун аз хона кумак кунанд.",
      "Не выходите на улицу без необходимости, используйте очиститель воздуха. Попросите родных помочь с покупками и делами вне дома.",
      "Don't go out unless necessary and use an air purifier. Ask relatives to help with shopping and errands.",
    ),
    t(
      "Дар хона бо тирезаҳои пӯшида бимонед. Ҳангоми бад шудани ҳол фавран ёрии таъҷилиро (103) даъват кунед.",
      "Оставайтесь дома с закрытыми окнами. При ухудшении самочувствия немедленно вызывайте скорую помощь (103).",
      "Stay at home with windows closed. If you feel worse, call an ambulance (103) immediately.",
    ),
  ],
  respiratory: [
    t(
      "Маҳдудият нест. Табобати муқаррариро идома диҳед.",
      "Ограничений нет. Продолжайте обычное лечение.",
      "No restrictions. Continue your usual treatment.",
    ),
    t(
      "Фаъолияти муқаррарӣ, вале ба сулфа ва нафастангӣ диққат диҳед. Ингаляторро бо худ гиред.",
      "Обычная активность, но следите за кашлем и одышкой. Ингалятор держите при себе.",
      "Normal activity, but watch for coughing and breathlessness. Carry your inhaler.",
    ),
    t(
      "Сарбориро дар берун, хусусан дар канори роҳҳо, кам кунед. Ингаляторро бо худ дошта бошед ва нақшаи амалро ҳангоми астма риоя кунед.",
      "Сократите нагрузки на улице, особенно у дорог. Держите ингалятор при себе и следуйте плану действий при астме.",
      "Reduce exertion outdoors, especially near roads. Carry your inhaler and follow your asthma action plan.",
    ),
    t(
      "Аз сарборӣ дар берун худдорӣ кунед, бештар дар дохили бино бошед. Агар аломатҳо шиддат ёбанд ё ингалятор нисбат ба одат бештар лозим шавад, ба духтур муроҷиат кунед.",
      "Избегайте нагрузок на улице, больше времени проводите в помещении. Если симптомы усиливаются или ингалятор нужен чаще обычного — обратитесь к врачу.",
      "Avoid exertion outdoors and spend more time indoors. See a doctor if symptoms get worse or you need your inhaler more often than usual.",
    ),
    t(
      "Дар дохили бино бо тирезаҳои пӯшида бимонед, тозакунандаи ҳаворо истифода баред. Захираи дору дошта бошед; ҳангоми хуруҷе, ки бо ингалятор намегузарад, ёрии таъҷилиро (103) даъват кунед.",
      "Оставайтесь в помещении с закрытыми окнами, используйте очиститель воздуха. Держите запас лекарств; при приступе, который не снимается ингалятором, вызывайте скорую помощь (103).",
      "Stay indoors with windows closed and use an air purifier. Keep a supply of medicines; call an ambulance (103) for an attack your inhaler doesn't relieve.",
    ),
    t(
      "Ба берун набароед. Табобати таъиншударо қатъиян риоя кунед; ҳангоми душвории нафаскашӣ фавран ёрии таъҷилиро (103) даъват кунед.",
      "Не выходите на улицу. Строго соблюдайте назначенное лечение; при затруднённом дыхании немедленно вызывайте скорую помощь (103).",
      "Do not go outside. Follow your prescribed treatment strictly; call an ambulance (103) immediately if breathing becomes difficult.",
    ),
  ],
  cardio: [
    t(
      "Маҳдудият нест — фаъолияти одатии ҷисмонӣ фоиданок аст.",
      "Ограничений нет — привычная физическая активность полезна.",
      "No restrictions — your usual physical activity is beneficial.",
    ),
    t(
      "Фаъолияти муқаррарӣ. Ба хастагии ғайриодӣ ё тапиши дил диққат диҳед.",
      "Обычная активность. Обращайте внимание на необычную усталость или сердцебиение.",
      "Normal activity. Watch for unusual tiredness or palpitations.",
    ),
    t(
      "Сарбории тӯлонӣ ва шадидро дар берун кам кунед. Доруҳоро тибқи таъинот истеъмол кунед ва дар назди худ нигоҳ доред.",
      "Сократите длительные и интенсивные нагрузки на улице. Принимайте лекарства по назначению и держите их под рукой.",
      "Reduce long or intense exertion outdoors. Take your medicines as prescribed and keep them at hand.",
    ),
    t(
      "Аз сарборӣ дар берун худдорӣ кунед, бештар дар дохили бино бимонед. Ҳангоми дард ё фишор дар қафаси сина, тапиши дил ё нафастангӣ фавран ба духтур муроҷиат кунед.",
      "Избегайте нагрузок на улице, оставайтесь больше в помещении. При боли или давлении в груди, сердцебиении, одышке — срочно к врачу.",
      "Avoid exertion outdoors and stay indoors more. Seek medical care promptly for chest pain or pressure, palpitations or shortness of breath.",
    ),
    t(
      "Дар дохили бино бо тирезаҳои пӯшида бимонед, сарбории ҷисмониро истисно кунед. Ҳангоми дарди қафаси сина фавран ёрии таъҷилиро (103) даъват кунед.",
      "Оставайтесь в помещении с закрытыми окнами, исключите физические нагрузки. При боли в груди немедленно вызывайте скорую помощь (103).",
      "Stay indoors with windows closed and avoid physical exertion. Call an ambulance (103) at once for chest pain.",
    ),
    t(
      "Ба берун набароед ва аз ҳар гуна сарборӣ худдорӣ кунед. Ҳангоми дарди қафаси сина, нафастангӣ ё заифӣ фавран ёрии таъҷилиро (103) даъват кунед.",
      "Не выходите на улицу, избегайте любых нагрузок. При боли в груди, одышке или слабости немедленно вызывайте скорую помощь (103).",
      "Do not go outside and avoid any exertion. Call an ambulance (103) immediately for chest pain, shortness of breath or weakness.",
    ),
  ],
};

/** Строки health_advice для шкалы: уровни 1…levels берут ступени риска 1…levels. */
export function groupAdviceRows(scaleId: number, levels: number) {
  const rows: Array<{
    scaleId: number;
    level: number;
    audience: VulnerableAudience;
    text: I18nText;
  }> = [];
  for (const [audience, texts] of Object.entries(GROUP_ADVICE) as Array<
    [VulnerableAudience, I18nText[]]
  >) {
    for (let level = 1; level <= levels; level++) {
      const text = texts[level - 1];
      if (text) rows.push({ scaleId, level, audience, text });
    }
  }
  return rows;
}
