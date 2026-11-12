# Air Raid Alert — Universal Worker

Cloudflare Worker that polls [alerts.in.ua](https://alerts.in.ua), keeps a snapshot of active alerts, sends Telegram notifications to subscribed users when their region's status changes, and serves the current status to client plugins (exteraGram).

**Languages:** [English](#english) · [Русский](#русский) · [Українська](#українська)

---

## English

### What it does
- Polls the alerts API every few seconds (Durable Object alarm loop) and stores a snapshot in D1. The minute cron only restarts that loop, so a new alert reaches Telegram in ~15 seconds instead of up to a minute.
- Notifies Telegram users when their oblast or district changes state (red / yellow / clear).
- Lets plugins register a location, toggle notifications, and read the current status through a public `/api` endpoint.
- Serves a password-protected owner dashboard at `/admin`.

### Requirements
- A Cloudflare account (free plan is enough).
- A Telegram bot token from [@BotFather](https://t.me/BotFather).
- An API key for alerts.in.ua.

No local tools are needed. Everything is configured in the Cloudflare dashboard, and the code runs on Cloudflare's runtime.

### Setup (Cloudflare dashboard only)
1. **Create the storage.**
   - Storage & Databases → D1 SQL Database → *Create database*, name it `air-raid-cache`.
2. **Create the tables.** Open the D1 database → *Console* and run the SQL from [Schema (SQL)](#schema-sql) (creates `users`, `cache_kv`, `notified_events`, `device_links`). This is a one-time step — Cloudflare keeps the tables after this.
3. **Create the Worker.** Workers & Pages → *Create* → *Worker* → give it a name → *Edit code*, replace the default code with the contents of `worker.js`, then *Deploy*.
4. **Add bindings.** Open the Worker → *Settings* → *Bindings* → *Add*:
   - D1 database: variable name `DB`, database `air-raid-cache`.
5. **Add secrets.** Worker → *Settings* → *Variables and Secrets* → add as **Secret** type:
   - `BOT_TOKEN` — your Telegram bot token.
   - `ALERTS_API_KEY` — your alerts.in.ua key.
   - `ADMIN_TOKEN` — the dashboard password. Without it the dashboard is disabled.
   - `WEBHOOK_SECRET` — *optional.* Used to authenticate Telegram webhook calls. If omitted, the Worker generates one on first use and stores it in D1 (`cache_kv`). If you set it **after** the webhook was already registered, press *Setup webhook* again so Telegram starts sending the matching `secret_token`.
6. **Add the cron trigger.** Worker → *Settings* → *Triggers* → *Cron Triggers* → add `* * * * *`.
7. **Register the Telegram webhook.** Open `https://<your-worker>/admin`, log in with `ADMIN_TOKEN`, and run the *Setup webhook* action. (Or open `https://<your-worker>/setup-webhook` after logging in.)

> **Optional: deploy from a Git repository.** The repo includes `wrangler.toml`, which describes the bindings, cron trigger and variables. If you connect the repo to Workers Builds, Cloudflare reads this file on each push, so make sure the `database_id` in `wrangler.toml` matches your D1 database. You do not need Node.js on your machine for this either.

### Troubleshooting: new users are not saved and the plugin cannot connect
The plugin's "connect" flow needs Telegram `/start <device_id>` to reach the Worker and write a row into `device_links`. If that step is broken, `/register` for a brand-new chat returns `403 missing device link`, and nothing is written to `users` (existing users keep working, because they already have a `chat_id` + `sync_token`).

Check, in order:
1. `GET /health` — `db.ok` must be `true` and `db.missing` empty. If `device_links`/`notified_events` are listed, open `/admin` → *Инициализировать D1* (runs the same DDL from the Worker) or run the SQL from [Schema (SQL)](#schema-sql).
2. `GET /webhook-info` (admin) — the URL must be `https://<your-worker>/telegram/webhook`, `pending_update_count` should not grow, and `last_error_message` must be empty. A `401 Unauthorized` there means the webhook was registered without the `secret_token` the Worker expects: open `/admin` → *Setup webhook*.
3. Worker logs — `[device] write error`, `[user] write error` or `database_unavailable`/`database_write_failed` responses point to a missing table or missing `users` column.
4. The Worker now self-heals a mismatched webhook: on the first Telegram update rejected for a bad secret it re-registers the webhook with the correct secret and returns 401 so Telegram retries.

### Bindings
| Binding | Type | Purpose |
|---|---|---|
| `DB` | D1 | Everything the Worker stores: user records, device-link tokens, alert snapshot cache, cron status |
| `TICKER` | Durable Object | Near-real-time poller: an alarm re-runs every `TICK_MS` (15 s by default) and pushes changes to Telegram |

The `TICKER` alarm is started automatically by the cron trigger (every minute it only makes sure the loop is alive). No extra setup is needed. If the binding is missing, the Worker falls back to a plain once-a-minute cron check.

**Upstream limits.** alerts.in.ua documents a soft limit of 8–10 requests/minute per IP and a hard limit of 12/minute (systematic violations can block the IP and the token). The default is 4 requests/minute (15 s), and the ticker has its own sliding-window cap of 6/minute. Note that the limit is **per source IP**, and Cloudflare Workers share egress IPs with other Cloudflare services, so an occasional 429 is possible even at a low rate; on 429 the ticker backs off for 2 minutes (or `Retry-After`). To trade latency for headroom, set the `TICK_MS` variable in the dashboard (5000–60000 ms) — no redeploy needed. 15 s ≈ 5.8k requests/day; 20 s ≈ 4.3k; 30 s ≈ 2.9k.

All persistent storage lives in this single D1 database. There is no KV namespace — an earlier version used KV for user records, but the project has fully migrated to D1.

### What's stored and where
The `users` table in D1 is the only place per-user ("account") data lives. For each Telegram chat that registers, it holds:
- the Telegram `chat_id`;
- the selected oblast/district keys and the resolved region name;
- language, notification on/off, and whether the chat is Telegram-connected;
- a `sync_token` used to authenticate requests from the plugin;
- timestamps: `registered_at`, `last_activity`, `last_check`;
- the user's last known alert state for their region (`last_alert_state`, `last_alert_active`, `last_alert_start`, `last_alert_end`);
- a `raw` column that duplicates all of the above as a single JSON blob (kept for forward-compatible fields; it is not additional data beyond what's listed).

No message text, phone numbers, Telegram usernames, or precise GPS location are collected — only the chosen oblast/district and a Telegram chat ID.

Other D1 tables:
- `device_links` — a short-lived (minutes), self-expiring mapping used only to link a plugin install to a Telegram chat during the `/start` flow; rows are deleted once used or after they expire.
- `cache_kv` — not user data: the shared snapshot of the current alert status, cron health, and a maintenance flag, fetched from alerts.in.ua.
- `notified_events` — dedupe keys (not personal data) used to avoid sending the same notification twice.

The `/admin` dashboard (password-protected with `ADMIN_TOKEN`) can export the full `users` table as a SQL dump for backup/migration purposes; treat `ADMIN_TOKEN` accordingly.

For failed `/admin` login attempts, the Worker briefly keeps the requester's IP (via Cloudflare's edge cache, not D1) to rate-limit retries; this is not linked to any Telegram user or stored long-term.

The Worker does not send user data to any third party other than Telegram (to deliver notifications) and alerts.in.ua (to read the public, non-personal alert status).

### Endpoints
| Method | Path | Description |
|---|---|---|
| GET | `/` | Service name |
| GET | `/health` | Worker version, DB schema, ticker mode, `tickMs` |
| GET/POST | `/tick?key=<ADMIN_TOKEN>` | Force an immediate alert check (same as one alarm tick). Requires `ADMIN_TOKEN` or `TICK_SECRET` |
| GET | `/api` | Current alert status (cached at the edge) |
| POST | `/register` | Register or update a user's location and notification settings |
| POST | `/unregister` | Remove a user |
| GET | `/telegram/get-chat-id/{device_id}` | Poll the result of the `/start` device-link step |
| POST | `/telegram/webhook` | Telegram updates (`message`, `callback_query`) |
| POST | `/telegram/test` | Send a test message to a user |
| GET | `/webhook-info` | Telegram webhook status |
| GET | `/admin` | Owner dashboard (requires `ADMIN_TOKEN`) |

### Security notes
- The dashboard uses a password login with a signed session cookie (HMAC-SHA256, 7 days). Scripts can use `Authorization: Bearer <ADMIN_TOKEN>`.
- Failed logins are rate-limited per IP.

---

## Русский

### Что делает
- Опрашивает API alerts.in.ua каждые несколько секунд (цикл alarm в Durable Object) и сохраняет снимок активных тревог в D1. Cron раз в минуту только перезапускает этот цикл, поэтому новая тревога приходит в Telegram за ~15 секунд, а не до минуты.
- Отправляет пользователям в Telegram уведомления, когда статус их области или района меняется (красный / жёлтый / отбой).
- Позволяет плагинам регистрировать локацию, включать и выключать уведомления и получать текущий статус через публичный `/api`.
- Предоставляет панель владельца на `/admin` с паролем.

### Требования
- Аккаунт Cloudflare (бесплатного тарифа достаточно).
- Токен Telegram-бота от [@BotFather](https://t.me/BotFather).
- API-ключ alerts.in.ua.

Локальные инструменты не нужны. Всё настраивается в панели Cloudflare, код работает на среде выполнения Cloudflare.

### Установка (только панель Cloudflare)
1. **Создайте хранилище.**
   - Storage & Databases → D1 SQL Database → *Create database*, назовите `air-raid-cache`.
2. **Создайте таблицы.** Откройте базу D1 → вкладку *Console* и выполните SQL из раздела [Schema (SQL)](#schema-sql) (создаёт `users`, `cache_kv`, `notified_events`, `device_links`). Это разовое действие — Cloudflare сохранит таблицы после него.
3. **Создайте Worker.** Workers & Pages → *Create* → *Worker* → укажите имя → *Edit code*, замените код по умолчанию содержимым `worker.js`, затем *Deploy*.
4. **Добавьте биндинги.** Откройте Worker → *Settings* → *Bindings* → *Add*:
   - D1 database: имя переменной `DB`, база `air-raid-cache`.
5. **Добавьте секреты.** Worker → *Settings* → *Variables and Secrets* → добавьте с типом **Secret**:
   - `BOT_TOKEN` — токен вашего Telegram-бота.
   - `ALERTS_API_KEY` — ключ alerts.in.ua.
   - `ADMIN_TOKEN` — пароль панели. Без него панель отключена.
   - `WEBHOOK_SECRET` — *необязательно.* Секрет для проверки запросов от Telegram. Если не задан, Worker сгенерирует его сам при первом использовании и сохранит в D1 (`cache_kv`). Если задать его **после** регистрации вебхука, нажмите *Setup webhook* ещё раз, чтобы Telegram начал присылать совпадающий `secret_token`.
6. **Добавьте cron-триггер.** Worker → *Settings* → *Triggers* → *Cron Triggers* → добавьте `* * * * *`.
7. **Зарегистрируйте вебхук Telegram.** Откройте `https://<ваш-worker>/admin`, войдите с `ADMIN_TOKEN` и выполните действие *Setup webhook*. (Или откройте `https://<ваш-worker>/setup-webhook` после входа.)

> **Необязательно: деплой из Git-репозитория.** В репозитории есть `wrangler.toml`, он описывает биндинги, cron-триггер и переменные. Если подключить репозиторий к Workers Builds, Cloudflare читает этот файл при каждом пуше, поэтому убедитесь, что `database_id` в `wrangler.toml` совпадает с вашей базой D1. Для этого тоже не нужен Node.js на вашем компьютере.

### Если новые пользователи не сохраняются, а плагин не подключается
«Вход» в плагине требует, чтобы Telegram-команда `/start <device_id>` дошла до Worker и создала строку в `device_links`. Если этот шаг сломан, `/register` для нового чата возвращает `403 missing device link`, и в `users` ничего не пишется (старые пользователи продолжают работать — у них уже есть `chat_id` и `sync_token`).

Проверяйте по порядку:
1. `GET /health` — `db.ok` должен быть `true`, а `db.missing` пустым. Если там `device_links`/`notified_events`, откройте `/admin` → *Инициализировать D1* (воркер выполнит тот же DDL) или выполните SQL из раздела [Schema (SQL)](#schema-sql).
2. `GET /webhook-info` (под админом) — URL должен быть `https://<ваш-worker>/telegram/webhook`, `pending_update_count` не должен расти, а `last_error_message` должен быть пустым. `401 Unauthorized` означает, что вебхук зарегистрирован без того `secret_token`, который ждёт Worker: откройте `/admin` → *Setup webhook*.
3. Логи Worker — `[device] write error`, `[user] write error`, ответы `database_unavailable`/`database_write_failed` указывают на отсутствующую таблицу или колонку в `users`.
4. Worker теперь сам лечит рассинхрон вебхука: на первом апдейте, отклонённом из-за неверного секрета, он перерегистрирует вебхук с правильным секретом и отвечает 401, чтобы Telegram повторил доставку.

### Биндинги
| Биндинг | Тип | Назначение |
|---|---|---|
| `DB` | D1 | Всё, что хранит Worker: записи пользователей, токены привязки устройств, кэш снимка тревог, статус cron |
| `TICKER` | Durable Object | Поллер почти в реальном времени: alarm повторяется каждые `TICK_MS` (по умолчанию 15 с) и отправляет изменения в Telegram |

Цикл `TICKER` запускается автоматически cron-триггером (раз в минуту он лишь проверяет, что цикл жив). Дополнительная настройка не нужна. Если биндинга нет, Worker откатывается к обычной проверке раз в минуту.

**Лимиты alerts.in.ua.** Документированы мягкий лимит 8–10 запросов/минуту с одного IP и жёсткий — 12/минуту (при систематическом нарушении блокируются IP и токен). По умолчанию — 4 запроса/минуту (15 с), плюс собственный лимит тикера 6/минуту. Лимит считается **по IP источника**, а Cloudflare Workers делят выходные IP с другими сервисами Cloudflare, поэтому редкий 429 возможен даже на низкой частоте; при 429 тикер отступает на 2 минуты (или по `Retry-After`). Чтобы выменять скорость на запас, задайте переменную `TICK_MS` в дашборде (5000–60000 мс) — без передеплоя. 15 с ≈ 5,8 тыс. запросов/сутки; 20 с ≈ 4,3 тыс.; 30 с ≈ 2,9 тыс.

Всё постоянное хранилище — это одна база D1. Отдельного KV namespace нет: раньше записи пользователей хранились в KV, но проект полностью перешёл на D1 (см. `MIGRATION.md`).

### Что и где хранится
Таблица `users` в D1 — единственное место, где хранятся данные конкретного пользователя (аккаунта). Для каждого зарегистрированного Telegram-чата там хранится:
- `chat_id` в Telegram;
- выбранные ключи области/района и итоговое название региона;
- язык, включены ли уведомления, и подключён ли чат к Telegram;
- `sync_token` — токен для аутентификации запросов от плагина;
- временные метки: `registered_at`, `last_activity`, `last_check`;
- последний известный статус тревоги для региона пользователя (`last_alert_state`, `last_alert_active`, `last_alert_start`, `last_alert_end`);
- колонка `raw` — дублирует все перечисленные поля одним JSON-объектом (для совместимости со старым форматом; это не дополнительные данные сверх перечисленного).

Текст сообщений, номера телефонов, юзернеймы Telegram или точная GPS-локация не собираются — только выбранная область/район и chat_id в Telegram.

Остальные таблицы D1:
- `device_links` — короткоживущая (минуты), самоудаляющаяся связка для привязки установки плагина к Telegram-чату во время сценария `/start`; строки удаляются после использования или по истечении срока.
- `cache_kv` — не пользовательские данные: общий снимок текущего статуса тревог, состояние cron и флаг техработ, полученные из alerts.in.ua.
- `notified_events` — ключи дедупликации (не персональные данные), чтобы не отправлять одно и то же уведомление дважды.

Панель `/admin` (защищена паролем `ADMIN_TOKEN`) умеет экспортировать всю таблицу `users` в виде SQL-дампа для бэкапа/переноса — относитесь к `ADMIN_TOKEN` соответственно.

При неудачных попытках входа в `/admin` Worker кратковременно хранит IP-адрес запроса (в edge-кэше Cloudflare, не в D1) для ограничения частоты попыток; это не связано ни с одним Telegram-пользователем и не хранится долго.

Worker не передаёт пользовательские данные никому, кроме Telegram (для доставки уведомлений) и alerts.in.ua (для чтения публичного, обезличенного статуса тревог).

### Эндпоинты
| Метод | Путь | Описание |
|---|---|---|
| GET | `/` | Название сервиса |
| GET | `/health` | Версия воркера, схема БД, режим тикера и `tickMs` |
| GET/POST | `/tick?key=<ADMIN_TOKEN>` | Принудительная немедленная проверка (как один тик alarm). Нужен `ADMIN_TOKEN` или `TICK_SECRET` |
| GET | `/api` | Текущий статус тревог (кэшируется на edge) |
| POST | `/register` | Регистрация или обновление локации и настроек уведомлений |
| POST | `/unregister` | Удаление пользователя |
| POST | `/telegram/webhook` | Обновления Telegram (`message`, `callback_query`) |
| POST | `/telegram/test` | Отправка тестового сообщения пользователю |
| GET | `/webhook-info` | Статус вебхука Telegram |
| GET | `/admin` | Панель владельца (нужен `ADMIN_TOKEN`) |

### Безопасность
- Панель использует вход по паролю и подписанную cookie-сессию (HMAC-SHA256, 7 дней). Скрипты могут использовать `Authorization: Bearer <ADMIN_TOKEN>`.
- Неудачные входы ограничены по IP.

---

## Українська

### Що робить
- Опитує API alerts.in.ua кожні кілька секунд (цикл alarm у Durable Object) і зберігає снімок активних тривог у D1. Cron раз на хвилину лише перезапускає цей цикл, тому нова тривога надходить у Telegram за ~15 секунд, а не до хвилини.
- Надсилає користувачам у Telegram сповіщення, коли змінюється статус їхньої області або району (червоний / жовтий / відбій).
- Дозволяє плагінам реєструвати локацію, вмикати й вимикати сповіщення та отримувати поточний статус через публічний `/api`.
- Надає панель власника на `/admin` із паролем.

### Вимоги
- Акаунт Cloudflare (достатньо безкоштовного тарифу).
- Токен Telegram-бота від [@BotFather](https://t.me/BotFather).
- API-ключ alerts.in.ua.

Локальні інструменти не потрібні. Усе налаштовується в панелі Cloudflare, код працює на середовищі виконання Cloudflare.

### Встановлення (лише панель Cloudflare)
1. **Створіть сховище.**
   - Storage & Databases → D1 SQL Database → *Create database*, назвіть `air-raid-cache`.
2. **Створіть таблиці.** Відкрийте базу D1 → вкладку *Console* і виконайте SQL з розділу [Schema (SQL)](#schema-sql) (створює `users`, `cache_kv`, `notified_events`, `device_links`). Це одноразова дія — Cloudflare збереже таблиці після неї.
3. **Створіть Worker.** Workers & Pages → *Create* → *Worker* → вкажіть назву → *Edit code*, замініть код за замовчуванням вмістом `worker.js`, потім *Deploy*.
4. **Додайте біндинги.** Відкрийте Worker → *Settings* → *Bindings* → *Add*:
   - D1 database: назва змінної `DB`, база `air-raid-cache`.
5. **Додайте секрети.** Worker → *Settings* → *Variables and Secrets* → додайте з типом **Secret**:
   - `BOT_TOKEN` — токен вашого Telegram-бота.
   - `ALERTS_API_KEY` — ключ alerts.in.ua.
   - `ADMIN_TOKEN` — пароль панелі. Без нього панель вимкнена.
   - `WEBHOOK_SECRET` — *необов'язково.* Секрет для перевірки запитів від Telegram. Якщо не заданий, Worker згенерує його сам при першому використанні та збереже в D1 (`cache_kv`). Якщо задати його **після** реєстрації вебхука, натисніть *Setup webhook* ще раз, щоб Telegram почав надсилати відповідний `secret_token`.
6. **Додайте cron-тригер.** Worker → *Settings* → *Triggers* → *Cron Triggers* → додайте `* * * * *`.
7. **Зареєструйте вебхук Telegram.** Відкрийте `https://<ваш-worker>/admin`, увійдіть з `ADMIN_TOKEN` і виконайте дію *Setup webhook*. (Або відкрийте `https://<ваш-worker>/setup-webhook` після входу.)

> **Необов'язково: деплой з Git-репозиторію.** У репозиторії є `wrangler.toml`, він описує біндинги, cron-тригер і змінні. Якщо підключити репозиторій до Workers Builds, Cloudflare читатиме цей файл при кожному пуші, тому переконайтеся, що `database_id` у `wrangler.toml` збігається з вашою базою D1. Для цього також не потрібен Node.js на вашому комп'ютері.

### Якщо нові користувачі не зберігаються, а плагін не підключається
«Вхід» у плагіні вимагає, щоб команда Telegram `/start <device_id>` дійшла до Worker і створила рядок у `device_links`. Якщо цей крок зламано, `/register` для нового чату повертає `403 missing device link`, і в `users` нічого не записується (старі користувачі працюють далі — у них уже є `chat_id` і `sync_token`).

Перевіряйте по порядку:
1. `GET /health` — `db.ok` має бути `true`, а `db.missing` порожнім. Якщо там `device_links`/`notified_events`, відкрийте `/admin` → *Ініціалізувати D1* (воркер виконає той самий DDL) або виконайте SQL з розділу [Schema (SQL)](#schema-sql).
2. `GET /webhook-info` (під адміном) — URL має бути `https://<ваш-worker>/telegram/webhook`, `pending_update_count` не має зростати, а `last_error_message` — бути порожнім. `401 Unauthorized` означає, що вебхук зареєстровано без того `secret_token`, який очікує Worker: відкрийте `/admin` → *Setup webhook*.
3. Логи Worker — `[device] write error`, `[user] write error`, відповіді `database_unavailable`/`database_write_failed` вказують на відсутню таблицю або колонку в `users`.
4. Worker тепер сам лікує розсинхрон вебхука: на першому апдейті, відхиленому через неправильний секрет, він перереєструє вебхук із правильним секретом і відповідає 401, щоб Telegram повторив доставку.

### Біндинги
| Біндинг | Тип | Призначення |
|---|---|---|
| `DB` | D1 | Усе, що зберігає Worker: записи користувачів, токени прив'язки пристроїв, кеш снімка тривог, статус cron |
| `TICKER` | Durable Object | Поллер майже в реальному часі: alarm повторюється кожні `TICK_MS` (типово 15 с) і надсилає зміни в Telegram |

Цикл `TICKER` запускається автоматично cron-тригером (раз на хвилину він лише перевіряє, що цикл живий). Додаткове налаштування не потрібне. Якщо біндингу немає, Worker відкочується до звичайної перевірки раз на хвилину.

**Ліміти alerts.in.ua.** Документовано м'який ліміт 8–10 запитів/хвилину з однієї IP та жорсткий — 12/хвилину (за систематичне порушення блокуються IP і токен). Типово — 4 запити/хвилину (15 с), плюс власний ліміт тікера 6/хвилину. Ліміт рахується **за IP джерела**, а Cloudflare Workers поділяють вихідні IP з іншими сервісами Cloudflare, тому рідкісний 429 можливий навіть на низькій частоті; на 429 тікер відступає на 2 хвилини (або за `Retry-After`). Щоб обміняти швидкість на запас, задайте змінну `TICK_MS` у дашборді (5000–60000 мс) — без передеплою. 15 с ≈ 5,8 тис. запитів/добу; 20 с ≈ 4,3 тис.; 30 с ≈ 2,9 тис.

Усе постійне сховище — це одна база D1. Окремого KV namespace немає: раніше записи користувачів зберігалися в KV, але проєкт повністю перейшов на D1 (див. `MIGRATION.md`).

### Що і де зберігається
Таблиця `users` у D1 — єдине місце, де зберігаються дані конкретного користувача (акаунта). Для кожного зареєстрованого Telegram-чату там зберігається:
- `chat_id` у Telegram;
- обрані ключі області/району та підсумкова назва регіону;
- мова, чи увімкнені сповіщення, і чи підключений чат до Telegram;
- `sync_token` — токен для автентифікації запитів від плагіна;
- часові мітки: `registered_at`, `last_activity`, `last_check`;
- останній відомий статус тривоги для регіону користувача (`last_alert_state`, `last_alert_active`, `last_alert_start`, `last_alert_end`);
- колонка `raw` — дублює всі перелічені поля одним JSON-об'єктом (для сумісності зі старим форматом; це не додаткові дані понад перелічене).

Текст повідомлень, номери телефонів, юзернейми Telegram або точна GPS-локація не збираються — лише обрана область/район і chat_id у Telegram.

Інші таблиці D1:
- `device_links` — короткоживуча (хвилини), самовидаляюча зв'язка для прив'язки встановлення плагіна до Telegram-чату під час сценарію `/start`; рядки видаляються після використання або після завершення терміну.
- `cache_kv` — не користувацькі дані: загальний знімок поточного статусу тривог, стан cron і прапорець техробіт, отримані з alerts.in.ua.
- `notified_events` — ключі дедуплікації (не персональні дані), щоб не надсилати одне й те саме сповіщення двічі.

Панель `/admin` (захищена паролем `ADMIN_TOKEN`) вміє експортувати всю таблицю `users` у вигляді SQL-дампа для бекапу/перенесення — ставтеся до `ADMIN_TOKEN` відповідно.

Під час невдалих спроб входу в `/admin` Worker короткочасно зберігає IP-адресу запиту (в edge-кеші Cloudflare, не в D1) для обмеження частоти спроб; це не пов'язано з жодним Telegram-користувачем і не зберігається довго.

Worker не передає користувацькі дані нікому, крім Telegram (для доставки сповіщень) і alerts.in.ua (для читання публічного, знеособленого статусу тривог).

### Ендпоінти
| Метод | Шлях | Опис |
|---|---|---|
| GET | `/` | Назва сервісу |
| GET | `/health` | Версія воркера, схема БД, режим тікера і `tickMs` |
| GET | `/api` | Поточний статус тривог (кешується на edge) |
| POST | `/register` | Реєстрація або оновлення локації та налаштувань сповіщень |
| POST | `/unregister` | Видалення користувача |
| POST | `/telegram/webhook` | Оновлення Telegram (`message`, `callback_query`) |
| POST | `/telegram/test` | Надсилання тестового повідомлення користувачу |
| GET | `/webhook-info` | Статус вебхука Telegram |
| GET | `/admin` | Панель власника (потрібен `ADMIN_TOKEN`) |

### Безпека
- Панель використовує вхід за паролем і підписану cookie-сесію (HMAC-SHA256, 7 днів). Скрипти можуть використовувати `Authorization: Bearer <ADMIN_TOKEN>`.
- Невдалі входи обмежені за IP.

## Schema (SQL)

One-time D1 setup. After deploying you can instead open `/admin` → *Инициализировать D1*: the Worker runs the same DDL itself. The script is idempotent, so re-running it is safe.

```sql
-- Air Raid Alert — полная схема D1 для текущего worker.js.
-- Выполнить один раз в Cloudflare Dashboard → D1 → ваша база → Console.
-- Скрипт идемпотентный: повторный запуск безопасен.
--
-- Без таблицы device_links не работает «вход» плагина: Telegram /start не
-- может сохранить связку устройство → чат, и новый пользователь никогда не
-- попадает в users.

-- 1. Пользователи.
CREATE TABLE IF NOT EXISTS users (
  chat_id            TEXT PRIMARY KEY,
  sync_token         TEXT,
  oblast_key         TEXT,
  district_key       TEXT,
  region_name        TEXT,
  lang               TEXT,
  notify             INTEGER DEFAULT 1,
  telegram_connected INTEGER DEFAULT 0,
  registered_at      TEXT,
  last_activity      TEXT,
  last_check         TEXT,
  last_alert_state   TEXT,
  last_alert_active  INTEGER,
  last_alert_start   TEXT,
  last_alert_end     TEXT,
  raw                TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_active ON users (oblast_key, district_key);
CREATE INDEX IF NOT EXISTS idx_users_notify ON users (notify);

-- 2. Кэш снимка тревог, состояние cron и тех.работ.
CREATE TABLE IF NOT EXISTS cache_kv (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at INTEGER
);

-- 3. Дедупликация уведомлений.
CREATE TABLE IF NOT EXISTS notified_events (
  dedupe_key TEXT PRIMARY KEY,
  created_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_notified_events_created ON notified_events (created_at);

-- 4. Связка установки плагина с Telegram-чатом (сценарий /start).
CREATE TABLE IF NOT EXISTS device_links (
  device_id    TEXT PRIMARY KEY,
  chat_id      TEXT NOT NULL,
  lang         TEXT,
  sync_token   TEXT,
  connected_at TEXT,
  expires_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_device_links_expires ON device_links (expires_at);
CREATE INDEX IF NOT EXISTS idx_device_links_chat ON device_links (chat_id);

-- Проверка после выполнения:
--   SELECT name FROM sqlite_master WHERE type = 'table';
--   SELECT COUNT(*) AS total FROM users;
--
-- Если таблица users уже существовала в старой схеме и в ней не хватает
-- колонок, INSERT из воркера будет падать. Проверить колонки:
--   PRAGMA table_info(users);
-- Недостающие колонки добавить вручную, например:
--   ALTER TABLE users ADD COLUMN raw TEXT;
```

### License
MIT License

Copyright © 2026 Bogdan Delas

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.