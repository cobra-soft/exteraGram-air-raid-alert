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
   - Storage & Databases → KV → *Create instance*, name it `USERS`.
   - Storage & Databases → D1 SQL Database → *Create database*, name it `air-raid-cache`.
2. **Create the tables.** Open the D1 database → *Console* and run:
   ```sql
   CREATE TABLE cache_kv (
     key TEXT PRIMARY KEY,
     value TEXT,
     updated_at INTEGER
   );
   CREATE TABLE plugin_versions (
     id INTEGER PRIMARY KEY,
     latest_version TEXT,
     minimum_version TEXT,
     changelog TEXT,
     update_url TEXT,
     updated_at TEXT
   );
   CREATE TABLE plugin_version_settings (
     id INTEGER PRIMARY KEY,
     update_check_enabled INTEGER,
     updated_at TEXT
   );
   ```
3. **Create the Worker.** Workers & Pages → *Create* → *Worker* → give it a name → *Edit code*, replace the default code with the contents of `worker.js`, then *Deploy*.
4. **Add bindings.** Open the Worker → *Settings* → *Bindings* → *Add*:
   - KV namespace: variable name `USERS`, namespace `USERS`.
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
| `USERS` | KV | User records, device-link tokens |
| `DB` | D1 | Alert snapshot cache, cron status, plugin version policy |

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
| GET | `/plugin/version` | Plugin update policy |
| GET | `/webhook-info` | Telegram webhook status |
| GET | `/admin` | Owner dashboard (requires `ADMIN_TOKEN`) |

### Security notes
- The dashboard uses a password login with a signed session cookie (HMAC-SHA256, 7 days). Scripts can use `Authorization: Bearer <ADMIN_TOKEN>`.
- Failed logins are rate-limited per IP.
- Plugin sync tokens are checked on `/unregister` and `/telegram/test`.

### License
Add your license here.

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
1. **Создайте хранилища.**
   - Storage & Databases → KV → *Create instance*, назовите `USERS`.
   - Storage & Databases → D1 SQL Database → *Create database*, назовите `air-raid-cache`.
2. **Создайте таблицы.** Откройте базу D1 → вкладку *Console* и выполните:
   ```sql
   CREATE TABLE cache_kv (
     key TEXT PRIMARY KEY,
     value TEXT,
     updated_at INTEGER
   );
   CREATE TABLE plugin_versions (
     id INTEGER PRIMARY KEY,
     latest_version TEXT,
     minimum_version TEXT,
     changelog TEXT,
     update_url TEXT,
     updated_at TEXT
   );
   CREATE TABLE plugin_version_settings (
     id INTEGER PRIMARY KEY,
     update_check_enabled INTEGER,
     updated_at TEXT
   );
   ```
3. **Создайте Worker.** Workers & Pages → *Create* → *Worker* → укажите имя → *Edit code*, замените код по умолчанию содержимым `worker.js`, затем *Deploy*.
4. **Добавьте биндинги.** Откройте Worker → *Settings* → *Bindings* → *Add*:
   - KV namespace: имя переменной `USERS`, namespace `USERS`.
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
| `USERS` | KV | Записи пользователей, токены привязки устройств |
| `DB` | D1 | Кэш снимка тревог, статус cron, политика версий плагина |

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
| GET | `/plugin/version` | Политика обновления плагина |
| GET | `/webhook-info` | Статус вебхука Telegram |
| GET | `/admin` | Панель владельца (нужен `ADMIN_TOKEN`) |

### Безопасность
- Панель использует вход по паролю и подписанную cookie-сессию (HMAC-SHA256, 7 дней). Скрипты могут использовать `Authorization: Bearer <ADMIN_TOKEN>`.
- Неудачные входы ограничены по IP.
- Токены синхронизации плагина проверяются в `/unregister` и `/telegram/test`.

### Лицензия
Укажите вашу лицензию здесь.

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
1. **Створіть сховища.**
   - Storage & Databases → KV → *Create instance*, назвіть `USERS`.
   - Storage & Databases → D1 SQL Database → *Create database*, назвіть `air-raid-cache`.
2. **Створіть таблиці.** Відкрийте базу D1 → вкладку *Console* і виконайте:
   ```sql
   CREATE TABLE cache_kv (
     key TEXT PRIMARY KEY,
     value TEXT,
     updated_at INTEGER
   );
   CREATE TABLE plugin_versions (
     id INTEGER PRIMARY KEY,
     latest_version TEXT,
     minimum_version TEXT,
     changelog TEXT,
     update_url TEXT,
     updated_at TEXT
   );
   CREATE TABLE plugin_version_settings (
     id INTEGER PRIMARY KEY,
     update_check_enabled INTEGER,
     updated_at TEXT
   );
   ```
3. **Створіть Worker.** Workers & Pages → *Create* → *Worker* → вкажіть назву → *Edit code*, замініть код за замовчуванням вмістом `worker.js`, потім *Deploy*.
4. **Додайте біндинги.** Відкрийте Worker → *Settings* → *Bindings* → *Add*:
   - KV namespace: назва змінної `USERS`, namespace `USERS`.
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
| `USERS` | KV | Записи користувачів, токени прив'язки пристроїв |
| `DB` | D1 | Кеш снімка тривог, статус cron, політика версій плагіна |

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
| GET | `/plugin/version` | Політика оновлення плагіна |
| GET | `/webhook-info` | Статус вебхука Telegram |
| GET | `/admin` | Панель власника (потрібен `ADMIN_TOKEN`) |

### Безпека
- Панель використовує вхід за паролем і підписану cookie-сесію (HMAC-SHA256, 7 днів). Скрипти можуть використовувати `Authorization: Bearer <ADMIN_TOKEN>`.
- Невдалі входи обмежені за IP.
- Токени синхронізації плагіна перевіряються в `/unregister` і `/telegram/test`.

### Ліцензія
Вкажіть вашу ліцензію тут.
