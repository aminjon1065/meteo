# Глоссарий терминов интерфейса (tg / ru / en)

Единый словарь для `messages/*.json`, писем, документации и текстов администратора. Таджикский —
государственный язык и язык по умолчанию (кириллица; буквы ы, щ, ц, ь не используются). Термины
ниже — канонические написания; синонимы в интерфейсе не допускаются. Валидация носителем языка — D10.

## Портал и разделы

| Термин (ru) | tg | en | Ключи / где используется |
|---|---|---|---|
| Метеопортал | Метеопортал | Meteoportal | `common.siteName`, брендинг |
| Агентство по гидрометеорологии | Агентии обуҳавошиносӣ | Agency for Hydrometeorology | `common.agency`, подвал |
| Качество воздуха | Сифати ҳаво | Air quality | `nav.air`, `air.*` |
| Погода | Обу ҳаво | Weather | `nav.weather`, `weather.*` |
| Предупреждения (CAP) | Огоҳиҳо | Warnings | `nav.warnings`, `warnings.*` |
| Уведомления (подписка, пороги) | Огоҳиҳо (обуна, ҳадҳо) | Alerts | `alerts.*`, `subscribe.*` |
| Новости | Ахбор | News | `nav.news`, `news.*` |
| Здоровье / рекомендации | Саломатӣ / тавсияҳо | Health / advice | `nav.health`, `health.*` |
| Открытые данные | Маълумоти кушода | Open data | `nav.data`, `data.*` |
| О портале | Дар бораи портал | About | `nav.about`, `about.*` |
| Об индексе | Дар бораи индекс | About the index | `footer.aboutIndex`, `aboutIndex.*` |
| API для разработчиков | API барои таҳиягарон | API for developers | `footer.api`, `apiDocs.*` |
| Карта | Харита | Map | `nav.map`, `map.*` |

## Измерения и индекс

| ru | tg | en | Примечание |
|---|---|---|---|
| Станция (мониторинга) | Истгоҳ (мониторинг) | (monitoring) station | `stations.*`, `admin.stations` |
| Измерение | Ченак | Measurement | `admin.measurements`, `measurements.*` |
| Вещество / загрязнитель | Модда | Pollutant | `index.pollutant`, `pollutants.*` |
| Концентрация | Консентратсия | Concentration | единицы µg/m³, mg/m³, ppm, ppb без перевода; единица отображения — настройка администратора |
| Среднесуточная концентрация | Консентратсияи миёнаи шабонарӯзӣ (м.ш.б) | Daily mean concentration | терминология бюллетеней Агентства; `index.agency.dailyMean` |
| Максимальная разовая концентрация | Консентратсияи якмаротибагии баландтарин (я.м.б) | Maximum single concentration | `index.agency.maxSingle` |
| Индекс качества воздуха | Индекси сифати ҳаво | Air quality index | `index.*` |
| Под‑индекс | Зериндекс | Sub-index | `aboutIndex.operational.subindex` |
| Определяющее вещество | Моддаи муайянкунанда | Dominant pollutant | `index.dominant` |
| Шкала | Шкала | Scale | `index.scale`, `scales.*` |
| Порог | Ҳад | Threshold | `scales.*`, `aboutIndex.thresholds` |
| ПДК (предельно допустимая концентрация) | ҲМҒ (ҳадди муайяни ғилзат) | Limit value (MPC) | `aboutIndex.limits.*`, `scales.limits.*`; как в бюллетенях Агентства |
| ПДКс.с. (среднесуточная) | ҲМҒ(м.ш.р) — ҳадди муайяни ғилзати миёнаи шабонарӯзӣ | Daily MPC | `scales.limits.daily`, `index.agency.dailyLimit` |
| ПДКм.р. (максимальная разовая) | ҲМҒ(як) — ҳадди муайяни ғилзати якмаротибагӣ | Single MPC | `scales.limits.maxSingle`, `index.agency.maxSingleLimit` |
| Кратность ПДК | Каррати ҲМҒ / нисбат ба ҲМҒ | Ratio to MPC | `scales.kind.ratio_to_limit`, `index.agency.*` |
| Суммация NO₂+SO₂ | Ҷамъи дуоксидҳои нитрогену сулфур (NO₂+SO₂) | NO₂+SO₂ summation | `index.agency.sum*`, `aboutIndex.agency.sum.*` |
| ВЗ (высокое загрязнение, ≥ 10 ПДКм.р.) | ИБ (ифлосшавии баланд) | HP (high pollution) | `index.agency.highPollution*` |
| ЭВЗ (экстремально высокое загрязнение, ≥ 50 ПДКм.р.) | НИБ (ифлосшавии ниҳоят баланд) | EHP (extremely high pollution) | `index.agency.extremeHighPollution*` |
| ИЗА (индекс загрязнения атмосферы) | ИИА (индекси ифлосшавии атмосфера) | IZA (air pollution index) | `aboutIndex.national.iza` |
| Осреднение | Миёнагирӣ | Averaging | `aboutIndex.averaging` |
| Контроль качества (QC) | Назорати сифат | Quality control | `qc.*`, `admin.stats.qcQueue` |
| Данные устарели | маълумот кӯҳна шудааст | data is stale | `index.stale`, `admin.*.stale` |
| Нет данных | Маълумот нест | No data | `levels.0`, `common.noData` |
| Превышение | Зиёдшавӣ | Exceedance | `exceedances.*`, `admin.stats.activeAlerts` |

### Уровни индекса (`levels.*`)

| Уровень | tg | ru | en |
|---|---|---|---|
| 1 | Хуб | Хороший | Good |
| 2 | Қаноатбахш | Удовлетворительный | Satisfactory |
| 3 | Миёна | Умеренный | Fair |
| 4 | Бад | Плохой | Poor |
| 5 | Хеле бад | Очень плохой | Very poor |
| 0 | Маълумот нест | Нет данных | No data |

### Вещества (`pollutants.*`)

| Код | tg | ru | en |
|---|---|---|---|
| PM25 | Зарачаҳои 2,5 мкр. (PM2.5) | Взвешенные частицы PM2.5 | PM2.5 particles |
| PM10 | Зарачаҳои 10 мкр. (PM10) | Взвешенные частицы PM10 | PM10 particles |
| NO2 | Дуоксиди нитроген | Диоксид азота | Nitrogen dioxide |
| SO2 | Дуоксиди сулфур | Диоксид серы | Sulphur dioxide |
| CO | Оксиди карбон | Оксид углерода | Carbon monoxide |
| O3 | Озон | Озон | Ozone |
| NO | Оксиди нитроген | Оксид азота | Nitric oxide |
| CH2O | Формалдегид | Формальдегид | Formaldehyde |
| C6H5OH | Фенол | Фенол | Phenol |
| HF | Фториди гидроген | Фтористый водород | Hydrogen fluoride |
| TSP | Моддаҳои муаллақ (чанг) | Взвешенные частицы (пыль) | Suspended particulates (dust) |
| CO2 | Гази карбонат (CO₂) | Диоксид углерода (CO₂) | Carbon dioxide (CO₂) |
| TVOC | ПОЗ (TVOC) — пайвастагиҳои органикии зудбухоршаванда | ЛОС (TVOC) | TVOC |

Названия веществ и термины ПДК — по ежедневным бюллетеням Агентства (Экобюллетень г. Душанбе, ЗАВ/ИҲА, форма 4а от 19.10.2026).

## Предупреждения CAP (`warnings.*`)

| Severity | tg | ru | en | Цвет |
|---|---|---|---|---|
| Minor | Хатари паст | Низкая опасность | Minor danger | жёлтый (`--aq-2`) |
| Moderate | Хатари миёна | Умеренная опасность | Moderate danger | оранжевый (`--aq-3`) |
| Severe | Хатари баланд | Высокая опасность | Severe danger | красный (`--aq-4`) |
| Extreme | Хатари фавқулодда | Чрезвычайная опасность | Extreme danger | красный (`--aq-4`) |

Прочее: сообщение CAP — паёми CAP / CAP message; обновлено — навсозӣ шуд / updated; отменено —
бекор карда шуд / cancelled; действует / ожидается — амал мекунад / интизор аст — active / upcoming.

## Группы населения (`health.audience.*`)

| Код | tg | ru | en |
|---|---|---|---|
| general | Аҳолии умумӣ | Общее население | General population |
| children | Кӯдакон | Дети | Children |
| pregnant | Занони ҳомила ва ширдеҳ | Беременные и кормящие | Pregnant and breastfeeding |
| elderly | Пиронсолон | Пожилые люди | Elderly people |
| respiratory | Бемориҳои музмини роҳи нафас | Хронические респираторные заболевания | Chronic respiratory diseases |
| cardio | Бемориҳои дилу раг | Сердечно-сосудистые заболевания | Cardiovascular diseases |

## Прогнозы и интеграции

| ru | tg | en |
|---|---|---|
| Прогноз (погоды) | Пешгӯӣ (обу ҳаво) | (weather) forecast |
| Прогноз качества воздуха (SILAM) | Пешгӯии сифати ҳаво (SILAM) | Air quality forecast (SILAM) |
| Запуск модели | Оғози модел | Model run |
| Интеграция | Интегратсия | Integration |
| Источник (данных) | Манбаъ | Source |
| Синхронизация | Синхронизатсия | Synchronisation |
| Фоновый сервис (worker) | Хизмати фонӣ | Background service |
| Актуально / устарело | навсозӣ шуда / кӯҳна шудааст | up to date / stale |
| Приостановлено (circuit breaker) | боздошта шудааст | paused |
| Сбой | Нокомӣ | Failure |

Названия продуктов не переводятся: SmartMet, SmartMet Alert, SILAM, CAP, FMI, THREDDS, OpenAPI, JSON, CSV, GeoJSON, RSS, TOTP, 2FA, SMTP, API.

## Администрирование

| ru | tg | en |
|---|---|---|
| Административная панель | Панели маъмурӣ | Admin panel |
| Дашборд | Лавҳаи идора | Dashboard |
| Пользователь | Корбар | User |
| Роль: администратор / оператор / редактор | Нақш: маъмур / оператор / муҳаррир | Role: administrator / operator / editor |
| Двухфакторная аутентификация (2FA) | Аутентификатсияи дуомила (2FA) | Two-factor authentication (2FA) |
| Код подтверждения | Рамзи тасдиқ | Verification code |
| Резервный код | Рамзи эҳтиётӣ | Backup code |
| Заблокировать / разблокировать | Бастан / кушодан | Block / unblock |
| Сессия | Сессия | Session |
| Журнал аудита | Феҳристи аудит | Audit log |
| Настройки | Танзимот | Settings |
| Брендинг | Брендинг | Branding |
| Очередь писем | Навбати номаҳо | Mail queue |
| Подписчик | Обуначӣ | Subscriber |
| Бюллетень | Бюллетен | Bulletin |
| Рубрика | Рубрика | Category |
| Медиафайлы | Файлҳои медиа | Media |

## Правила оформления

- Даты и время — через `useFormatter`/`getFormatter`, пояс `Asia/Dushanbe`; в API и CSV — UTC + местное время.
- Единицы: µg/m³, mg/m³, м/с (tg: м/с, en: m/s), гПа (hPa), °C — без пробела перед °C, с пробелом перед % в ru/tg.
- Множественное число — ICU `plural` в ru (one/few/many/other); в tg форма не меняется, но ключ сохраняет `plural` с one/other для единообразия.
- Кнопки — глагол в инфинитиве (ru), масдар на «‑дан/‑тан» (tg), imperative (en); заголовки — существительные.
- Сообщения об ошибках — короткие, без кодов; код ошибки сервера → ключ `errors.<code>`.
