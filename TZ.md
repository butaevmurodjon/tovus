# ТЗ — Ядро модерации v2: скоринг спама, нечёткий поиск, граф связей, кеш/БД на 1M записей, гонки

> **Статус:** черновик для ревью (RFC).
> **Проект:** tg-atispam — Telegram-бот модерации групп + Mini App (Next.js, Vercel serverless, Upstash Redis, grammY).
> **Документ:** техническое задание на крупное изменение ядра модерации и архитектуры данных.
> **Читатель:** владелец проекта, разработчик. ТЗ писать по-русски, код-примеры — TypeScript.

---

## 0. Резюме (Executive Summary)

### 0.1 Цель
Превратить бинарный эвристический фильтр (набор независимых boolean-проверок
с ранним выходом) в **скоринговый движок**, устойчивый к обфускации спама,
с **нечётким поиском дубликатов**, **графом связей пользователей** для
обнаружения спам-сетей, **оптимальной схемой кеширования** и **хранилищем,
рассчитанным на ~1 млн записей**, при этом закрыв найденные гонки состояний
и неаккуратности в асинхронном коде.

### 0.2 Что меняется в смысле проекта
Сейчас продукт позиционируется как «фильтр мата/спама + капча + PRO».
После внедрения он становится:

- **скоринговым антиспам-движком** (каждое сообщение получает оценку и
  «объяснение», а не просто вердикт);
- **сетевым антиспамом** (обнаружение связанных аккаунтов/спам-сетей через
  граф общих групп, упоминаний и сигнатур текстов — это то, чего нет у
  большинства конкурентов в нише ru+uz);
- **данными, а не только фильтром** (журнал оценок, кластеры, статистика —
  из этого можно строить платные аналитические функции и точнее тарифицировать PRO).

### 0.3 Оценка эффекта (кратко)

| Блок | Что даёт | Ожидаемый эффект | Стоимость внедрения |
|---|---|---|---|
| Скоринг спама | Взвешенные сигналы + пороги | −FPR на обычном чате, +TPR на обфускации, объяснимость | Средняя (ядро) |
| Нечёткий поиск дублей (Левенштейн) | Ловит «копипаста» с опечатками/подменой символов | +TPR на рейдах-копипастах | Средняя |
| Граф связей | Обнаружение сетей мультиакков | Новый класс защиты (проактив) | Высокая (итеративно) |
| Кеш Redis | Анти-стампед, TTL-политика, меньше запросов к Telegram API | −латенция, −затраты | Низкая |
| PostgreSQL на 1M записей | Историчность, аналитика, дешёвое хранение | Масштаб, аналитика, retention | Высокая (поэтапно) |
| Гонки (Race Conditions) | Атомарность updateSettings и счётчиков | −потерянные апдейты, −двойные наказания | Низкая–средняя |
| Аудит асинхронности | Чистка таймеров, отмена poll, обработка rejections | Стабильность, меньше «висячих» состояний | Низкая |

---

## 1. Текущее состояние («как есть»)

### 1.1 Архитектура
- Один Next.js-проект на Vercel (`runtime = "nodejs"`), вебхук
  `/api/telegram/webhook` (`maxDuration = 30`, таймаут grammY `25s`,
  `onTimeout: "return"`).
- Бот grammY, обработка `message | edited_message`, `chat_member`,
  `my_chat_member`, `callback_query` (капча), `pre_checkout_query`,
  `successful_payment`.
- Хранилище — **Upstash Redis** (serverless, HTTP, атомарные команды и
  Lua-скрипты `EVAL` доступны; RedisGraph **недоступен** и сам продукт
  RedisGraph компанией Redis снят с поддержки — см. §6).
- Mini App (React, App Router) читает настройки через
  `/api/miniapp/groups[...]` (initData-авторизация).

### 1.2 Пайплайн модерации сегодня (`lib/moderation/index.ts`)
1. `consumeNewMemberFlag` — флаг «первое сообщение» (мягкая реакция).
2. `detectProfanity` — regex по словарям ru/uz + custom-слова группы
   (схема «буквенные классы + разделители» уже устойчива к подмене
   `0/о`, `3/е`, `@/а`, точек/пробелов между буквами).
3. `detectSpam` — **бинарные** проверки с ранним возвратом:
   - опасный файл (`.apk/.exe/...` + MIME),
   - маскированная ссылка (видимый текст-домен ≠ href),
   - чёрный список доменов (шортнеры),
   - t.me invite-ссылки,
   - пересылка/ссылка + CTA-фраза,
   - `>=2` ссылок (severity `low`),
   - `>=4` упоминаний (`low`),
   - 1 упоминание + CTA (`low`).
4. Флуд: `checkUserFlood` (N сообщений за окно), `checkDuplicateFlood`
   (точный хэш текста), `checkRaid` (N вступлений за окно).
5. Groq-классификация при `settings.premium` (пулы квот free/pro).
6. Вердикт → `applyViolation` (delete/warn/mute/ban, эскалация варнов,
   федерация банов, журнал, статистика, лог-канал).

### 1.3 Ключевые ограничения и допущения (важно для ТЗ)
- **Serverless без постоянного процесса**: нельзя полагаться на in-memory
  состояние, фоновые воркеры, `setInterval` для экспирации. Всё лениво
  (например, sweep капчи по следующему сообщению) или через TTL в Redis.
- **Redis — источник истины сейчас** (настройки, статистика, журнал, warns,
  админ-индексы). Для 1M записей in-memory хранение становится дорогим.
- **Вебхук-таймаут ~25–30 c**: любые новые этапы пайплайна обязаны
  укладываться в бюджет и иметь таймауты/фолбэки (принцип «фолбэк на базовые
  правила», как в Groq-пути).
- **Принцип fail-closed**: сбой админ/whitelist-проверки не должен пропускать
  модерацию; сбои внешних сервисов (CAS, Groq) — должны фолбэчить в базовые
  правила, а не ломать чат.
- **Правила для edited_message**: правки не считаются в статистику/флуд, но
  проверяются по контенту.

---

## 2. Проблемы и целевые показатели

### 2.1 Список проблем

| # | Проблема | Где | Последствие |
|---|---|---|---|
| P1 | Бинарные проверки с ранним выходом: одно «слабое» сообщение (1 ссылка + CTA-слово) = вердикт, а накопление слабых сигналов не учитывается | `spam.ts` | Ложные срабатывания и пропуски одновременно |
| P2 | Дубликаты ловятся только по точному хэшу после `trim().toLowerCase()` | `flood.ts` `hashText` | «копипаст» с опечатками/подменой `0/о`, `!`/`i`, пробелов — проходит |
| P3 | Нет анализа связей пользователей | отсутствует | Невозможно ловить спам-сети, мультиакки, синхронные рейды |
| P4 | Нет единой схемы кеширования, нет анти-стампед, дублирующие GET в Telegram API | `memberCount.ts`, `cas.ts`, `adminCheck.ts` | Латенция, расход квот Telegram API, гонки «стада» |
| P5 | Всё в Redis без разбиения hot/cold | `db/*` | Масштаб ~1M записей нереализуем по памяти/цене |
| P6 | `updateGroupSettings` — read-modify-write не атомарен | `groups.ts` + `PATCH` роут | Параллельные PATCH теряют поля; платёж может затёрт админ-апдейтом |
| P7 | Мелкие гонки: `consumeNewMemberFlag` (GET→DEL), INCR→EXPIRE без Lua, cache stampede | `flood.ts`, `stats.ts`, `cas.ts` | Редкие, но реальные: двойная «мягкая реакция», вечные ключи без TTL |
| P8 | Таймеры без отмены: `pollForProActivation`, `clearTimeout` не во всех ветках Groq/CAS | `GroupProvider.tsx`, `groq.ts`, `cas.ts` | «Висячие» таймеры, setState после unmount, лишние запросы |
| P9 | Один большой regex мата компилируется на модуль — хорошо; но `buildCustomWordsRegex` пересобирается на каждое сообщение, а при росте словарей regex-путь деградирует | `profanity.ts` | CPU-стоимость в горячем пути |

### 2.2 Целевые показатели (SLO)

| Метрика | Текущее | Цель |
|---|---|---|
| p95 латенция модерации (без Groq) | ~50–150 мс | ≤ 250 мс (бюджет: Redis ≤ 3 round-trip, локальный scoring) |
| p95 латенция с Groq | ≤ 6 с (таймаут) | ≤ 6 с, но 90% вердиктов — без Groq |
| FPR на «обычном» чате | эвристики дают шум | −30% ложных срабатываний на слабых сигналах (scoring вместо «any hit») |
| TPR на обфусцированном копипасте | точный хэш → ~0% | ≥ 70% через нечёткое сравнение |
| Запросов `getChatMember/getChatMemberCount` | на каждый вызов без кеша | −80% за счёт кеша + single-flight |
| Объём хранилища | Redis только | Redis (hot) + PostgreSQL (cold, 1M+) |
| Потеря апдейтов настроек из-за гонок | есть | 0 (атомарные патчи) |

---

## 3. Этап 0 — Аудит асинхронного кода: дедлоки и утечки памяти

### 3.1 Методология
В serverless-модели классический «дедлок» (взаимная блокировка потоков)
маловероятен: запрос живёт один цикл, нет общих мьютексов. Реальные риски:

1. **Утечка таймеров** — `setTimeout` без `clearTimeout` во всех ветках.
2. **setState после unmount / незавершённые цепочки** — таймеры, которые
   переживают компонент или запрос.
3. **Unhandled rejection** — `Promise.all` без обработки одной ветки.
4. **Вечные/растущие структуры** — Redis-ключи без TTL, массивы, растущие
   без лимита.
5. **Синтетический «виртуальный дедлок»** — вебхук-обработчик, который
   ждёт сам себя (grammY `onTimeout: "return"` уже страхует).

### 3.2 Результаты аудита по файлам (найдено)

| Файл | Что найдено | Серьёзность | Рекомендация |
|---|---|---|---|
| `lib/moderation/groq.ts` | `setTimeout` таймаута очищается только в успешной ветке; в `catch` (retry/return null) таймер может остаться висеть до срабатывания | Низкая | `clearTimeout` в `finally`; обернуть таймаут в helper |
| `lib/moderation/cas.ts` | Та же картина с `AbortController`-таймером в `fetch` | Низкая | Тот же helper |
| `contexts/GroupProvider.tsx` | `pollForProActivation` — цепочка `setTimeout` без отмены при unmount; setState после размонтирования; нет защиты от дублей (двойной клик по «Оформить PRO» запускает два цикла) | Средняя | `useRef` флаг отмены + guard `upgrading`; отменять цепочку при unmount |
| `lib/telegram/federation.ts` | `Promise.all(candidates.map(...))` без `allSettled`; один сбой `getGroupSettings` роняет всю propagation | Низкая (обёрнуто в `.catch` у вызывающего) | Заменить на `allSettled` внутри |
| `lib/telegram/captcha.ts` | `sweepExpiredCaptchas` — ленивый цикл по pending-множеству; при росте pending (рейд) это N последовательных await в одном вебхуке | Средняя | Лимит батча за вызов (например, 50), остальное — на следующий вызов |
| `lib/db/stats.ts`, `lib/moderation/flood.ts` | `INCR` затем `EXPIRE` — если процесс упадёт между, ключ остаётся без TTL | Низкая | Lua-скрипт (см. §9) |
| `lib/moderation/profanity.ts` | Пересборка custom-регекса на каждое сообщение | Средняя (CPU) | Кеш на уровне группы + версия (см. §5.4) |
| В целом | Модульные синглтоны `_redis`, `_client`, `_bot` — утечки не найдено (Upstash-клиент без пула соединений; Groq-клиент держит keep-alive, но ограничен одним инстансом) | — | Ок, но для Groq добавить явный таймаут на уровне клиента |

### 3.3 Дедлоки — вывод
Реальных взаимоблокировок в текущем коде не обнаружено. Есть один
«структурный» риск, который стоит зафиксировать в ТЗ как требование:
**никакой обработчик вебхука не должен делать ожидание дольше таймаута
платформы, и любые цепочки `setTimeout` обязаны иметь отмену**. grammY
`onTimeout: "return"` уже защищает от «повисшего» вебхука — сохранять это.

### 3.4 Чек-лист внедрения (Этап 0)
- [ ] Helper `withTimeout<T>(promise, ms, onTimeout)` (использовать в Groq, CAS).
- [ ] `clearTimeout` в `finally` в Groq/CAS.
- [ ] `pollForProActivation` — `useRef`-флаг, отмена при unmount, guard от дублей.
- [ ] `federation.ts` → `Promise.allSettled`.
- [ ] `sweepExpiredCaptchas` — лимит батча.
- [ ] Тесты: unit-тест таймаут-хелпера; тест, что `pollForProActivation`
      не вызывает `setState` после отмены.

**Оценка эффекта:** низкая стоимость, средняя ценность (стабильность,
меньше «висячих» состояний). Файлы: `lib/moderation/groq.ts`,
`lib/moderation/cas.ts`, `contexts/GroupProvider.tsx`, `lib/telegram/federation.ts`,
`lib/telegram/captcha.ts`.

---

## 4. Этап 1 — Скоринг спама (замена бинарных проверок на взвешенный скоринг)

### 4.1 Принцип
Вместо «первое сработавшее правило → вердикт» вводится **конвейер сигналов**:
каждый детектор возвращает **вес** и **доказательство** (текстовое объяснение).
Сумма весов сравнивается с порогами. Это решает проблему P1: слабые сигналы
накапливаются, сильные — сразу дают вердикт, а «обычный чат» с одним слабым
сигналом не наказывается.

### 4.2 Конвейер

```
сообщение
  ├─ 0. Нормализация (текст, entities, файлы)          [§4.3]
  ├─ 1. Fast-path сигналы (детерминированные, дешёвые)  [§4.4]
  ├─ 2. Сигналы «средней цены» (ссылки, mentions, CTA)  [§4.4]
  ├─ 3. Нечёткий поиск дублей (Левенштейн)              [§5]
  ├─ 4. Репутация отправителя (скользящий скоринг)      [§4.5]
  ├─ 5. (опц.) Groq-классификация как доп. сигнал       [§4.6]
  └─ 6. Сумма → зона решения (ok / warn / escalate)     [§4.7]
```

### 4.3 Нормализация (общая для скоринга и нечёткого поиска)
Вынести в `lib/moderation/normalize.ts`:

```ts
export function normalizeMessageText(raw: string): string {
  // 1) NFC-нормализация (ё/е, комбинируемые диакритики)
  // 2) lowercase
  // 3) Подмена «визуально похожих» символов на канонические:
  //    переиспользуем LETTER_CLASSES из profanityDict (0→о, 3→е, @→а, !/1→i, ...)
  // 4) Схлопывание пробелов и удаление «мусорных» разделителей (._-,*'`~)
  // 5) (для поиска дублей) — удаление служебных слов-заполнителей (опционально)
}
```

Эта же функция используется в `detectProfanity` (замена текущей
`text.toLowerCase()`), `detectSpam`, `checkDuplicateFlood`, `hashText`.

### 4.4 Сигналы и веса (первая версия таблицы)

| Сигнал | Вес | Порог/условие | Зона |
|---|---|---|---|
| Опасный файл (apk/exe/MIME) | 100 (безусловно) | детект | escalate |
| Маскированная ссылка (текст-домен ≠ href) | 90 | детект | escalate |
| Домен из чёрного списка | 85 | детект | escalate |
| t.me invite-ссылка | 80 | детект | escalate |
| Пересылка + CTA | 70 | детект | escalate |
| Ссылка + CTA | 65 | детект | escalate |
| 3+ ссылок | 55 | count ≥ 3 | warn |
| 2 ссылки | 30 | count = 2 | накопление |
| Массовые mentions (≥4) | 45 | count ≥ 4 | warn |
| 1 mention + CTA | 35 | детект | накопление |
| CTA-фраза сама по себе | 20 | детект | накопление |
| Точный дубль текста в окне | 60 | dup-flood | warn |
| Нечёткий дубль (sim ≥ 0.85) | 40 | §5 | накопление/warn |
| Флуд-счётчик пользователя | 50 | §4.5 | warn |
| Отправитель в «горячем» списке | +20 | §4.5 | модификатор |
| Новый аккаунт (< 7 дней, чат-юзербейз) | +10 | §4.5 | модификатор |

### 4.5 Репутация отправителя (скользящий скоринг)
Вводим Redis-структуру на пользователя в чате:

```
key: rep:user:{chatId}:{userId}
тип: HASH
поля:
  score        — накопленный модификатор (integer, знаковый)
  firstSeen    — unix ms
  hitCount     — число срабатываний сигналов
  lastHitAt    — unix ms
TTL: 30 дней с последнего обновления (EXPIRE на каждый инкремент)
```

Правила:
- каждый «накопленный» сигнал добавляет +2..+5 к `score` (по весу),
- `score ≥ 30` → модификатор +20 к следующей сумме,
- `score ≥ 60` → зона warn даже при низкой сумме сообщения,
- «здоровый» чат: сигнал, который **не** набрал порог, уменьшает `score`
  (амортизация) — чтобы случайные срабатывания не копились вечно.

### 4.6 Groq как дополнительный сигнал
Не «самостоятельный судья», а сигнал в конвейер:
- вызывается только если сумма сигналов в зоне «пограничье» (например,
  между `WARN_LO` и `ESCALATE`) **и** `settings.premium`;
- результат маппится в вес (violation → +40..+60, none → −10..−20);
- учитывает пулы квот free/pro (существующий механизм сохраняем).

### 4.7 Зоны решения

```ts
const ZONES = {
  ok:       { from: -Infinity, to: 20 },   // пропустить
  warn:     { from: 21, to: 59 },          // warn/мягкая реакция (forceWarnOnly для новых)
  escalate: { from: 60, to: Infinity },    // действие по настройкам группы
};
```

Сохранение текущей семантики: `severity: "low"` ≈ зона `warn`,
`severity: "high"` ≈ зона `escalate`. `forceWarnOnly` для первого сообщения —
сохраняется.

### 4.8 Журналирование оценок (для калибровки)
Каждый вердикт пишет в журнал не только категорию, но и:
`{ score, signals: [{name, weight, evidence}], zone }`.
Это даёт возможность A/B-тюнить пороги на реальных данных и показывать
«почему сработало» в Mini App (журнал).

### 4.9 Совместимость и миграция
- `ModerationVerdict` расширяется полями `score`, `signals` (необязательные).
- Существующие тесты `spam.test.ts` переписываются под скоринг: те же входы,
  те же ожидаемые вердикты, но проверка через зоны, а не через бинарный матч.
- Фиче-флаг `MODERATION_V2=on|off` (env) на время калибровки.

### 4.10 Оценка эффективности
- FPR: слабые одиночные сигналы больше не наказывают → меньше ложных
  срабатываний в обычном чате.
- TPR: комбинация слабых сигналов (2 ссылки без CTA + новый аккаунт +
  нечёткий дубль) ловится там, где раньше каждый по отдельности проходил.
- Latency: fast-path (шаги 0–2) ≈ текущее; шаги 3–4 добавляют ~1–2 Redis
  round-trip.
- Файлы: `lib/moderation/index.ts`, `lib/moderation/spam.ts`,
  `lib/moderation/normalize.ts` (новый), `lib/moderation/rep.ts` (новый),
  `lib/moderation/spamDict.ts` (веса), `lib/db/types.ts` (JournalEntry.score),
  `lib/telegram/violations.ts` (журналирование скора).

---

## 5. Этап 2 — Нечёткий поиск и расстояние Левенштейна

### 5.1 Проблема
`checkDuplicateFlood` хэширует текст после `trim().toLowerCase()` и ловит
только **точные** повторы. Спамеры обходят это тривиально: опечатка,
подмена `0→о`, лишний пробел, перестановка слов.

### 5.2 Варианты реализации (сравнение)

| Вариант | Где считается | Точность | Скорость | Serverless-дружелюбность | Комментарий |
|---|---|---|---|---|---|
| A. Чистый JS (порты алгоритмов) | Node runtime | Высокая | ОК для коротких текстов | Да | `fastest-levenshtein` (чистый JS, ~C-скорость для коротких строк); `@napi-rs/levenshtein` (Rust native) |
| B. C-расширение (native addon) | Node runtime | Высокая | Максимальная | Условно | На Vercel Node.js native-модули работают, но увеличивают бандл/cold start; риск несовместимости платформы |
| C. Redis-side (Lua / модули) | Redis | Зависит | Зависит | Да для Lua | RedisGraph снят с поддержки; Lua-Левенштейн медленный на длинных строках; подходит только для коротких |
| D. PostgreSQL `pg_trgm` | PG | Хорошая (триграммы) | GIN-индекс, быстро | Да | Требует PG (Этап 5); идеален для поиска по большой истории |
| E. Сигнатуры (MinHash/Shingling) | Node + Redis | Хорошая | Очень быстро | Да | Для масштаба «1M текстов»; кандидаты через хэш-корзины |

**Рекомендация — гибрид:**
- **Горячий путь (реалтайм, в чате):** нормализация + сравнение с
  **ограниченным скользящим окном последних текстов чата** (Redis List,
  cap ~200 элементов или TTL 10 мин) через нормализованное расстояние
  Левенштейна с полосой (banded) / отношение подобия. Окно ограничено,
  поэтому сравнений немного — чистый JS достаточно, C-расширение не нужно.
- **Холодный путь (поиск по истории, аналитика):** PostgreSQL `pg_trgm`
  с GIN-индексом (после Этапа 5).

### 5.3 Дизайн горячего пути

```
key: dup:window:{chatId}          — Redis List (RPUSH сбоку, LTRIM до 200)
key: dup:flood:{chatId}           — Redis Hash счётчиков «эталонов» (опционально)
```

Алгоритм на каждое сообщение:
1. `norm = normalizeMessageText(text)`; если `len(norm) < 12` — пропустить
   (короткие тексты дают слишком много ложных дублей).
2. Взять `recent = LRANGE(key, 0, -1)` (≤ 200 строк, обычно 5–50).
3. Для каждого `candidate` посчитать `similarity = 1 - levenshtein(norm, candidate) / max(len)`.
   Ускорители:
   - предфильтр по длине (`|lenA - lenB| / max > 0.3` → пропустить);
   - полоса (banded) DP: если расстояние превышает порог — ранний выход;
   - для текстов ≥ 80 символов — сначала сравнение шинглов (триграммная
     Jaccard), Левенштейн только для кандидатов с Jaccard ≥ 0.6.
4. Если `similarity ≥ 0.85` — сигнал «нечёткий дубль» (вес 40 из §4.4),
   `similarity ≥ 0.97` — «точный дубль» (вес 60).
5. Добавить текущий текст в окно: `RPUSH` + `LTRIM` + `EXPIRE`.

### 5.4 Нечёткий поиск по доменам (typosquatting)
К доменам из `DOMAIN_BLACKLIST` добавить проверку на похожесть
(Левенштейн ≤ 1–2) — ловить `bitlly.com`, `telegrаm.io` (с подменой
кириллицы после нормализации). Список короткий → проверка дешёвая.

### 5.5 Кеш custom-регекса (решает P9)
`buildCustomWordsRegex` сейчас пересобирается на каждое сообщение. Вводим
кеш на группу:

```
key: customwords:regex:{chatId}     — строка (собранный regex) 
инвалидация: версия (INCR при add/remove/preset) либо TTL 5 мин
```

Либо проще: держать `Map` на уровне инстанса с TTL 30 с + версия из Redis.
Внимание: для serverless несколько инстансов — кеш в памяти не консистентен,
поэтому версия в Redis обязательна, а в памяти — только «мягкий» слой.

### 5.6 C-расширения и «jellyfish» — что реально использовать
- `jellyfish` — это Python-библиотека; в JS-проекте её аналог —
  `fuzzball.js` (token set/partial ratio), `fastest-levenshtein`,
  `@napi-rs/levenshtein` (Rust, нативные пребилды).
- **Рекомендация:** начать с `fastest-levenshtein` (чистый JS, без нативных
  бинарей — безопасно для Vercel и cold start). Если профилирование покажет,
  что Левенштейн — бутылочное горлышко горячего пути, заменить на
  `@napi-rs/levenshtein` (Rust NAPI, prebuilt) или перенести нечёткий поиск
  целиком в `pg_trgm` (Этап 5). Нативные модули — последний шаг, не первый.
- Для массового сравнения текстов (не коротких пар) Левенштейн не подходит —
  использовать шинглы/триграммы + LSH, а в PG — `pg_trgm`.

### 5.7 Оценка эффективности
- TPR на копипаст-рейдах: с ~0% (точный хэш) до ≥70% (нечёткий).
- Latency: +0–2 Redis round-trip; сравнение в окне ≤ 200 строк —
  субмиллисекундно на коротких текстах.
- Файлы: `lib/moderation/normalize.ts`, `lib/moderation/fuzzy.ts` (новый),
  `lib/moderation/flood.ts` (переписать `checkDuplicateFlood`),
  `lib/moderation/spam.ts` (typosquatting), `lib/moderation/profanity.ts`
  (кеш regex), `lib/moderation/fuzzy.test.ts` (новый).

---

## 6. Этап 3 — Граф связей пользователей

### 6.1 Зачем
Классическая контентная модерация не видит **сети**: 50 аккаунтов, которые
вступают в одни и те же 20 групп, шлют одинаковые сигнатуры, упоминают друг
друга, имеют общих админов. Граф позволяет:
1. **Обнаружение спам-сетей** — кластеры аккаунтов по общим группам/сигнатурам.
2. **Проактивная защита** — новый аккаунт, входящий в «кластер», помечается
   до первого сообщения.
3. **Усиление федерации** — баны распространяются не только по общим админам,
   но и по графовой близости.
4. **Аналитика для Mini App** — «подозрительные кластеры» в группе.

### 6.2 Типы рёбер

| Тип ребра | Как фиксируется | Источник |
|---|---|---|
| `shared_group` | A и B были участниками одной группы (события join/leave) | `chat_member` |
| `co_admin` | A и B — админы одной группы | уже есть в `admins.ts` |
| `mentioned` | A упомянул B (@mention / text_mention) | entities сообщений |
| `same_signature` | A и B отправляли нечётко-похожие тексты (сигнатура из §5) | пайплайн модерации |
| `forwarded_from` | Сообщения A и B имеют один `forward_origin` | сообщения |
| `joined_same_burst` | A и B вошли в один рейд-бёрст (checkRaid) | `chat_member` |

### 6.3 Варианты хранения — анализ

| Вариант | Плюсы | Минусы | Вердикт |
|---|---|---|---|
| **RAM / in-memory** | Максимальная скорость | Serverless: память не переживает вызов; невозможно | ❌ |
| **Redis Sets (adjacency)** | Просто, атомарно, TTL, дёшево; в Upstash доступно | Нет multi-hop-запросов «из коробки» (делать итеративно в Lua/приложении); in-memory — дорого для 1M+ рёбер | ✅ MVP (hot-слой) |
| **Redis Graph** | Были бы хороши | **Снят с поддержки Redis Labs (2024)**, в Upstash нет | ❌ |
| **PostgreSQL (edge-таблица)** | Реляционно, индексируемо, масштабируется до 1M+ | Запросы многошаговых путей — медленнее графовой БД | ✅ Cold-слой (1M+) |
| **Neo4j / Memgraph** | Настоящие графовые запросы: пути, community detection | Отдельный сервис, стоимость, эксплуатация; для текущего масштаба избыточно | 🔜 Когда потребуются multi-hop-аналитики (Этап 3.6) |

**Рекомендация:** гибрид «Redis hot + PostgreSQL cold + (позже) Neo4j/Memgraph
для аналитики».

### 6.4 Схема в Redis (hot-слой, TTL 30–90 дней)

```
key: graph:user:{userId}:edges     — ZSET: member=otherUserId, score=вес
key: graph:user:{userId}:meta      — HASH: firstSeen, lastSeen, clusterId?
key: graph:burst:{chatId}:{ts}     — SET: пользователи рейд-бёрста (для joined_same_burst)
key: sig:{signatureId}:users       — SET: пользователи, славившие этот текст-сигнатуру
```

Операции:
```ts
// ребро A<->B с весом (увеличить или создать)
await redis.zincrby(`graph:user:${a}:edges`, 1, b);
await redis.zincrby(`graph:user:${b}:edges`, 1, a);
await redis.expire(`graph:user:${a}:edges`, EDGE_TTL);
```

Поиск общих групп (уже есть инфраструктура админ-индексов): для подозреваемого
userId получить `user:{id}:adminGroups` **и** (новое) `user:{id}:joinedGroups`
(множество групп, где видели участником) — пересечение с группами «жертвы».

### 6.5 Алгоритмы на графе (MVP)
1. **Кандидаты на мультиакк:** для пары пользователей в одном чате
   `card(intersection(edges(a), edges(b)))` — если ≥ 3 общих «сильных» рёбер
   (`mentioned`, `same_signature`) → пометить в `suspect:{chatId}` с весом.
2. **Рейд-кластер:** все участники одного `burst` + общие `forwarded_from` +
   `same_signature` → кластер; при следующем join в этот чат — сверка
   по сигнатурам с кластерами (Trie/LSH в Redis).
3. **Федерация 2.0:** при бане в чате A распространять бан не только на
   группы общих админов, но и на группы, где «графово близкие» аккаунты
   являются админами/участниками (с порогом веса).

### 6.6 Когда переходить на Neo4j/Memgraph
- объём рёбер > ~5M и требуются запросы «путь между любыми двумя узлами»
  / community detection по всей базе;
- появятся аналитические дашборды, требующие графовых агрегаций.
До этого — PostgreSQL `user_edges` + Redis hot.

### 6.7 Оценка эффективности
- Новый класс защиты (сети мультиакков) — конкурентное преимущество в нише.
- Стоимость: самый дорогой этап по объёму изменений; MVP (сбор рёбер +
  suspect-кластеры) — 1–2 недели, аналитика — дальше.
- Файлы: `lib/db/graph.ts` (новый), `lib/telegram/graphEvents.ts` (новый,
  обработка `chat_member`/сообщений для сбора рёбер), интеграция в
  `lib/telegram/federation.ts`, `lib/moderation/index.ts`.

---

## 7. Этап 4 — Оптимальная схема кеширования в Redis

### 7.1 Принципы
1. **Двухуровневость:** Redis = горячий кеш (TTL), PostgreSQL = истина
   (после Этапа 5). До Этапа 5 — Redis остаётся источником, но с TTL-политикой.
2. **Cache-aside + single-flight** для всех обращений к Telegram API
   (memberCount, CAS, adminCheck) — чтобы «стадо» параллельных вызовов
   не дублировало внешние запросы.
3. **Write-through для настроек** (уже так: PATCH пишет напрямую) — не
   нужна инвалидация, просто TTL для read-heavy путей.
4. **Все ключи — с TTL, если иначе не задумано** (исключения документировать).

### 7.2 Карта ключей (актуальная + целевая)

| Ключ | Тип | TTL | Назначение | Комментарий |
|---|---|---|---|---|
| `group:{chatId}:settings` | Hash/string | ∞ (источник) | настройки | до Этапа 5 |
| `group:{chatId}:whitelist` | Set | ∞ | whitelist | до Этапа 5 |
| `group:{chatId}:customwords` | Set | ∞ | свои слова | до Этапа 5 |
| `group:{chatId}:stats:{date}` | Hash | 90d | статистика | после Этапа 5 — только hot-агрегаты |
| `group:{chatId}:activity:{date}` | Hash | 90d | активность | там же |
| `group:{chatId}:journal:*` | Hash+ZSet | — (trim 300) | журнал | после Этапа 5 — переезд в PG, Redis = недавние |
| `warns:{chatId}:{userId}` | ZSet | ttl warn | варны | горячее, остаётся в Redis |
| `rep:user:{chatId}:{userId}` | Hash | 30d | репутация (новое) | §4.5 |
| `dup:window:{chatId}` | List | 10 min | окно дублей | §5.3 |
| `flood:user:{chatId}:{userId}` | Int | 10s | флуд | остаётся |
| `flood:dup:{chatId}:{hash}` | Int | 300s | точные дубли | заменяется на окно (§5) |
| `raid:{chatId}` | Int | 30s | рейд | остаётся |
| `cas:{userId}` | Bool | 1h/24h | CAS-кеш | + single-flight |
| `group:{chatId}:membercount` | Int | 1h | размер группы | + single-flight |
| `graph:user:{id}:edges` | ZSet | 30–90d | граф (новое) | §6 |
| `user:{id}:joinedGroups` | Set | 90d | группы участия (новое) | для графа |
| `customwords:regex:{chatId}:v` | Int+str | ∞ (версия) | кеш regex | §5.5 |
| `suspect:{chatId}` | Set | 30d | подозрительные (новое) | §6.5 |

### 7.3 Single-flight (анти-стампед) — паттерн
```
Ключ-лок: lock:{resource}:{id}   (SET NX EX 5)
Если лок занят — подождать/взять прошлый кеш (stale-while-revalidate)
```

Применить к: `getCachedMemberCount`, `isCasBanned`, `getBotPermissions`
(кеш прав бота на чат на 1–5 мин с инвалидацией по `my_chat_member`).

### 7.4 Чего избегать
- **Крупных значений в одном ключе** (журнал на группу целиком) — уже
  решено разбиением; сохранять.
- **Hot key на 1M+**: не складывать «все группы бота» в один ключ —
  `bot:groups` (Set) остаётся, но любые агрегации по нему — через
  `SCAN`, не `SMEMBERS` целиком на больших объёмах.
- **Неограниченных списков без TTL/trim** — окно дублей и граф обязаны
  иметь cap/TTL.

### 7.5 Оценка эффективности
- −80% запросов к Telegram API (memberCount/CAS/adminCheck кешируются).
- Меньше «стадных» гонок → стабильнее латенция.
- Файлы: `lib/db/memberCount.ts`, `lib/moderation/cas.ts`,
  `lib/telegram/adminCheck.ts`, `lib/db/redis.ts` (helper `singleFlight`,
  `withTimeout`), `lib/db/graph.ts`.

---

## 8. Этап 5 — Структуры таблиц БД на ~1 млн записей (PostgreSQL)

### 8.1 Зачем
Redis — in-memory: для 1M журналов/нарушений/рёбер цена памяти неприемлема,
и нет SQL-аналитики. Вводим PostgreSQL (Neon/Supabase — serverless-совместимо)
как **источник истины для холодных данных**, Redis остаётся горячим слоем.

### 8.2 Схема таблиц

```sql
-- Группы и настройки
CREATE TABLE groups (
  chat_id           BIGINT PRIMARY KEY,
  title             TEXT NOT NULL,
  lang              TEXT NOT NULL DEFAULT 'ru',
  plan              TEXT NOT NULL DEFAULT 'free',        -- free | pro
  plan_expires_at   TIMESTAMPTZ,
  settings          JSONB NOT NULL DEFAULT '{}',          -- остальные тумблеры
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Админы (обратный индекс — уходит из Redis для холодной части)
CREATE TABLE group_admins (
  chat_id   BIGINT NOT NULL REFERENCES groups(chat_id) ON DELETE CASCADE,
  user_id   BIGINT NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);
CREATE INDEX idx_group_admins_user ON group_admins(user_id);

-- Пользователи (справочник для графа и репутации)
CREATE TABLE users (
  user_id     BIGINT PRIMARY KEY,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  flags       TEXT[] NOT NULL DEFAULT '{}'   -- 'suspect', 'network', ...
);

-- Нарушения (журнал) — самая быстрорастущая таблица
CREATE TABLE violations (
  id          BIGSERIAL PRIMARY KEY,
  chat_id     BIGINT NOT NULL,
  user_id     BIGINT NOT NULL,
  message_id  BIGINT,
  category    TEXT NOT NULL,               -- profanity | spam | premium
  action      TEXT NOT NULL,               -- delete | warn | mute | ban
  score       INT NOT NULL DEFAULT 0,      -- из скоринга (§4)
  signals     JSONB NOT NULL DEFAULT '[]', -- доказательства (§4.8)
  reason      TEXT NOT NULL DEFAULT '',
  escalated   BOOLEAN NOT NULL DEFAULT false,
  restored    BOOLEAN NOT NULL DEFAULT false,
  text        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);
-- партиции по месяцам: violations_2026_07 ... (автосоздание по cron/демону)
CREATE INDEX idx_violations_chat_time ON violations(chat_id, created_at DESC);
CREATE INDEX idx_violations_user_time ON violations(user_id, created_at DESC);
CREATE INDEX idx_violations_sig_gin   ON violations USING GIN (signals);

-- Дневная статистика (агрегаты)
CREATE TABLE daily_stats (
  chat_id    BIGINT NOT NULL,
  date       DATE NOT NULL,
  messages   BIGINT NOT NULL DEFAULT 0,
  joins      BIGINT NOT NULL DEFAULT 0,
  total      BIGINT NOT NULL DEFAULT 0,
  profanity  BIGINT NOT NULL DEFAULT 0,
  spam       BIGINT NOT NULL DEFAULT 0,
  premium    BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, date)
);

-- Варны (холодная история; горячее состояние остаётся в Redis ZSet)
CREATE TABLE warns (
  chat_id    BIGINT NOT NULL,
  user_id    BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_warns_user ON warns(user_id, chat_id, created_at);

-- Свои слова
CREATE TABLE custom_words (
  chat_id BIGINT NOT NULL REFERENCES groups(chat_id) ON DELETE CASCADE,
  word    TEXT NOT NULL,
  PRIMARY KEY (chat_id, word)
);

-- Whitelist
CREATE TABLE whitelist (
  chat_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);

-- CAS-кеш (холодный слой, Redis остаётся горячим)
CREATE TABLE cas_cache (
  user_id    BIGINT PRIMARY KEY,
  banned     BOOLEAN NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Граф связей (холодный слой)
CREATE TABLE user_edges (
  user_a    BIGINT NOT NULL,
  user_b    BIGINT NOT NULL,
  edge_type TEXT NOT NULL,          -- shared_group | co_admin | mentioned | same_signature | forwarded_from | joined_same_burst
  weight    INT  NOT NULL DEFAULT 1,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a, user_b, edge_type),
  CHECK (user_a < user_b)           -- канонический порядок, без дублей
);
CREATE INDEX idx_user_edges_b ON user_edges(user_b, edge_type);
CREATE INDEX idx_user_edges_type ON user_edges(edge_type, weight DESC);

-- Платежи
CREATE TABLE payments (
  id          BIGSERIAL PRIMARY KEY,
  chat_id     BIGINT NOT NULL,
  user_id     BIGINT,
  payload     TEXT NOT NULL,
  amount      BIGINT NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'XTR',
  status      TEXT NOT NULL DEFAULT 'paid',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 8.3 Масштабирование и retention
- **Партиционирование** `violations` по месяцам (1M записей ≈ 1–2 месяца при
  активной нагрузке) — обрезка/архивация партиций, а не `DELETE`.
- **Индексы** под горячие запросы Mini App: `(chat_id, created_at DESC)`,
  `(user_id, created_at DESC)`; GIN по `signals` для поиска по категориям.
- **Retention-политика:** сырые тексты нарушений — 90 дней, агрегаты —
  навсегда; тёмные копии текстов — по юридическим соображениям (согласовать).
- **Агрегация на запись:** дневные счётчики пишутся одним UPSERT
  (`INSERT ... ON CONFLICT DO UPDATE`), а не пересчитываются из violations.

### 8.4 Миграция (без даунтайма)
1. **Dual-write**: новые записи пишутся и в Redis, и в PG
   (violations, daily_stats, warns, group_admins).
2. **Backfill**: исторические данные переносятся батчами (SCAN по Redis).
3. **Cutover**: чтение — из PG (cold) + Redis (hot); Redis-источники настроек
   остаются до перевода settings в PG (Этап 5.5 — отдельно).
4. **Verification**: сверка счётчиков PG vs Redis (daily reconciliation).

### 8.5 Оценка эффективности
- 1M+ записей — без проблем по цене и памяти.
- Аналитика: SQL-агрегации вместо перебора Redis-ключей.
- Стоимость: самый объёмный этап; разбивается на подэтапы (сначала
  violations+stats, потом граф, потом settings).
- Файлы: `lib/db/*` (новые PG-репозитории), `scripts/migrate-*`,
  `lib/db/pg.ts` (пул), конфиг env `DATABASE_URL`.

---

## 9. Этап 6 — Race Conditions при параллельных запросах

### 9.1 Инвентаризация

**Уже решённые (сохранить как образцы):**

| Гонка | Решение | Файл |
|---|---|---|
| TOCTOU в квоте Groq (GET→INCR) | `INCRBY` сначала, проверка результата, `DECRBY` при отказе | `groq.ts` |
| Двойная эскалация варнов при параллельных нарушениях | Lua-скрипт (prune+add+expire+count атомарно) | `warns.ts` |
| Overshoot лимита custom-слов при батче | Lua-скрипт (SCARD→SADD цикл атомарно) | `customWords.ts` |
| Сдвиг индексов журнала при параллельном LPUSH | Hash по id + ZSet порядка | `journal.ts` |
| Каскады antiraid/warnLimit | Чистая логика + тесты | `groups.ts` |

**Оставшиеся (цель Этапа 6):**

| # | Гонка | Сценарий | Решение |
|---|---|---|---|
| G1 | `updateGroupSettings` read-modify-write | Два параллельных PATCH (два тумблера) или PATCH + `successful_payment` — последний писатель затирает чужие поля | Атомарный патч: Lua-скрипт `HSET`/`JSON.SET` по полям + optimistic версия, либо перейти на точечные поля (см. 9.2) |
| G2 | `consumeNewMemberFlag` GET→DEL | Два параллельных сообщения от новичка — оба читают флаг до удаления | Lua: `if EXISTS then DEL return 1 else return 0` |
| G3 | Cache stampede `memberCount` | N параллельных миссов одновременно зовут `getChatMemberCount` | single-flight лок `SET NX EX` (§7.3) |
| G4 | Cache stampede `cas` | То же для CAS | single-flight |
| G5 | `INCR`→`EXPIRE` без атомарности (флуд/рейд/статистика/Groq-счётчики) | Падение между вызовами → ключ без TTL | Lua-скрипт `incr_with_ttl` (общий helper) |
| G6 | Двойной старт капчи/рейда из-за дублей вебхука | Telegram иногда шлёт дубликаты update | Дедупликация по `update_id` (Redis SETNX с TTL) |
| G7 | `pollForProActivation` гонка с вебхуком | Уже решена polling+backoff; усилить: сверять `planExpiresAt` из ответа сервера, а не только `isProActive` | точечно |

### 9.2 Решение G1 — атомарный патч настроек
Вариант A (рекомендуемый): перейти на **полевую запись** — каждое поле
хранится отдельным Redis-ключом или в Hash по одному полю, патч пишет только
свои поля через `HSET` (атомарно по полю). Плюс optimistic-lock:

```
WATCH group:{id}:settings_version
  HGETALL current
  ... применяем патч к полям ...
  MULTI / EXEC (или Lua)
```

Проще и практичнее: **Lua-скрипт `apply_patch`**, который:
- читает текущие поля,
- применяет каскады (`applyAntiraidCascade`, `applyWarnLimitCascade`),
- пишет только переданные поля,
- инкрементит `version`,
- возвращает обновлённые настройки + версию.

Mini App при PATCH шлёт `if-match: {version}`; несовпадение → 409 → клиент
перечитывает и повторяет. Это убирает «потерянные апдейты».

### 9.3 Решение G6 — дедупликация update
```
key: upd:dedup:{updateId}  — SET NX EX 60
```
Если не удалось захватить — update уже обработан (или обрабатывается),
пропускаем. Аккуратно с ретраями: обрабатывать только уникальные id.

### 9.4 Оценка эффективности
- Пропадают «потерянные» изменения настроек и двойные наказания.
- G3/G4 снижают латенцию при пиковых параллельных запросах.
- Файлы: `lib/db/groups.ts` (Lua-патч), `lib/moderation/flood.ts` (Lua flag),
  `lib/db/redis.ts` (helper `incrWithTtl`, `singleFlight`, `acquireLock`),
  `app/api/miniapp/groups/[groupId]/route.ts` (if-match/409),
  `contexts/GroupProvider.tsx` (retry при 409).

---

## 10. Этап 7 — Интеграция в Mini App и пользовательские сценарии

### 10.1 Что показать пользователю
1. **Журнал нарушений** — карточка с «почему сработало»: score, список
   сигналов с весами (из §4.8).
2. **Экран «Подозрительные аккаунты»** — кластеры из §6.5 для его группы:
   список аккаунтов, общие группы/сигнатуры, кнопка «забанить кластер».
3. **Статистика нечётких дублей** — сколько раз сработал анти-копипаст.
4. **Настройки скоринга** — пороги зон (продвинутые админы), тумблер
   «нечёткий поиск дублей» (on/off).

### 10.2 Новые API
```
GET  /api/miniapp/groups/{id}/verdicts?limit=50        — журнал с score/signals
GET  /api/miniapp/groups/{id}/suspects                 — кластеры подозреваемых
POST /api/miniapp/groups/{id}/suspects/ban             — баны по кластеру
PATCH /api/miniapp/groups/{id} (if-match)              — оптимистичный конк. контроль
```

### 10.3 Оценка эффективности
- Прозрачность → доверие админов, меньше жалоб на «ложные баны».
- «Кластер-бан» — уникальная фича для продажи PRO.

---

## 11. Порядок внедрения и связность этапов

### 11.1 Зависимости
```
Этап 0 (аудит async)        — независим, делается первым
Этап 1 (скоринг)            — требует normalize (§4.3); до Этапа 2 не обязателен,
                              но желателен (дубли становятся сигналом скоринга)
Этап 2 (нечёткий поиск)     — требует normalize; горячий путь независим от PG
Этап 3 (граф)               — MVP возможен сразу; «холодный» слой — после Этапа 5
Этап 4 (кеш/single-flight)  — независим, можно параллелить с 1–2
Этап 5 (PostgreSQL)         — самый крупный; нарушение зависимостей нет,
                              но граф-холод и аналитика — после него
Этап 6 (гонки)              — частично параллелен (G2/G3/G5 — сразу),
                              G1 желательно до Этапа 5 (тогда патч пишем в PG)
Этап 7 (Mini App)           — после 1–3,6
```

### 11.2 Порядок релизов (по неделям)

| Неделя | Релиз | Содержание |
|---|---|---|
| 1 | 0.1 | Аудит async, helper-ы, кеш regex, TTL-хелперы |
| 2 | 1.0 | normalize + скоринг (фиче-флаг), журнал score |
| 3–4 | 1.1 | Нечёткий поиск дублей, typosquatting, кеш CAS/memberCount |
| 5–6 | 2.0 | Гонки G1–G6, дедупликация update |
| 7–9 | 3.0 | Граф MVP (сбор рёбер, suspect-кластеры, федерация 2.0) |
| 10–14 | 4.0 | PostgreSQL: violations+stats dual-write → backfill → cutover |
| 15–16 | 4.1 | Настройки/варны/граф в PG, retention, партиции |
| 17–18 | 5.0 | Mini App: журнал скоринга, подозрительные кластеры |
| ≥19 | 6.0 | Neo4j/Memgraph (только если граф-аналитика востребована) |

---

## 12. Риски и открытые вопросы

### 12.1 Риски

| Риск | Митигация |
|---|---|
| Скоринг может повысить FPR на границе порогов | Калибровка на реальных данных (журнал score), A/B, консервативные веса на старте |
| Нативные C/Rust-модули ломают деплой на Vercel | Не использовать на старте; `fastest-levenshtein` (чистый JS); native — только после профилирования |
| RedisGraph недоступен | Не планировать; Sets-adjacency + PG + (при необходимости) Neo4j/Memgraph |
| PostgreSQL повышает сложность эксплуатации | Serverless-провайдеры (Neon/Supabase), управляемые миграции, dual-write фаза |
| Граф может привести к ложным «кластерам» | Порог веса/конфиденс; действия по кластеру — только по подтверждению админом |
| Дедупликация update_id может пропустить легитимный update при сбое | TTL 60 c + отдельный `SET NX` с обработкой ошибок; ретраи обрабатываются повторно после истечения TTL |

### 12.2 Открытые вопросы (нужно решение владельца)
1. Юридические: хранить ли тексты нарушений дольше 90 дней?
2. Бизнес: делать ли «кластер-бан» PRO-фичей?
3. Инфраструктура: какой PG-провайдер (Neon vs Supabase vs Vercel Postgres)?
4. Масштаб: ожидаемый реальный трафик для оценки бюджета Redis/PG?
5. Нужен ли экспорт данных (CSV/API) для админов?

---

## 13. Приложение А — Словарь терминов
- **TPR / FPR** — доля верно пойманных нарушений / доля ложных срабатываний.
- **Скоринг** — взвешенная сумма сигналов с порогами зон.
- **Single-flight** — паттерн, при котором параллельные запросы к одному
  ресурсу объединяются в один (через lock).
- **Cache stampede** — «стадо» одновременных промахов кеша, дублирующих
  дорогой запрос.
- **LSH / MinHash** — locality-sensitive hashing для быстрого поиска похожих
  строк без попарного сравнения.
- **pg_trgm** — расширение PostgreSQL для поиска по триграммам (GIN).
- **Adjacency (списки смежности)** — представление графа как списков соседей.

## 14. Приложение Б — Файлы проекта (карта изменений)

| Файл | Этап | Изменение |
|---|---|---|
| `lib/moderation/normalize.ts` | 1,2 | новый: нормализация текста |
| `lib/moderation/index.ts` | 1,2,3,6 | конвейер скоринга, сигнал дублей, репутация |
| `lib/moderation/spam.ts` | 1 | веса вместо бинарных флагов, typosquatting |
| `lib/moderation/flood.ts` | 2,6 | окно дублей (fuzzy), Lua-флаг первого сообщения, incr+ttl |
| `lib/moderation/groq.ts` | 0,1 | clearTimeout/finally, сигнал в скоринг |
| `lib/moderation/cas.ts` | 0,4 | таймаут-хелпер, single-flight |
| `lib/moderation/profanity.ts` | 1,2 | normalize, кеш custom-регекса |
| `lib/moderation/fuzzy.ts` | 2 | новый: levenshtein/шинглы/окно дублей |
| `lib/moderation/rep.ts` | 1 | новый: репутация пользователя |
| `lib/db/graph.ts` | 3 | новый: рёбра, кластеры |
| `lib/telegram/graphEvents.ts` | 3 | новый: сбор рёбер из update'ов |
| `lib/telegram/federation.ts` | 0,3 | allSettled, графовая федерация |
| `lib/db/redis.ts` | 0,4,6 | helper-ы: withTimeout, singleFlight, incrWithTtl, acquireLock |
| `lib/db/groups.ts` | 6 | Lua-патч настроек + версия |
| `lib/db/memberCount.ts` | 4 | single-flight |
| `lib/db/stats.ts` | 6 | incr+ttl атомарно; dual-write в PG |
| `lib/db/pg.ts`, `lib/db/pg/*.ts` | 5 | новый: PG-пул и репозитории |
| `scripts/migrate-*` | 5 | backfill |
| `app/api/miniapp/groups/[groupId]/route.ts` | 6 | if-match/409 |
| `contexts/GroupProvider.tsx` | 0,6 | отмена poll, retry 409 |
| `app/.../journal/...` (Mini App) | 7 | журнал со скорингом, suspects |
| `package.json` | 2 | `fastest-levenshtein` (или `@napi-rs/levenshtein`) |
