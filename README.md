# Air Raid Alert — Universal Worker

Cloudflare Worker that polls [alerts.in.ua](https://alerts.in.ua), keeps a snapshot of active alerts, sends Telegram notifications to subscribed users when their region's status changes, and serves the current status to client plugins (exteraGram).

**Languages:** [English](#english) · [Русский](#русский) · [Українська](#українська)

---

## English

### What it does
- Polls the alerts API every minute (cron) and stores a snapshot in D1.
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
2. **Create the tables.** Open the D1 database → *Console* and run the contents of `d1_full_schema.sql` (creates `users`, `cache_kv`, `notified_events`, `device_links`). This is a one-time step — Cloudflare keeps the tables after this.
3. **Create the Worker.** Workers & Pages → *Create* → *Worker* → give it a name → *Edit code*, replace the default code with the contents of `worker.js`, then *Deploy*.
4. **Add bindings.** Open the Worker → *Settings* → *Bindings* → *Add*:
   - D1 database: variable name `DB`, database `air-raid-cache`.
5. **Add secrets.** Worker → *Settings* → *Variables and Secrets* → add as **Secret** type:
   - `BOT_TOKEN` — your Telegram bot token.
   - `ALERTS_API_KEY` — your alerts.in.ua key.
   - `ADMIN_TOKEN` — the dashboard password. Without it the dashboard is disabled.
6. **Add the cron trigger.** Worker → *Settings* → *Triggers* → *Cron Triggers* → add `* * * * *`.
7. **Register the Telegram webhook.** Open `https://<your-worker>/admin`, log in with `ADMIN_TOKEN`, and run the *Setup webhook* action. (Or open `https://<your-worker>/setup-webhook` after logging in.)

> **Optional: deploy from a Git repository.** The repo includes `wrangler.toml`, which describes the bindings, cron trigger and variables. If you connect the repo to Workers Builds, Cloudflare reads this file on each push, so replace the `<KV_NAMESPACE_ID>` and `<D1_DATABASE_ID>` placeholders first. You do not need Node.js on your machine for this either.

### Bindings
| Binding | Type | Purpose |
|---|---|---|
| `DB` | D1 | Everything the Worker stores: user records, device-link tokens, alert snapshot cache, cron status |

All persistent storage lives in this single D1 database. There is no KV namespace — an earlier version used KV for user records, but the project has fully migrated to D1 (see `MIGRATION.md`).

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
| GET | `/health` | Worker version and status |
| GET | `/api` | Current alert status (cached at the edge) |
| POST | `/register` | Register or update a user's location and notification settings |
| POST | `/unregister` | Remove a user |
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
- Раз в минуту (cron) опрашивает API alerts.in.ua и сохраняет снимок активных тревог в D1.
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
2. **Создайте таблицы.** Откройте базу D1 → вкладку *Console* и выполните содержимое `d1_full_schema.sql` (создаёт `users`, `cache_kv`, `notified_events`, `device_links`). Это разовое действие — Cloudflare сохранит таблицы после него.
3. **Создайте Worker.** Workers & Pages → *Create* → *Worker* → укажите имя → *Edit code*, замените код по умолчанию содержимым `worker.js`, затем *Deploy*.
4. **Добавьте биндинги.** Откройте Worker → *Settings* → *Bindings* → *Add*:
   - D1 database: имя переменной `DB`, база `air-raid-cache`.
5. **Добавьте секреты.** Worker → *Settings* → *Variables and Secrets* → добавьте с типом **Secret**:
   - `BOT_TOKEN` — токен вашего Telegram-бота.
   - `ALERTS_API_KEY` — ключ alerts.in.ua.
   - `ADMIN_TOKEN` — пароль панели. Без него панель отключена.
6. **Добавьте cron-триггер.** Worker → *Settings* → *Triggers* → *Cron Triggers* → добавьте `* * * * *`.
7. **Зарегистрируйте вебхук Telegram.** Откройте `https://<ваш-worker>/admin`, войдите с `ADMIN_TOKEN` и выполните действие *Setup webhook*. (Или откройте `https://<ваш-worker>/setup-webhook` после входа.)

> **Необязательно: деплой из Git-репозитория.** В репозитории есть `wrangler.toml`, он описывает биндинги, cron-триггер и переменные. Если подключить репозиторий к Workers Builds, Cloudflare читает этот файл при каждом пуше, поэтому сначала замените плейсхолдеры `<KV_NAMESPACE_ID>` и `<D1_DATABASE_ID>`. Для этого тоже не нужен Node.js на вашем компьютере.

### Биндинги
| Биндинг | Тип | Назначение |
|---|---|---|
| `DB` | D1 | Всё, что хранит Worker: записи пользователей, токены привязки устройств, кэш снимка тревог, статус cron |

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
| GET | `/health` | Версия воркера и статус |
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
- Раз на хвилину (cron) опитує API alerts.in.ua і зберігає снімок активних тривог у D1.
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
2. **Створіть таблиці.** Відкрийте базу D1 → вкладку *Console* і виконайте вміст `d1_full_schema.sql` (створює `users`, `cache_kv`, `notified_events`, `device_links`). Це одноразова дія — Cloudflare збереже таблиці після неї.
3. **Створіть Worker.** Workers & Pages → *Create* → *Worker* → вкажіть назву → *Edit code*, замініть код за замовчуванням вмістом `worker.js`, потім *Deploy*.
4. **Додайте біндинги.** Відкрийте Worker → *Settings* → *Bindings* → *Add*:
   - D1 database: назва змінної `DB`, база `air-raid-cache`.
5. **Додайте секрети.** Worker → *Settings* → *Variables and Secrets* → додайте з типом **Secret**:
   - `BOT_TOKEN` — токен вашого Telegram-бота.
   - `ALERTS_API_KEY` — ключ alerts.in.ua.
   - `ADMIN_TOKEN` — пароль панелі. Без нього панель вимкнена.
6. **Додайте cron-тригер.** Worker → *Settings* → *Triggers* → *Cron Triggers* → додайте `* * * * *`.
7. **Зареєструйте вебхук Telegram.** Відкрийте `https://<ваш-worker>/admin`, увійдіть з `ADMIN_TOKEN` і виконайте дію *Setup webhook*. (Або відкрийте `https://<ваш-worker>/setup-webhook` після входу.)

> **Необов'язково: деплой з Git-репозиторію.** У репозиторії є `wrangler.toml`, він описує біндинги, cron-тригер і змінні. Якщо підключити репозиторій до Workers Builds, Cloudflare читатиме цей файл при кожному пуші, тому спочатку замініть плейсхолдери `<KV_NAMESPACE_ID>` і `<D1_DATABASE_ID>`. Для цього також не потрібен Node.js на вашому комп'ютері.

### Біндинги
| Біндинг | Тип | Призначення |
|---|---|---|
| `DB` | D1 | Усе, що зберігає Worker: записи користувачів, токени прив'язки пристроїв, кеш снімка тривог, статус cron |

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
| GET | `/health` | Версія воркера та статус |
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