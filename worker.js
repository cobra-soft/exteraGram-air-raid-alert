/* Build: 2026-11-02T18:04:39Z */

/*
 * MIT License
 *
 * Copyright © 2026 Bogdan Delas
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const ALERTS_API = "https://api.alerts.in.ua/v1/alerts/active.json";
const TELEGRAM_API = "https://api.telegram.org/bot";
const FETCH_TIMEOUT_MS = 5000;
const EDGE_CACHE_TTL_SECONDS = 5;
const WORKER_VERSION = "air-raid-panel-2026-11-12.8";
const SEND_CONCURRENCY = 15;
const MIN_CACHE_WRITE_INTERVAL_SECONDS = 60;
const RETRY_WINDOW_MS = 5 * 60 * 1000;
const STALE_SNAPSHOT_MS = 35 * 60 * 1000;
// The alarm loop polls alerts.in.ua every TICK_MS (Durable Object alarms allow
// sub-minute scheduling; a cron trigger alone can only run once a minute).
// alerts.in.ua documents a soft limit of 8-10 requests/minute per IP and a hard
// limit of 12/minute, so the default stays at 6/minute (10 s) and the loop has
// its own sliding-window cap. Override with the TICK_MS variable (5000-60000).
const TICK_MS_DEFAULT = 15000;
const TICK_MS_MIN = 5000;
const TICK_MS_MAX = 60000;
const TICK_JITTER_MS = 1500;
const TICK_WINDOW_MS = 60000;
const TICK_MAX_PER_WINDOW = 6;
const TICK_ERROR_BACKOFF_MS = 30000;
const TICK_429_BACKOFF_MS = 120000;

function resolveTickMs(env) {
  const n = Number(env && env.TICK_MS);
  if (!Number.isFinite(n)) return TICK_MS_DEFAULT;
  return Math.max(TICK_MS_MIN, Math.min(TICK_MS_MAX, Math.round(n)));
}
const MAX_LOCATIONS = 10;
const MAX_SESSIONS = 20;

const DETECTION_GAP_MS = 3 * 60 * 1000;
const SNAPSHOT_KEY = "alerts-in-ua";
const DEVICE_LINK_TTL_SECONDS = 600;
const UPDATE_DEDUP_TTL_SECONDS = 120;
const SYNC_TOKEN_BYTES = 18;
const KYIV_TZ = "Europe/Kyiv";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Cache-Control": "no-store"
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const OBLAST_NAMES_UK = {
  "krymska": "АР Крим",
  "vinnytska": "Вінницька область",
  "volynska": "Волинська область",
  "dnipropetrovska": "Дніпропетровська область",
  "donetska": "Донецька область",
  "zhytomyrska": "Житомирська область",
  "zakarpatska": "Закарпатська область",
  "zaporizka": "Запорізька область",
  "ivano-frankivska": "Івано-Франківська область",
  "kyivska": "Київська область",
  "kyiv-city": "м. Київ",
  "kirovohradska": "Кіровоградська область",
  "luhanska": "Луганська область",
  "lvivska": "Львівська область",
  "mykolaivska": "Миколаївська область",
  "odeska": "Одеська область",
  "poltavska": "Полтавська область",
  "rivnenska": "Рівненська область",
  "sumska": "Сумська область",
  "ternopilska": "Тернопільська область",
  "kharkivska": "Харківська область",
  "khersonska": "Херсонська область",
  "khmelnytska": "Хмельницька область",
  "cherkaska": "Черкаська область",
  "chernivetska": "Чернівецька область",
  "chernihivska": "Чернігівська область",
  "sevastopol-city": "м. Севастополь"
};
const DISTRICT_NAMES_UK = {
  "krymska:bakhchysaraiskyi": "Бахчисарайський",
  "krymska:bilohirskyi": "Білогірський",
  "krymska:dzhankoiskyi": "Джанкойський",
  "krymska:ievpatoriiskyi": "Євпаторійський",
  "krymska:kerchenskyi": "Керченський",
  "krymska:kurmanskyi": "Курманський",
  "krymska:perekopskyi": "Перекопський",
  "krymska:simferopolskyi": "Сімферопольський",
  "krymska:feodosiiskyi": "Феодосійський",
  "krymska:ialtynskyi": "Ялтинський",
  "vinnytska:vinnytskyi": "Вінницький",
  "vinnytska:haisynskyi": "Гайсинський",
  "vinnytska:zhmerynskyi": "Жмеринський",
  "vinnytska:mohylivpodilskyi": "Могилів-Подільський",
  "vinnytska:tulchynskyi": "Тульчинський",
  "vinnytska:khmilnytskyi": "Хмільницький",
  "volynska:volodymyrskyi": "Володимирський",
  "volynska:kaminkashyrskyi": "Камінь-Каширський",
  "volynska:kovelskyi": "Ковельський",
  "volynska:lutskyi": "Луцький",
  "dnipropetrovska:dniprovskyi": "Дніпровський",
  "dnipropetrovska:kamianskyi": "Кам’янський",
  "dnipropetrovska:kryvorizkyi": "Криворізький",
  "dnipropetrovska:nikopolskyi": "Нікопольський",
  "dnipropetrovska:novomoskovskyi": "Новомосковський",
  "dnipropetrovska:pavlohradskyi": "Павлоградський",
  "dnipropetrovska:synelnykivskyi": "Синельниківський",
  "donetska:bakhmutskyi": "Бахмутський",
  "donetska:volnovaskyi": "Волноваський",
  "donetska:horlivskyi": "Горлівський",
  "donetska:donetskyi": "Донецький",
  "donetska:kalmiuskyi": "Кальміуський",
  "donetska:kramatorskyi": "Краматорський",
  "donetska:mariupolskyi": "Маріупольський",
  "donetska:pokrovskyi": "Покровський",
  "zhytomyrska:berdychivskyi": "Бердичівський",
  "zhytomyrska:zhytomyrskyi": "Житомирський",
  "zhytomyrska:korostenskyi": "Коростенський",
  "zhytomyrska:zviahelskyi": "Звягельський",
  "zakarpatska:berehivskyi": "Берегівський",
  "zakarpatska:mukachivskyi": "Мукачівський",
  "zakarpatska:rakhivskyi": "Рахівський",
  "zakarpatska:tiachivskyi": "Тячівський",
  "zakarpatska:uzhhorodskyi": "Ужгородський",
  "zakarpatska:khustskyi": "Хустський",
  "zaporizka:berdianskyi": "Бердянський",
  "zaporizka:vasylivskyi": "Василівський",
  "zaporizka:zaporizkyi": "Запорізький",
  "zaporizka:melitopolskyi": "Мелітопольський",
  "zaporizka:polohivskyi": "Пологівський",
  "ivano-frankivska:verkhovynskyi": "Верховинський",
  "ivano-frankivska:ivanofrankivskyi": "Івано-Франківський",
  "ivano-frankivska:kaluskyi": "Калуський",
  "ivano-frankivska:kolomyiskyi": "Коломийський",
  "ivano-frankivska:kosivskyi": "Косівський",
  "ivano-frankivska:nadvirnianskyi": "Надвірнянський",
  "kyivska:bilotserkivskyi": "Білоцерківський",
  "kyivska:boryspilskyi": "Бориспільський",
  "kyivska:brovarskyi": "Броварський",
  "kyivska:buchanskyi": "Бучанський",
  "kyivska:vyshhorodskyi": "Вишгородський",
  "kyivska:obukhivskyi": "Обухівський",
  "kyivska:fastivskyi": "Фастівський",
  "kirovohradska:holovanivskyi": "Голованівський",
  "kirovohradska:kropyvnytskyi": "Кропивницький",
  "kirovohradska:novoukrainskyi": "Новоукраїнський",
  "kirovohradska:oleksandriiskyi": "Олександрійський",
  "luhanska:alchevskyi": "Алчевський",
  "luhanska:dovzhanskyi": "Довжанський",
  "luhanska:luhanskyi": "Луганський",
  "luhanska:rovenkivskyi": "Ровеньківський",
  "luhanska:svativskyi": "Сватівський",
  "luhanska:sievierodonetskyi": "Сєвєродонецький",
  "luhanska:starobilskyi": "Старобільський",
  "luhanska:shchastynskyi": "Щастинський",
  "lvivska:drohobytskyi": "Дрогобицький",
  "lvivska:zolochivskyi": "Золочівський",
  "lvivska:lvivskyi": "Львівський",
  "lvivska:sambirskyi": "Самбірський",
  "lvivska:stryiskyi": "Стрийський",
  "lvivska:chervonohradskyi": "Червоноградський",
  "lvivska:iavorivskyi": "Яворівський",
  "mykolaivska:bashtanskyi": "Баштанський",
  "mykolaivska:voznesenskyi": "Вознесенський",
  "mykolaivska:mykolaivskyi": "Миколаївський",
  "mykolaivska:pervomaiskyi": "Первомайський",
  "odeska:berezivskyi": "Березівський",
  "odeska:bilhoroddnistrovskyi": "Білгород-Дністровський",
  "odeska:bolhradskyi": "Болградський",
  "odeska:izmailskyi": "Ізмаїльський",
  "odeska:odeskyi": "Одеський",
  "odeska:podilskyi": "Подільський",
  "odeska:rozdilnianskyi": "Роздільнянський",
  "poltavska:kremenchutskyi": "Кременчуцький",
  "poltavska:lubenskyi": "Лубенський",
  "poltavska:myrhorodskyi": "Миргородський",
  "poltavska:poltavskyi": "Полтавський",
  "rivnenska:varaskyi": "Вараський",
  "rivnenska:dubenskyi": "Дубенський",
  "rivnenska:rivnenskyi": "Рівненський",
  "rivnenska:sarnenskyi": "Сарненський",
  "sumska:konotopskyi": "Конотопський",
  "sumska:okhtyrskyi": "Охтирський",
  "sumska:romenskyi": "Роменський",
  "sumska:sumskyi": "Сумський",
  "sumska:shostkynskyi": "Шосткинський",
  "ternopilska:kremenetskyi": "Кременецький",
  "ternopilska:ternopilskyi": "Тернопільський",
  "ternopilska:chortkivskyi": "Чортківський",
  "kharkivska:bohodukhivskyi": "Богодухівський",
  "kharkivska:iziumskyi": "Ізюмський",
  "kharkivska:krasnohradskyi": "Красноградський",
  "kharkivska:kupianskyi": "Куп’янський",
  "kharkivska:lozivskyi": "Лозівський",
  "kharkivska:kharkivskyi": "Харківський",
  "kharkivska:chuhuivskyi": "Чугуївський",
  "khersonska:beryslavskyi": "Бериславський",
  "khersonska:henicheskyi": "Генічеський",
  "khersonska:kakhovskyi": "Каховський",
  "khersonska:skadovskyi": "Скадовський",
  "khersonska:khersonskyi": "Херсонський",
  "khmelnytska:kamianetspodilskyi": "Кам’янець-Подільський",
  "khmelnytska:khmelnytskyi": "Хмельницький",
  "khmelnytska:shepetivskyi": "Шепетівський",
  "cherkaska:zvenyhorodskyi": "Звенигородський",
  "cherkaska:zolotoniskyi": "Золотоніський",
  "cherkaska:umanskyi": "Уманський",
  "cherkaska:cherkaskyi": "Черкаський",
  "chernivetska:vyzhnytskyi": "Вижницький",
  "chernivetska:dnistrovskyi": "Дністровський",
  "chernivetska:chernivetskyi": "Чернівецький",
  "chernihivska:koriukivskyi": "Корюківський",
  "chernihivska:nizhynskyi": "Ніжинський",
  "chernihivska:novhorodsiverskyi": "Новгород-Сіверський",
  "chernihivska:prylutskyi": "Прилуцький",
  "chernihivska:chernihivskyi": "Чернігівський"
};

function isValidAlerts(data) {
  return data && typeof data === "object" &&
    Array.isArray(data.raions) && Array.isArray(data.oblasts);
}

async function d1GetKV(db, key) {
  try {
    const row = await db.prepare("SELECT value FROM cache_kv WHERE key = ?1").bind(key).first();
    return row ? row.value : null;
  } catch (e) {
    console.error(`[d1] read error for ${key}:`, e);
    return null;
  }
}

async function d1PutKV(db, key, value) {
  try {
    await db.prepare(
      "INSERT INTO cache_kv (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ).bind(key, value, Date.now()).run();
  } catch (e) {
    console.error(`[d1] write error for ${key}:`, e);
  }
}

const D1_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    chat_id TEXT PRIMARY KEY, sync_token TEXT, oblast_key TEXT, district_key TEXT,
    region_name TEXT, lang TEXT, notify INTEGER DEFAULT 1, telegram_connected INTEGER DEFAULT 0,
    registered_at TEXT, last_activity TEXT, last_check TEXT, last_alert_state TEXT,
    last_alert_active INTEGER, last_alert_start TEXT, last_alert_end TEXT, raw TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_users_active ON users (oblast_key, district_key)`,
  `CREATE INDEX IF NOT EXISTS idx_users_notify ON users (notify)`,
  `CREATE TABLE IF NOT EXISTS cache_kv (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS notified_events (dedupe_key TEXT PRIMARY KEY, created_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_notified_events_created ON notified_events (created_at)`,
  `CREATE TABLE IF NOT EXISTS device_links (
    device_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, lang TEXT, sync_token TEXT,
    connected_at TEXT, expires_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_device_links_expires ON device_links (expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_device_links_chat ON device_links (chat_id)`
];

async function ensureSchema(env) {
  const out = { ok: true, executed: [], errors: [] };
  for (const sql of D1_SCHEMA) {
    const m = sql.match(/(?:TABLE|INDEX)\s+(?:IF NOT EXISTS\s+)?([a-z_]+)/i);
    const name = m ? m[1] : "statement";
    try {
      await env.DB.prepare(sql).run();
      out.executed.push(name);
    } catch (e) {
      out.ok = false;
      out.errors.push({ name, error: String(e && e.message || e).slice(0, 200) });
    }
  }
  out.schema = await checkSchema(env.DB);
  if (!out.schema.ok) out.ok = false;
  return out;
}

const REQUIRED_TABLES = {
  users: ["chat_id", "sync_token", "oblast_key", "district_key", "region_name", "lang", "notify",
    "telegram_connected", "registered_at", "last_activity", "last_check", "last_alert_state",
    "last_alert_active", "last_alert_start", "last_alert_end", "raw"],
  cache_kv: ["key", "value", "updated_at"],
  notified_events: ["dedupe_key", "created_at"],
  device_links: ["device_id", "chat_id", "lang", "sync_token", "connected_at", "expires_at"]
};

async function checkSchema(db) {
  const out = { ok: true, tables: {}, missing: [], badColumns: [], error: null };
  for (const [table, columns] of Object.entries(REQUIRED_TABLES)) {
    try {
      let names;
      try {
        const res = await db.prepare(`PRAGMA table_info(${table})`).all();
        names = ((res && res.results) || []).map(r => r && r.name).filter(Boolean);
      } catch (pragmaErr) {
        const res = await db.prepare("SELECT name FROM pragma_table_info(?1)").bind(table).all();
        names = ((res && res.results) || []).map(r => r && r.name).filter(Boolean);
      }
      const have = new Set(names);
      if (!have.size) {
        out.tables[table] = "missing";
        out.missing.push(table);
        out.ok = false;
        continue;
      }
      const lack = columns.filter(c => !have.has(c));
      if (lack.length) {
        out.tables[table] = "bad-columns";
        out.badColumns.push({ table, columns: lack });
        out.ok = false;
      } else {
        out.tables[table] = "ok";
      }
    } catch (e) {
      out.tables[table] = "error";
      out.missing.push(table);
      out.ok = false;
      out.error = String(e && e.message || e).slice(0, 200);
    }
  }
  return out;
}

async function tryClaimNotification(db, dedupeKey) {
  try {
    const res = await db.prepare(
      "INSERT INTO notified_events (dedupe_key, created_at) VALUES (?1, ?2) ON CONFLICT(dedupe_key) DO NOTHING"
    ).bind(dedupeKey, Date.now()).run();
    return !!(res && res.meta && res.meta.changes > 0);
  } catch (e) {
    console.error(`[dedupe] claim error for ${dedupeKey}:`, e);
    return true;
  }
}

async function releaseNotificationClaim(db, dedupeKey) {
  try {
    await db.prepare("DELETE FROM notified_events WHERE dedupe_key = ?1").bind(dedupeKey).run();
  } catch (e) {
    console.error(`[dedupe] release error for ${dedupeKey}:`, e);
  }
}

async function readCache(db) {
  try {
    const cached = await d1GetKV(db, SNAPSHOT_KEY);
    if (!cached) return null;
    const wrapped = JSON.parse(cached);
    if (wrapped && wrapped.data && isValidAlerts(wrapped.data)) return wrapped;
  } catch (e) {
    console.error("[cache] read error:", e);
  }
  return null;
}

async function writeCache(db, data, fetchedAt = Date.now(), signature = null, pendingRetry = 0) {
  const snapshot = {
    oblasts: Array.isArray(data && data.oblasts) ? data.oblasts : [],
    raions: Array.isArray(data && data.raions) ? data.raions : []
  };
  await d1PutKV(
    db,
    SNAPSHOT_KEY,
    JSON.stringify({ fetchedAt, signature: signature || buildStatusSignature(snapshot), data: snapshot, pendingRetry: Number(pendingRetry) || 0 })
  );
}

const OBLAST_NAME_TO_SLUG = {
  "АР Крим": "krymska",
  "Автономна Республіка Крим": "krymska",
  "Вінницька область": "vinnytska",
  "Волинська область": "volynska",
  "Дніпропетровська область": "dnipropetrovska",
  "Донецька область": "donetska",
  "Житомирська область": "zhytomyrska",
  "Закарпатська область": "zakarpatska",
  "Запорізька область": "zaporizka",
  "Івано-Франківська область": "ivano-frankivska",
  "Київська область": "kyivska",
  "м. Київ": "kyiv-city",
  "Кіровоградська область": "kirovohradska",
  "Луганська область": "luhanska",
  "Львівська область": "lvivska",
  "Миколаївська область": "mykolaivska",
  "Одеська область": "odeska",
  "Полтавська область": "poltavska",
  "Рівненська область": "rivnenska",
  "Сумська область": "sumska",
  "Тернопільська область": "ternopilska",
  "Харківська область": "kharkivska",
  "Херсонська область": "khersonska",
  "Хмельницька область": "khmelnytska",
  "Черкаська область": "cherkaska",
  "Чернівецька область": "chernivetska",
  "Чернігівська область": "chernihivska",
  "м. Севастополь": "sevastopol-city"
};

const DISTRICT_NAME_TO_SLUG = {
  krymska: {"Бахчисарайський":"bakhchysaraiskyi","Білогірський":"bilohirskyi","Джанкойський":"dzhankoiskyi","Євпаторійський":"ievpatoriiskyi","Керченський":"kerchenskyi","Курманський":"kurmanskyi","Перекопський":"perekopskyi","Сімферопольський":"simferopolskyi","Феодосійський":"feodosiiskyi","Ялтинський":"ialtynskyi"},
  vinnytska: {"Вінницький":"vinnytskyi","Гайсинський":"haisynskyi","Жмеринський":"zhmerynskyi","Могилів-Подільський":"mohylivpodilskyi","Тульчинський":"tulchynskyi","Хмільницький":"khmilnytskyi"},
  volynska: {"Володимирський":"volodymyrskyi","Камінь-Каширський":"kaminkashyrskyi","Ковельський":"kovelskyi","Луцький":"lutskyi"},
  dnipropetrovska: {"Дніпровський":"dniprovskyi","Кам’янський":"kamianskyi","Криворізький":"kryvorizkyi","Нікопольський":"nikopolskyi","Новомосковський":"novomoskovskyi","Павлоградський":"pavlohradskyi","Синельниківський":"synelnykivskyi"},
  donetska: {"Бахмутський":"bakhmutskyi","Волноваський":"volnovaskyi","Горлівський":"horlivskyi","Донецький":"donetskyi","Кальміуський":"kalmiuskyi","Краматорський":"kramatorskyi","Маріупольський":"mariupolskyi","Покровський":"pokrovskyi"},
  zhytomyrska: {"Бердичівський":"berdychivskyi","Житомирський":"zhytomyrskyi","Коростенський":"korostenskyi","Звягельський":"zviahelskyi"},
  zakarpatska: {"Берегівський":"berehivskyi","Мукачівський":"mukachivskyi","Рахівський":"rakhivskyi","Тячівський":"tiachivskyi","Ужгородський":"uzhhorodskyi","Хустський":"khustskyi"},
  zaporizka: {"Бердянський":"berdianskyi","Василівський":"vasylivskyi","Запорізький":"zaporizkyi","Мелітопольський":"melitopolskyi","Пологівський":"polohivskyi"},
  "ivano-frankivska": {"Верховинський":"verkhovynskyi","Івано-Франківський":"ivanofrankivskyi","Калуський":"kaluskyi","Коломийський":"kolomyiskyi","Косівський":"kosivskyi","Надвірнянський":"nadvirnianskyi"},
  kyivska: {"Білоцерківський":"bilotserkivskyi","Бориспільський":"boryspilskyi","Броварський":"brovarskyi","Бучанський":"buchanskyi","Вишгородський":"vyshhorodskyi","Обухівський":"obukhivskyi","Фастівський":"fastivskyi"},
  "kyiv-city": {},
  kirovohradska: {"Голованівський":"holovanivskyi","Кропивницький":"kropyvnytskyi","Новоукраїнський":"novoukrainskyi","Олександрійський":"oleksandriiskyi"},
  luhanska: {"Алчевський":"alchevskyi","Довжанський":"dovzhanskyi","Луганський":"luhanskyi","Ровеньківський":"rovenkivskyi","Сватівський":"svativskyi","Сєвєродонецький":"sievierodonetskyi","Старобільський":"starobilskyi","Щастинський":"shchastynskyi"},
  lvivska: {"Дрогобицький":"drohobytskyi","Золочівський":"zolochivskyi","Львівський":"lvivskyi","Самбірський":"sambirskyi","Стрийський":"stryiskyi","Червоноградський":"chervonohradskyi","Яворівський":"iavorivskyi"},
  mykolaivska: {"Баштанський":"bashtanskyi","Вознесенський":"voznesenskyi","Миколаївський":"mykolaivskyi","Первомайський":"pervomaiskyi"},
  odeska: {"Березівський":"berezivskyi","Білгород-Дністровський":"bilhoroddnistrovskyi","Болградський":"bolhradskyi","Ізмаїльський":"izmailskyi","Одеський":"odeskyi","Подільський":"podilskyi","Роздільнянський":"rozdilnianskyi"},
  poltavska: {"Кременчуцький":"kremenchutskyi","Лубенський":"lubenskyi","Миргородський":"myrhorodskyi","Полтавський":"poltavskyi"},
  rivnenska: {"Вараський":"varaskyi","Дубенський":"dubenskyi","Рівненський":"rivnenskyi","Сарненський":"sarnenskyi"},
  sumska: {"Конотопський":"konotopskyi","Охтирський":"okhtyrskyi","Роменський":"romenskyi","Сумський":"sumskyi","Шосткинський":"shostkynskyi"},
  ternopilska: {"Кременецький":"kremenetskyi","Тернопільський":"ternopilskyi","Чортківський":"chortkivskyi"},
  kharkivska: {"Богодухівський":"bohodukhivskyi","Ізюмський":"iziumskyi","Красноградський":"krasnohradskyi","Куп’янський":"kupianskyi","Лозівський":"lozivskyi","Харківський":"kharkivskyi","Чугуївський":"chuhuivskyi"},
  khersonska: {"Бериславський":"beryslavskyi","Генічеський":"henicheskyi","Каховський":"kakhovskyi","Скадовський":"skadovskyi","Херсонський":"khersonskyi"},
  khmelnytska: {"Кам’янець-Подільський":"kamianetspodilskyi","Хмельницький":"khmelnytskyi","Шепетівський":"shepetivskyi"},
  cherkaska: {"Звенигородський":"zvenyhorodskyi","Золотоніський":"zolotoniskyi","Уманський":"umanskyi","Черкаський":"cherkaskyi"},
  chernivetska: {"Вижницький":"vyzhnytskyi","Дністровський":"dnistrovskyi","Чернівецький":"chernivetskyi"},
  chernihivska: {"Корюківський":"koriukivskyi","Ніжинський":"nizhynskyi","Новгород-Сіверський":"novhorodsiverskyi","Прилуцький":"prylutskyi","Чернігівський":"chernihivskyi"},
  "sevastopol-city": {}
};

function normalizeUk(s) {
  return String(s || "")
    .replace(/[’ʼ`]/g, "'")
    .replace(/\s+район$/iu, "")
    .replace(/\s+громада$/iu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const OBLAST_NAME_NORM_TO_SLUG = {};
for (const [name, slug] of Object.entries(OBLAST_NAME_TO_SLUG)) {
  OBLAST_NAME_NORM_TO_SLUG[normalizeUk(name)] = slug;
}
const DISTRICT_NAME_NORM_TO_SLUG = {};
for (const [oblastSlug, districts] of Object.entries(DISTRICT_NAME_TO_SLUG)) {
  DISTRICT_NAME_NORM_TO_SLUG[oblastSlug] = {};
  for (const [name, slug] of Object.entries(districts)) {
    DISTRICT_NAME_NORM_TO_SLUG[oblastSlug][normalizeUk(name)] = slug;
  }
}

async function fetchUpstream(env) {
  if (!env.ALERTS_API_KEY) throw new Error("ALERTS_API_KEY not configured");
  const r = await fetchWithTimeout(ALERTS_API, {
      headers: { 'Authorization': `Bearer ${env.ALERTS_API_KEY}` }
    }, FETCH_TIMEOUT_MS);
  if (!r.ok) {
    const err = new Error(`alerts.in.ua HTTP ${r.status}`);
    err.status = r.status;
    const ra = Number(r.headers.get("Retry-After"));
    err.retryAfterMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 300) * 1000 : 0;
    throw err;
  }
  const json = await r.json();
  if (!json || typeof json !== "object" || !Array.isArray(json.alerts)) {
    throw new Error("alerts.in.ua: invalid response (alerts is not an array)");
  }

  const oblasts = {};
  const raions = [];
  const seenRaions = new Set();

  for (const alert of json.alerts) {
    if (!alert || typeof alert !== "object") continue;
    if (alert.alert_type !== "air_raid") continue;

    const oblastSlug = OBLAST_NAME_NORM_TO_SLUG[normalizeUk(alert.location_oblast)];
    if (!oblastSlug) {
      console.error(`[alerts.in.ua] unknown oblast name: ${alert.location_oblast}`);
      continue;
    }

    let locationType = String(alert.location_type || "").trim();
    let raionName = alert.location_raion || alert.location_title;

    if (locationType === "hromada" || locationType === "city" || locationType === "settlement") {
      if (alert.location_raion) {
        locationType = "raion";
        raionName = alert.location_raion;
      } else if (oblastSlug === "kyiv-city" || oblastSlug === "sevastopol-city") {
        locationType = "oblast";
      }
    }

    if (locationType === "oblast") {
      oblasts[oblastSlug] = {
        key: oblastSlug,
        name: alert.location_oblast,
        oblast: alert.location_oblast,
        alert_level: alert.alert_level,
        started_at: alert.started_at
      };
    } else if (locationType === "raion") {
      if (!raionName) {
        console.error(`[alerts.in.ua] raion alert with no name (id ${alert.id}) in ${alert.location_oblast}`);
        continue;
      }
      const districtMap = DISTRICT_NAME_NORM_TO_SLUG[oblastSlug] || {};
      const districtSlug = districtMap[normalizeUk(raionName)];
      if (!districtSlug) {
        console.error(`[alerts.in.ua] unknown district name: ${raionName} in ${alert.location_oblast}`);
        continue;
      }
      const key = `${oblastSlug}:${districtSlug}`;
      if (seenRaions.has(key)) continue;
      seenRaions.add(key);
      raions.push({
        key,
        oblast: alert.location_oblast,
        name: raionName,
        alert_level: alert.alert_level,
        started_at: alert.started_at
      });
    } else {
      console.error(`[alerts.in.ua] skipping unmapped location_type "${alert.location_type}" in ${alert.location_oblast}`);
    }
  }

  return {
    alerts: json.alerts,
    oblasts: Object.values(oblasts),
    raions: raions
  };
}

function buildStatusSignature(data) {
  return buildStateSignature(data);
}

const upstreamMem = { data: null, at: 0, cooldownUntil: 0, lastError: null, inflight: null };

async function fetchUpstreamShared(env, maxAgeMs = 30000) {
  const now = Date.now();
  if (upstreamMem.data && now - upstreamMem.at < maxAgeMs) return upstreamMem.data;
  if (now < upstreamMem.cooldownUntil && upstreamMem.lastError) throw upstreamMem.lastError;
  if (upstreamMem.inflight) return upstreamMem.inflight;
  upstreamMem.inflight = (async () => {
    try {
      const d = await fetchUpstream(env);
      upstreamMem.data = d; upstreamMem.at = Date.now(); upstreamMem.lastError = null; upstreamMem.cooldownUntil = 0;
      return d;
    } catch (e) {
      if (e && e.status === 429) {
        upstreamMem.lastError = e;
        upstreamMem.cooldownUntil = Date.now() + (e.retryAfterMs || 60000);
      }
      throw e;
    } finally {
      upstreamMem.inflight = null;
    }
  })();
  return upstreamMem.inflight;
}

async function fetchUpstreamRetry(env) {
  try {
    return await fetchUpstream(env);
  } catch (e) {
    // Never retry a 429: that would only deepen the rate-limit violation.
    // Let the ticker back off for a full minute (or Retry-After) instead.
    if (e && e.status === 429) throw e;
    const transient = e && (e.status >= 500 || (!e.status && !/not configured/.test(String(e.message))));
    if (!transient) throw e;
    await new Promise(r => setTimeout(r, 1500));
    return await fetchUpstream(env);
  }
}

const CRON_STATUS_KEY = "cron-status";
const MAINTENANCE_KEY = "maintenance";

async function getMaintenance(env) {
  try {
    const raw = await d1GetKV(env.DB, MAINTENANCE_KEY);
    if (!raw) return { active: false, since: null, message: null };
    const parsed = JSON.parse(raw);
    return { active: !!(parsed && parsed.active), since: (parsed && parsed.since) || null, message: (parsed && parsed.message) || null };
  } catch (e) {
    console.error("[maintenance] read error:", e);
    return { active: false, since: null, message: null };
  }
}

async function setMaintenance(env, active, message) {
  await d1PutKV(env.DB, MAINTENANCE_KEY, JSON.stringify({
    active: !!active,
    since: new Date().toISOString(),
    message: active ? (message || "Ведутся технические работы. Часть функций временно недоступна.") : null
  }));
}

async function recordCron(env, ok, err) {
  try {
    const prevRaw = await d1GetKV(env.DB, CRON_STATUS_KEY);
    const prev = prevRaw ? JSON.parse(prevRaw) : null;
    const now = Date.now();
    if (ok) {
      if (prev && prev.state === "fail") {
        await d1PutKV(env.DB, CRON_STATUS_KEY, JSON.stringify({ state: "ok", at: now, recoveredFrom: prev.since, error: prev.error }));
      }
      return;
    }
    const msg = String(err && err.message || err).slice(0, 160);
    if (!prev || prev.state !== "fail") {
      await d1PutKV(env.DB, CRON_STATUS_KEY, JSON.stringify({ state: "fail", since: now, lastAt: now, error: msg }));
    } else if (now - (prev.lastAt || 0) > 600000) {
      await d1PutKV(env.DB, CRON_STATUS_KEY, JSON.stringify({ ...prev, lastAt: now, error: msg }));
    }
  } catch (e) { }
}

async function getSharedSnapshot(env) {
  const cached = await readCache(env.DB);
  if (cached) {
    return { ...cached, heartbeat: cached.fetchedAt };
  }

  const data = await fetchUpstreamShared(env);
  const fetchedAt = Date.now();
  const publicData = {
    oblasts: Array.isArray(data && data.oblasts) ? data.oblasts : [],
    raions: Array.isArray(data && data.raions) ? data.raions : []
  };
  const signature = buildStatusSignature(publicData);
  const maintenance = await getMaintenance(env);
  if (!maintenance.active) await writeCache(env.DB, publicData, fetchedAt, signature);
  return { fetchedAt, signature, data: publicData, heartbeat: fetchedAt };
}

async function getPublicAlerts(env, request, ctx = null) {
  const u = new URL(request.url);
  u.pathname = "/api";
  u.search = "";
  const cacheKey = new Request(u.toString(), { method: "GET" });
  const maintenance = await getMaintenance(env);

  const edge = await caches.default.match(cacheKey);
  if (edge) {
    const payload = await edge.json();
    return { ...payload, serverTime: new Date().toISOString(), maintenance };
  }

  let stored = await readCache(env.DB);
  if (stored && stored.fetchedAt && Date.now() - stored.fetchedAt > STALE_SNAPSHOT_MS && !maintenance.active && !(await hasEphemeralFlag("live-refresh"))) {
    await setEphemeralFlag("live-refresh", 20);
    try {
      const liveData = await fetchUpstreamShared(env);
      const livePublic = {
        oblasts: Array.isArray(liveData && liveData.oblasts) ? liveData.oblasts : [],
        raions: Array.isArray(liveData && liveData.raions) ? liveData.raions : []
      };
      const liveAt = Date.now();
      const liveSig = buildStatusSignature(livePublic);
      await writeCache(env.DB, livePublic, liveAt, liveSig);
      stored = { fetchedAt: liveAt, signature: liveSig, data: livePublic };
    } catch (e) {
      console.error("[api] live refresh failed:", e);
    }
  }
  if (stored && stored.data) {
    const heartbeat = stored.fetchedAt;
    const payload = {
      ...stored.data,
      fetchedAt: stored.fetchedAt,
      snapshotSignature: stored.signature || buildStatusSignature(stored.data),
      lastUpstreamCheckAt: heartbeat || null,
      stale: heartbeat ? (Date.now() - heartbeat > STALE_SNAPSHOT_MS) : false,
      staleAgeSeconds: heartbeat ? Math.max(0, Math.round((Date.now() - heartbeat) / 1000)) : null
    };
    const response = new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${EDGE_CACHE_TTL_SECONDS}` }
    });
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    else await caches.default.put(cacheKey, response.clone());
    return { ...payload, serverTime: new Date().toISOString(), maintenance };
  }

  const data = await fetchUpstreamShared(env);
  const fetchedAt = Date.now();
  const publicData = {
    oblasts: Array.isArray(data && data.oblasts) ? data.oblasts : [],
    raions: Array.isArray(data && data.raions) ? data.raions : []
  };
  const signature = buildStatusSignature(publicData);
  if (!maintenance.active) await writeCache(env.DB, publicData, fetchedAt, signature);
  const payload = { ...publicData, fetchedAt, snapshotSignature: signature, lastUpstreamCheckAt: fetchedAt, stale: false, staleAgeSeconds: 0 };
  const response = new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${EDGE_CACHE_TTL_SECONDS}` }
  });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  else await caches.default.put(cacheKey, response.clone());
  return { ...payload, serverTime: new Date().toISOString(), maintenance };
}

function defaultLocationName(oblastKey, districtKey) {
  const oblastName = OBLAST_NAMES_UK[oblastKey] || oblastKey;
  if (!districtKey) return oblastName;
  const districtName = DISTRICT_NAMES_UK[`${oblastKey}:${districtKey}`];
  return districtName ? `${oblastName} · ${districtName}` : oblastName;
}

function normalizeLocation(item) {
  if (!item || typeof item !== "object") return null;
  const oblastKey = String(item.oblast_key || "").trim();
  if (!oblastKey || !OBLAST_NAMES_UK[oblastKey]) return null;
  const rawDistrict = item.district_key == null ? "" : String(item.district_key).trim();
  const districtKey = rawDistrict || null;
  if (districtKey && !DISTRICT_NAMES_UK[`${oblastKey}:${districtKey}`]) return null;
  const regionName = trimLen(item.region_name, 80) || defaultLocationName(oblastKey, districtKey);
  return { oblast_key: oblastKey, district_key: districtKey, region_name: regionName };
}

function locationKey(location) {
  if (!location) return "";
  const oblastKey = String(location.oblast_key || "");
  const districtKey = String(location.district_key || "");
  return districtKey ? `${oblastKey}:${districtKey}` : oblastKey;
}

function parseLocationsInput(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_LOCATIONS) return null;
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const location = normalizeLocation(item);
    if (!location) return null;
    const key = locationKey(location);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(location);
  }
  return out;
}

function userLocations(user) {
  const out = [];
  const seen = new Set();
  if (user && Array.isArray(user.locations)) {
    for (const item of user.locations) {
      const location = normalizeLocation(item);
      if (!location) continue;
      const key = locationKey(location);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(location);
      if (out.length >= MAX_LOCATIONS) break;
    }
  }
  if (!out.length && user && user.oblast_key) {
    const legacy = normalizeLocation({
      oblast_key: user.oblast_key,
      district_key: user.district_key,
      region_name: user.region_name
    });
    if (legacy) out.push(legacy);
  }
  return out;
}

function locationsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (locationKey(a[i]) !== locationKey(b[i])) return false;
  }
  return true;
}

function normalizeSessions(user) {
  const out = [];
  const seen = new Set();
  const push = (token, deviceId, createdAt) => {
    if (typeof token !== "string" || !token || seen.has(token)) return;
    seen.add(token);
    out.push({ token, device_id: deviceId || null, created_at: createdAt || null });
  };
  if (user && user.sync_token) push(user.sync_token, null, user.registered_at);
  if (user && Array.isArray(user.sessions)) {
    for (const item of user.sessions) {
      if (typeof item === "string") push(item, null, null);
      else if (item && typeof item === "object") push(item.token, item.device_id, item.created_at);
    }
  }
  return out.slice(-MAX_SESSIONS);
}

function addSession(user, token, deviceId) {
  const sessions = normalizeSessions(user);
  if (!sessions.some(s => s.token === token)) {
    sessions.push({ token, device_id: deviceId || null, created_at: new Date().toISOString() });
  }
  user.sessions = sessions.slice(-MAX_SESSIONS);
}

function isValidToken(existing, token) {
  if (!existing || typeof token !== "string" || !token) return false;
  if (existing.sync_token === token) return true;
  return Array.isArray(existing.sessions) && existing.sessions.some(s =>
    s && (typeof s === "string" ? s : s.token) === token
  );
}

function applyLegacyFields(user) {
  const locations = userLocations(user);
  const first = locations[0] || null;
  user.locations = locations;
  user.oblast_key = first ? first.oblast_key : null;
  user.district_key = first ? first.district_key : null;
  user.region_name = first ? first.region_name : null;

  const states = user.location_states && typeof user.location_states === "object" ? user.location_states : {};
  let worst = "clear";
  let start = null;
  let end = null;
  for (const location of locations) {
    const state = states[locationKey(location)];
    if (!state || typeof state !== "object") continue;
    if (state.state === "red") worst = "red";
    else if (state.state === "yellow" && worst !== "red") worst = "yellow";
    if (state.state !== "clear" && typeof state.since === "string") {
      if (!start || state.since < start) start = state.since;
    }
    if (state.state === "clear" && typeof state.end === "string") {
      if (!end || state.end > end) end = state.end;
    }
  }
  user.last_alert_state = worst;
  user.last_alert_active = worst !== "clear";
  user.last_alert_start = worst === "clear" ? null : start;
  user.last_alert_end = worst === "clear" ? end : null;
  return user;
}

function stateOf(item) {
  if (!item || typeof item !== "object") return "clear";
  const level = String(item.alert_level || "red").toLowerCase();
  return level === "yellow" ? "yellow" : "red";
}

function buildStateSignature(data) {
  const items = [];
  for (const x of (data?.oblasts || [])) {
    if (!x || typeof x !== "object") continue;
    const key = String(x.key || "");
    if (key) items.push(`o:${key}:${stateOf(x)}:${x.started_at || ""}`);
  }
  for (const x of (data?.raions || [])) {
    if (!x || typeof x !== "object") continue;
    const key = String(x.key || "");
    if (key) items.push(`r:${key}:${stateOf(x)}:${x.started_at || ""}`);
  }
  items.sort((a,b) => a.localeCompare(b));
  return JSON.stringify(items);
}

function findAlert(data, oblastKey, districtKey) {
  if (!data || !oblastKey) return null;
  const ok = String(oblastKey);
  const district = districtKey ? String(districtKey) : "";

  if (!district) {
    for (const x of (data.oblasts || [])) {
      if (!x || typeof x !== "object") continue;
      const key = String(x.key || "");
      if (key === ok) return x;
    }
    return null;
  }

  const wanted = `${ok}:${district}`;
  for (const x of (data.raions || [])) {
    if (!x || typeof x !== "object") continue;
    const key = String(x.key || "");
    if (key === wanted) return x;
  }

  for (const x of (data.oblasts || [])) {
    if (!x || typeof x !== "object") continue;
    const key = String(x.key || "");
    if (key === ok) return x;
  }
  return null;
}

function alertStatus(data, oblastKey, districtKey) {
  const alert = findAlert(data, oblastKey, districtKey);
  if (!alert) return { state: "clear", since: null };
  return {
    state: stateOf(alert),
    since: alert.started_at || null
  };
}

function formatTimeKyiv(date) {
  try {
    return new Intl.DateTimeFormat("uk-UA", { timeZone: KYIV_TZ, hour: "2-digit", minute: "2-digit" }).format(date);
  } catch (e) {
    console.error("[formatTimeKyiv] error:", e);
    return "—";
  }
}

function stateMessage(region, status, lang) {
  const m = M(lang);
  region = escapeHtml(region);
  if (status.state === "red") return m.red(region, formatTimeKyiv(new Date(status.since || Date.now())));
  if (status.state === "yellow") return m.yellow(region, formatTimeKyiv(new Date(status.since || Date.now())));
  return m.clear(region);
}

async function checkAllUsers(env) {
  // Do not spend an upstream request while maintenance mode is on.
  const maint = await getMaintenance(env);
  if (maint.active) {
    console.log("[notify] skipped: maintenance mode is active; snapshot is not advanced");
    return;
  }
  const previous = await readCache(env.DB);
  let data;
  try {
    data = await fetchUpstreamRetry(env);
  } catch (e) {
    console.error("[upstream] scheduled fetch error:", e);
    await recordCron(env, false, e);
    return;
  }
  await recordCron(env, true);
  const now = Date.now();
  const signature = buildStatusSignature(data);

  if (!previous) {
    const seedFailures = await notifyUsers(env, data, now, now, true);
    if (seedFailures) {
      console.error("[notify] initial state seed failed; not advancing snapshot yet");
      return;
    }
    await writeCache(env.DB, data, now, signature);
    return;
  }

  const changed = previous.signature !== signature;
  const lastCheckAt = previous.fetchedAt || 0;
  const retrySince = typeof previous.pendingRetry === "number" ? previous.pendingRetry : (previous.pendingRetry === true ? now : 0);
  const needsRetryPass = retrySince > 0 && now - retrySince < RETRY_WINDOW_MS;
  const retryBefore = needsRetryPass ? retrySince : 0;

  let hadFailures = false;
  if (changed || needsRetryPass) {
    hadFailures = await notifyUsers(env, data, now, lastCheckAt);
  }

  const retryAfter = hadFailures ? (retryBefore || now) : 0;
  // Write the snapshot only after dispatch. fetchedAt doubles as the last
  // successful upstream check, so a long outage is visible to clear-approximate
  // messages on the next transition.
  await writeCache(env.DB, data, now, signature, retryAfter);
}

function buildTransitionText(user, location, oldStatus, newStatus, now, lastCheckedAt) {
  const m = M(user.lang);
  const region = location.region_name || defaultLocationName(location.oblast_key, location.district_key);
  const rn = escapeHtml(region);
  if (newStatus.state !== "clear") return stateMessage(region, newStatus, user.lang);

  const start = oldStatus.since || null;
  const detectionGap = lastCheckedAt ? now - lastCheckedAt : Infinity;
  if (detectionGap > DETECTION_GAP_MS) {
    return m.clearApprox
      ? m.clearApprox(rn, start ? formatTimeKyiv(new Date(start)) : null, formatTimeKyiv(new Date(now)))
      : m.clear(rn);
  }

  const startTs = start ? new Date(start).getTime() : NaN;
  if (!Number.isFinite(startTs)) return m.clear(rn);
  const startMinuteMs = Math.floor(startTs / 60000) * 60000;
  const nowMinuteMs = Math.floor(now / 60000) * 60000;
  const duration = formatDuration(nowMinuteMs - startMinuteMs, user.lang);
  return duration
    ? m.clearEnd(rn, formatTimeKyiv(new Date(start)), formatTimeKyiv(new Date(now)), duration)
    : m.clear(rn);
}

async function deliverUserChanges(env, job, now, lastCheckedAt) {
  const { user, changes } = job;
  const key = `user:${user.chat_id}`;
  const states = user.location_states && typeof user.location_states === "object"
    ? { ...user.location_states }
    : {};
  let hadFailures = false;

  for (const change of changes) {
    const { location, oldStatus, newStatus } = change;
    const locationId = locationKey(location);
    const text = buildTransitionText(user, location, oldStatus, newStatus, now, lastCheckedAt);
    const occurrence = newStatus.state === "clear"
      ? (oldStatus.since || oldStatus.end || "")
      : (newStatus.since || String(now));
    const dedupeName = `notified:${user.chat_id}:${locationId}:${newStatus.state}:${occurrence}`;

    const claimed = await tryClaimNotification(env.DB, dedupeName);
    const res = !claimed ? { ok: true, permanent: false, status: 0 } : await sendTelegramTracked(env, user.chat_id, text);
    if (!res.ok) {
      if (claimed) await releaseNotificationClaim(env.DB, dedupeName);
      console.error(`[notify] delivery failed for chat ${user.chat_id} (${locationId}), will retry`);
      hadFailures = true;
      continue;
    }

    if (newStatus.state === "clear") {
      states[locationId] = {
        state: "clear",
        since: oldStatus.since || (states[locationId] && states[locationId].since) || null,
        end: new Date(now).toISOString()
      };
    } else {
      states[locationId] = {
        state: newStatus.state,
        since: newStatus.since || (states[locationId] && states[locationId].since) || new Date(now).toISOString(),
        end: null
      };
    }
  }

  user.location_states = states;
  applyLegacyFields(user);
  user.last_check = new Date(now).toISOString();
  try {
    await writeUser(env, key, user);
  } catch (e) {
    console.error("[notify] could not save user state:", e);
    return false;
  }
  return !hadFailures;
}

async function notifyUsers(env, data, now, lastCheckedAt, seedOnly = false) {
  const jobs = [];
  const PAGE_SIZE = 500;
  let offset = 0;
  let hadFailures = false;

  try {
    while (true) {
      const rows = await listUsersPage(env, offset, PAGE_SIZE, true);
      if (!rows.length) break;
      for (const row of rows) {
        const user = rowToUser(row);
        if (!user || !user.chat_id) continue;
        if (user.notify === false) continue;

        const locations = userLocations(user);
        if (!locations.length) continue;

        const states = user.location_states && typeof user.location_states === "object"
          ? { ...user.location_states }
          : {};
        const legacy = locations.length === 1 && user.last_alert_state
          ? { state: user.last_alert_state, since: user.last_alert_start || null, end: user.last_alert_end || null }
          : null;
        const changes = [];
        let dirty = false;

        for (const location of locations) {
          const locationId = locationKey(location);
          const newStatus = alertStatus(data, location.oblast_key, location.district_key);
          let known = states[locationId];

          if (seedOnly) {
            states[locationId] = { state: newStatus.state, since: newStatus.since || null, end: null };
            dirty = true;
            continue;
          }

          if (!known || typeof known !== "object") {
            if (legacy) {
              known = { ...legacy };
            } else {
              known = { state: newStatus.state, since: newStatus.since || null, end: null };
            }
            states[locationId] = known;
            dirty = true;
          }

          if ((known.state || "clear") !== newStatus.state) {
            changes.push({
              location,
              oldStatus: { state: known.state || "clear", since: known.since || null, end: known.end || null },
              newStatus
            });
          } else if ((known.since || null) !== (newStatus.since || null)) {
            states[locationId] = { ...known, since: newStatus.since || known.since || null };
            dirty = true;
          }
        }

        user.location_states = states;
        if (changes.length) {
          jobs.push({ user, changes });
        } else if (dirty) {
          applyLegacyFields(user);
          user.last_check = new Date(now).toISOString();
          try {
            await writeUser(env, `user:${user.chat_id}`, user);
          } catch (e) {
            console.error(`[notify] could not seed state for chat ${user.chat_id}:`, e);
            hadFailures = true;
          }
        }
      }
      offset += rows.length;
      if (rows.length < PAGE_SIZE) break;
    }
  } catch (e) {
    console.error("[notify] could not list users:", e);
    return true;
  }

  for (let i = 0; i < jobs.length; i += SEND_CONCURRENCY) {
    const results = await Promise.all(jobs.slice(i, i + SEND_CONCURRENCY).map(job =>
      deliverUserChanges(env, job, now, lastCheckedAt).catch(e => {
        console.error("[notify] deliver error:", e);
        return false;
      })
    ));
    if (results.some(ok => !ok)) hadFailures = true;
  }
  return hadFailures;
}

function formatDuration(ms, lang) {
  const u = M(lang).units;
  const value = Number(ms);
  if (!Number.isFinite(value)) return null;
  const seconds = Math.max(0, Math.round(value / 1000));
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${mins} ${u.m}`;
  if (mins === 0) return `${hours} ${u.h}`;
  return `${hours} ${u.h} ${mins} ${u.m}`;
}

const TEXTS = {
  uk: {
    connected: "🟢 Telegram-бот підключено",
    linking: "⏳ Зачекай трохи, підключаємо сповіщення…",
    genericStart: "Щоб підключити сповіщення, натисни кнопку в налаштуваннях плагіна Air Raid Alert.",
    subscribed: region => `✅ Підписка активна: <b>${region}</b>`,
    clear: region => `🟢 <b>Тривоги немає</b>\n${region}`,
    yellow: (region, time) => `🟡 <b>Жовтий рівень загрози</b>\n${region} • ${time}`,
    red: (region, time) => `🔴 <b>Червоний рівень загрози</b>\n${region} • ${time}`,
    clearEnd: (region, start, end, duration) => `🟢 <b>Тривоги немає</b>\n${region} • ${start}–${end} • ${duration}`,
    clearApprox: (region, start, detectedAt) => `🟢 <b>Тривоги більше немає</b>\n${region}${start ? ` • почалась ${start}` : ""}\nТочний час відбою невідомий через перерву в роботі сервісу (зафіксовано о ${detectedAt})`,
    enabled: "✅ Сповіщення через Telegram увімкнено",
    unsubscribed: "❌ Сповіщення через Telegram вимкнено",
    test: "⚪ Це тестове повідомлення від Air Raid Alert.",
    statusNoRegion: "⚪ Регіон ще не обрано.\nВідкрий налаштування плагіна Air Raid Alert і обери область.",
    statusHeader: region => `📍 <b>${region}</b>`,
    units: { h: "год", m: "хв" }
  },
  ru: {
    connected: "🟢 Telegram-бот подключён",
    linking: "⏳ Подожди немного, подключаем уведомления…",
    genericStart: "Чтобы подключить уведомления, нажмите кнопку в настройках плагина Air Raid Alert.",
    subscribed: region => `✅ Подписка активна: <b>${region}</b>`,
    clear: region => `🟢 <b>Тревоги нет</b>\n${region}`,
    yellow: (region, time) => `🟡 <b>Жёлтый уровень угрозы</b>\n${region} • ${time}`,
    red: (region, time) => `🔴 <b>Красный уровень угрозы</b>\n${region} • ${time}`,
    clearEnd: (region, start, end, duration) => `🟢 <b>Тревоги нет</b>\n${region} • ${start}–${end} • ${duration}`,
    clearApprox: (region, start, detectedAt) => `🟢 <b>Тревоги больше нет</b>\n${region}${start ? ` • началась ${start}` : ""}\nТочное время отбоя неизвестно из-за перерыва в работе сервиса (зафиксировано в ${detectedAt})`,
    enabled: "✅ Уведомления через Telegram включены",
    unsubscribed: "❌ Уведомления через Telegram отключены",
    test: "⚪ Это тестовое сообщение от Air Raid Alert.",
    statusNoRegion: "⚪ Регион ещё не выбран.\nОткрой настройки плагина Air Raid Alert и выбери область.",
    statusHeader: region => `📍 <b>${region}</b>`,
    units: { h: "ч", m: "мин" }
  },
  en: {
    connected: "🟢 Telegram bot connected",
    linking: "⏳ Please wait a moment, connecting notifications…",
    genericStart: "To connect notifications, tap the button in the Air Raid Alert plugin settings.",
    subscribed: region => `✅ Subscription active: <b>${region}</b>`,
    clear: region => `🟢 <b>All clear</b>\n${region}`,
    yellow: (region, time) => `🟡 <b>Yellow threat level</b>\n${region} • ${time}`,
    red: (region, time) => `🔴 <b>Red threat level</b>\n${region} • ${time}`,
    clearEnd: (region, start, end, duration) => `🟢 <b>All clear</b>\n${region} • ${start}–${end} • ${duration}`,
    clearApprox: (region, start, detectedAt) => `🟢 <b>All clear</b>\n${region}${start ? ` • started ${start}` : ""}\nExact end time unknown due to a service interruption (detected at ${detectedAt})`,
    enabled: "✅ Telegram notifications enabled",
    unsubscribed: "❌ Telegram notifications disabled",
    test: "⚪ This is a test message from Air Raid Alert.",
    statusNoRegion: "⚪ No region selected yet.\nOpen the Air Raid Alert plugin settings and choose an oblast.",
    statusHeader: region => `📍 <b>${region}</b>`,
    units: { h: "h", m: "min" }
  }
};

function normLang(v) {
  const l = String(v || "").toLowerCase().slice(0, 2);
  return l === "ru" || l === "en" || l === "uk" ? l : "en";
}
function M(lang) { return TEXTS[normLang(lang)]; }

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function trimLen(s, n) {
  s = String(s || "").trim();
  return s.slice(0, n) || null;
}

async function sendTelegramDetailed(botToken, chatId, text) {
  if (!botToken) {
    console.error("[telegram] BOT_TOKEN not set");
    return { ok: false, permanent: false, status: 0 };
  }
  const payload = JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" });
  const doSend = () => fetchWithTimeout(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload
  }, FETCH_TIMEOUT_MS);
  try {
    let r = await doSend();
    if (r.status === 429) {
      let retryAfter = 1;
      try {
        const body = await r.clone().json();
        retryAfter = (body && body.parameters && body.parameters.retry_after) || 1;
      } catch (_) {}
      await new Promise(res => setTimeout(res, Math.min(retryAfter, 3) * 1000));
      r = await doSend();
    }
    let body = null;
    try { body = await r.json(); } catch (_) {}
    if (!r.ok || !body || body.ok !== true) {
      console.error(`[telegram] sendMessage HTTP ${r.status}:`, body && body.description || `HTTP ${r.status}`);
      const permanent = r.status === 400 || r.status === 403 || r.status === 404;
      return { ok: false, permanent, status: r.status, description: body && body.description };
    }
    return { ok: true, permanent: false, status: r.status, result: body.result || null };
  } catch (e) {
    console.error("[telegram] sendMessage error:", e);
    return { ok: false, permanent: false, status: 0 };
  }
}

async function sendTelegramTracked(env, chatId, text) {
  return await sendTelegramDetailed(env.BOT_TOKEN, chatId, text);
}

const USER_COLUMNS = "chat_id, sync_token, oblast_key, district_key, region_name, lang, notify, telegram_connected, registered_at, last_activity, last_check, last_alert_state, last_alert_active, last_alert_start, last_alert_end, raw";

function keyToChatId(key) {
  return key && String(key).startsWith("user:") ? String(key).slice(5) : null;
}

function rowToUser(row) {
  if (!row) return null;
  let extra = {};
  if (row.raw) {
    try { const parsed = JSON.parse(row.raw); if (parsed && typeof parsed === "object") extra = parsed; } catch (e) { }
  }
  return {
    ...extra,
    chat_id: row.chat_id,
    sync_token: row.sync_token,
    oblast_key: row.oblast_key,
    district_key: row.district_key,
    region_name: row.region_name,
    lang: row.lang,
    notify: row.notify !== 0,
    telegram_connected: !!row.telegram_connected,
    registered_at: row.registered_at,
    last_activity: row.last_activity,
    last_check: row.last_check,
    last_alert_state: row.last_alert_state,
    last_alert_active: row.last_alert_active === null || row.last_alert_active === undefined ? undefined : !!row.last_alert_active,
    last_alert_start: row.last_alert_start,
    last_alert_end: row.last_alert_end,
    locations: Array.isArray(extra.locations) ? extra.locations : [],
    location_states: extra.location_states && typeof extra.location_states === "object" ? extra.location_states : {},
    sessions: Array.isArray(extra.sessions) ? extra.sessions : []
  };
}

function userToRow(chatId, user) {
  const rawUser = { ...user };
  delete rawUser.raw;
  return [
    String(chatId),
    user.sync_token || null,
    user.oblast_key || null,
    user.district_key || null,
    user.region_name || null,
    user.lang || null,
    user.notify === false ? 0 : 1,
    user.telegram_connected ? 1 : 0,
    user.registered_at || null,
    user.last_activity || null,
    user.last_check || null,
    user.last_alert_state || null,
    user.last_alert_active === true ? 1 : (user.last_alert_active === false ? 0 : null),
    user.last_alert_start || null,
    user.last_alert_end || null,
    JSON.stringify(rawUser)
  ];
}

async function readUser(env, key, strict = false) {
  const chatId = keyToChatId(key);
  if (!chatId) return null;
  try {
    const row = await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE chat_id = ?1`).bind(chatId).first();
    return rowToUser(row);
  } catch (e) {
    console.error(`[user] read error for ${key}:`, e);
    if (strict) throw e;
    return null;
  }
}

async function writeUser(env, key, user) {
  const chatId = keyToChatId(key) || String(user.chat_id);
  try {
    const vals = userToRow(chatId, user);
    await env.DB.prepare(
      `INSERT INTO users (${USER_COLUMNS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
       ON CONFLICT(chat_id) DO UPDATE SET
         sync_token=excluded.sync_token, oblast_key=excluded.oblast_key, district_key=excluded.district_key,
         region_name=excluded.region_name, lang=excluded.lang, notify=excluded.notify,
         telegram_connected=excluded.telegram_connected, registered_at=excluded.registered_at,
         last_activity=excluded.last_activity, last_check=excluded.last_check,
         last_alert_state=excluded.last_alert_state, last_alert_active=excluded.last_alert_active,
         last_alert_start=excluded.last_alert_start, last_alert_end=excluded.last_alert_end, raw=excluded.raw`
    ).bind(...vals).run();
  } catch (e) {
    console.error(`[user] write error for ${key}:`, e);
    throw e;
  }
}

async function deleteUser(env, chatId) {
  try {
    await env.DB.prepare("DELETE FROM users WHERE chat_id = ?1").bind(String(chatId)).run();
  } catch (e) {
    console.error(`[user] delete error for ${chatId}:`, e);
    throw e;
  }
}

async function listUsersPage(env, offset, limit, strict = false) {
  try {
    const res = await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY chat_id LIMIT ?1 OFFSET ?2`).bind(limit, offset).all();
    return (res && res.results) || [];
  } catch (e) {
    console.error("[user] list error:", e);
    if (strict) throw e;
    return [];
  }
}

async function getDeviceLink(env, deviceId) {
  try {
    const row = await env.DB.prepare("SELECT chat_id, lang, sync_token, connected_at, expires_at FROM device_links WHERE device_id = ?1").bind(deviceId).first();
    if (!row) return null;
    if (row.expires_at && Number(row.expires_at) < Date.now()) {
      env.DB.prepare("DELETE FROM device_links WHERE device_id = ?1").bind(deviceId).run().catch(() => { });
      return null;
    }
    return { chat_id: row.chat_id, lang: row.lang, sync_token: row.sync_token, connected_at: row.connected_at };
  } catch (e) {
    console.error(`[device] read error for ${deviceId}:`, e);
    return null;
  }
}

async function putDeviceLink(env, deviceId, value, ttlSeconds) {
  try {
    await env.DB.prepare(
      `INSERT INTO device_links (device_id, chat_id, lang, sync_token, connected_at, expires_at) VALUES (?1,?2,?3,?4,?5,?6)
       ON CONFLICT(device_id) DO UPDATE SET chat_id=excluded.chat_id, lang=excluded.lang, sync_token=excluded.sync_token, connected_at=excluded.connected_at, expires_at=excluded.expires_at`
    ).bind(deviceId, value.chat_id, value.lang, value.sync_token, value.connected_at, Date.now() + ttlSeconds * 1000).run();
  } catch (e) {
    console.error(`[device] write error for ${deviceId}:`, e);
    throw e;
  }
}

async function deleteDeviceLink(env, deviceId) {
  try {
    await env.DB.prepare("DELETE FROM device_links WHERE device_id = ?1").bind(deviceId).run();
  } catch (e) {
    console.error(`[device] delete error for ${deviceId}:`, e);
  }
}

async function randomToken() {
  const bytes = new Uint8Array(SYNC_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

async function checkAndSetEphemeralFlag(name, ttlSeconds) {
  // Fail-open: a cache failure must never block webhook processing or
  // registration. Worst case a rate limit is not applied or an update is
  // processed twice; both are harmless compared with dropping the update.
  try {
    const url = `https://ephemeral-flags.internal/${encodeURIComponent(name)}`;
    const key = new Request(url);
    const existing = await caches.default.match(key);
    if (existing) return false;
    const resp = new Response("1", { headers: { "Cache-Control": `max-age=${ttlSeconds}` } });
    await caches.default.put(key, resp);
    return true;
  } catch (e) {
    console.error(`[flags] cache unavailable for ${name}:`, e);
    return true;
  }
}

async function hasEphemeralFlag(name) {
  try { return !!(await caches.default.match(new Request(`https://ephemeral-flags.internal/${encodeURIComponent(name)}`))); }
  catch (e) { return false; }
}

async function setEphemeralFlag(name, ttlSeconds) {
  try {
    await caches.default.put(
      new Request(`https://ephemeral-flags.internal/${encodeURIComponent(name)}`),
      new Response("1", { headers: { "Cache-Control": `max-age=${ttlSeconds}` } })
    );
  } catch (e) { }
}

async function markUpdateProcessed(env, updateId) {
  if (updateId === undefined || updateId === null) return true;
  return await checkAndSetEphemeralFlag(`tg-update:${updateId}`, UPDATE_DEDUP_TTL_SECONDS);
}

function validSyncToken(existing, token) {
  return isValidToken(existing, token);
}

const WEBHOOK_SECRET_KEY = "webhook-secret";

async function getWebhookSecret(env) {
  if (env.WEBHOOK_SECRET) return String(env.WEBHOOK_SECRET);
  try {
    const row = await env.DB.prepare("SELECT value FROM cache_kv WHERE key = ?1").bind(WEBHOOK_SECRET_KEY).first();
    if (row && row.value) return String(row.value);
    const secret = await randomToken();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO cache_kv (key, value, updated_at) VALUES (?1, ?2, ?3)"
    ).bind(WEBHOOK_SECRET_KEY, secret, Date.now()).run();
    const stored = await env.DB.prepare("SELECT value FROM cache_kv WHERE key = ?1").bind(WEBHOOK_SECRET_KEY).first();
    return stored && stored.value ? String(stored.value) : secret;
  } catch (e) {
    console.error("[webhook] secret storage unavailable, registering webhook without secret:", e);
    return null;
  }
}

function telegramWebhookUrl(request) {
  const target = new URL(request.url);
  target.pathname = "/telegram/webhook";
  target.search = "";
  return target.toString();
}

async function registerTelegramWebhook(env, webhookUrl, dropPending = false) {
  if (!env.BOT_TOKEN) return { ok: false, error: "BOT_TOKEN not configured" };
  const secret = await getWebhookSecret(env);
  const setUrl = new URL(`${TELEGRAM_API}${env.BOT_TOKEN}/setWebhook`);
  setUrl.searchParams.set("url", webhookUrl);
  setUrl.searchParams.set("allowed_updates", JSON.stringify(["message", "callback_query"]));
  if (dropPending) setUrl.searchParams.set("drop_pending_updates", "true");
  if (secret) setUrl.searchParams.set("secret_token", secret);
  const r = await fetchWithTimeout(setUrl.toString(), {}, FETCH_TIMEOUT_MS);
  let body = null;
  try { body = await r.json(); } catch (e) { }
  const ok = !!(r.ok && body && body.ok);
  console.log(`[webhook] setWebhook ${ok ? "ok" : "failed"} url=${webhookUrl} secret=${secret ? "yes" : "no"}`);
  return { ok, secretConfigured: !!secret, webhook_url: webhookUrl, status: r.status, telegram_response: body };
}

async function repairWebhook(request, env) {
  if (!(await checkAndSetEphemeralFlag("webhook-repair", 60))) return;
  try {
    await registerTelegramWebhook(env, telegramWebhookUrl(request), false);
  } catch (e) {
    console.error("[webhook] self-repair failed:", e);
  }
}

async function handleTelegramWebhook(request, env, ctx = null) {
  try {
    return await handleTelegramWebhookInner(request, env, ctx);
  } catch (e) {
    console.error("[webhook] handler error:", e);
    return json({ ok: true, error: "logged" });
  }
}

async function handleTelegramWebhookInner(request, env, ctx = null) {
  const expectedSecret = await getWebhookSecret(env);
  if (expectedSecret) {
    const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
    if (!safeEqual(got, expectedSecret)) {
      // The worker requires a secret but Telegram delivered the update without
      // it (the webhook was registered by an older build, or with another
      // value). Re-register the webhook with the correct secret in the
      // background and let Telegram retry; otherwise /start never arrives and
      // every new user is stuck at "missing device link".
      const task = repairWebhook(request, env);
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(task);
      else await task;
      return json({ ok: false, error: "invalid webhook secret", auto_repair: true }, 401);
    }
  }

  let update;
  try {
    update = await request.json();
  } catch (e) {
    return json({ ok: false }, 400);
  }

  if (!(await markUpdateProcessed(env, update.update_id))) return json({ ok: true, duplicate: true });

  const message = update.message || update.channel_post || update.edited_message || update.edited_channel_post;
  if (!message || !message.chat) return json({ ok: true });
  if (message.chat.type === "private" && message.from && message.from.id != null && String(message.from.id) === String(message.chat.id)) {
    try {
      const key = `user:${message.chat.id}`;
      const user = await readUser(env, key);
      if (user) await writeUser(env, key, {
        ...user,
        telegram_username: message.from.username ? String(message.from.username).slice(0, 64) : (user.telegram_username || null),
        telegram_first_name: message.from.first_name ? String(message.from.first_name).slice(0, 64) : (user.telegram_first_name || null),
        telegram_last_name: message.from.last_name ? String(message.from.last_name).slice(0, 64) : (user.telegram_last_name || null),
        last_activity: new Date().toISOString(),
        telegram_connected: true
      });
    } catch (e) { console.error("[telegram] user activity update failed:", e); }
  }
  if (!message.text) return json({ ok: true });

  const chatId = message.chat.id;
  const parts = message.text.trim().split(/\s+/);
  const command = parts[0];
  const payload = parts[1];

  if (command === "/start" && payload) {
    const dashIdx = payload.lastIndexOf("-");
    const suffix = dashIdx > 0 ? payload.slice(dashIdx + 1).toLowerCase() : "";
    const hasLangSuffix = suffix === "uk" || suffix === "ru" || suffix === "en";
    const deviceId = hasLangSuffix ? payload.slice(0, dashIdx) : payload;
    const lang = normLang(hasLangSuffix ? suffix : (message.from && message.from.language_code));

    if (!/^[a-zA-Z0-9-]{1,64}$/.test(deviceId)) {
      await sendTelegramTracked(env, chatId, M(lang).genericStart);
    } else {
      await sendTelegramTracked(env, chatId, M(lang).linking);
      const existingLink = await getDeviceLink(env, deviceId);
      if (existingLink && String(existingLink.chat_id) !== String(chatId)) {
        console.warn(`[telegram] device link ${deviceId} already linked to another chat, keeping existing binding`);
      } else {
        const syncToken = await randomToken();
        await putDeviceLink(
          env,
          deviceId,
          { chat_id: String(chatId), lang, sync_token: syncToken, connected_at: new Date().toISOString() },
          DEVICE_LINK_TTL_SECONDS
        );
      }
    }
  } else if (command === "/start") {
    const existing = await readUser(env, `user:${chatId}`);
    const lang = normLang((existing && existing.lang) || (message.from && message.from.language_code));
    await sendTelegramTracked(env, chatId, M(lang).genericStart);
  } else if (command === "/status") {
    const user = await readUser(env, `user:${chatId}`);
    const lang = normLang((user && user.lang) || (message.from && message.from.language_code));
    const m = M(lang);
    if (!user || !user.oblast_key) {
      await sendTelegramTracked(env, chatId, m.statusNoRegion);
    } else {
      try {
        const snapshot = await getSharedSnapshot(env);
        const status = alertStatus(snapshot.data, user.oblast_key, user.district_key);
        await sendTelegramTracked(env, chatId, stateMessage(user.region_name || user.oblast_key, status, lang));
      } catch (e) {
        console.error("[status] on-demand status failed:", e);
      }
    }
  }

  return json({ ok: true });
}

async function handleSetupWebhook(request, env) {
  if (!env.BOT_TOKEN) {
    return json({ ok: false, error: "BOT_TOKEN not configured" }, 500);
  }
  try {
    const result = await registerTelegramWebhook(env, telegramWebhookUrl(request), true);
    return json(result);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 502);
  }
}

function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
const ADMIN_SESSION_SEC = 7 * 24 * 3600;
const ADMIN_MAX_FAILS = 5;
const ADMIN_FAIL_WINDOW_SEC = 600;

async function hmacHex(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
  return Array.from(sig).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function makeSession(env, ttlSec) {
  const exp = Date.now() + ttlSec * 1000;
  return `${exp}.${await hmacHex(env.ADMIN_TOKEN, "adm:" + exp)}`;
}
async function isAdmin(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  const h = request.headers.get("Authorization") || "";
  if (h.startsWith("Bearer ") && safeEqual(h.slice(7), env.ADMIN_TOKEN)) return true;
  const m = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)adm=([^;]+)/);
  if (!m) return false;
  const dot = m[1].indexOf(".");
  if (dot < 1) return false;
  const exp = Number(m[1].slice(0, dot));
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  return safeEqual(m[1].slice(dot + 1), await hmacHex(env.ADMIN_TOKEN, "adm:" + exp));
}
const failMem = new Map();
async function failCount(ip) {
  const m = failMem.get(ip);
  if (m && m.until > Date.now()) return m.n;
  if (m) failMem.delete(ip);
  try {
    const r = await caches.default.match(new Request(`https://admin-fail.internal/${encodeURIComponent(ip)}`));
    return r ? Number(await r.text()) || 0 : 0;
  } catch (e) { return 0; }
}
async function bumpFail(ip, n) {
  failMem.set(ip, { n, until: Date.now() + ADMIN_FAIL_WINDOW_SEC * 1000 });
  if (failMem.size > 500) for (const [k, v] of failMem) if (v.until < Date.now()) failMem.delete(k);
  try {
    await caches.default.put(new Request(`https://admin-fail.internal/${encodeURIComponent(ip)}`),
      new Response(String(n), { headers: { "Cache-Control": `max-age=${ADMIN_FAIL_WINDOW_SEC}` } }));
  } catch (e) { }
}
function loginPage(msg, status = 200) {
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101014"><title>Вход</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101014;background-image:radial-gradient(900px 520px at 20% -10%,#1d1b2c 0%,#101014 60%);background-attachment:fixed;color:#e5e5eb;font:400 15px/22px Roboto,system-ui,sans-serif}
 form{background:rgba(28,27,34,0.66);border:1px solid rgba(63,62,76,0.85);border-radius:32px;padding:32px 28px;width:min(360px,calc(100% - 40px));display:grid;gap:18px;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 24px 48px rgba(0,0,0,0.45)}
 h1{margin:0;font:600 28px/36px Roboto,system-ui,sans-serif;letter-spacing:-0.5px;background:linear-gradient(to right,#e5e5eb,#aeabd9);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
 p{margin:0;color:#adacb9}.e{color:#f4a3a3}
 input{background:rgba(174,171,217,0.06);border:1px solid rgba(63,62,76,0.9);border-radius:16px;height:52px;padding:0 16px;color:#e5e5eb;font-size:16px;outline:0}
 input:focus{border-color:#aeabd9;box-shadow:0 0 0 4px rgba(174,171,217,0.2)}
 .tools{display:flex;gap:8px}.tools button{flex:1;height:40px;background:rgba(174,171,217,0.08);border:1px solid rgba(63,62,76,0.9);border-radius:14px;color:#e5e5eb;font:500 14px Roboto,system-ui,sans-serif;cursor:pointer}
 .h{font-size:12px;min-height:16px;color:#adacb9}
 button{height:44px;border:0;border-radius:12px;background:#aeabd9;color:#1d1a42;font:600 15px Roboto,system-ui,sans-serif;cursor:pointer}
 button:active{transform:translateY(1px)}</style></head>
<body><form method="post" action="/admin/login"><h1>Air Raid Worker</h1><p>Панель владельца. Введите пароль.</p>
${msg ? `<p class="e">${msg}</p>` : ""}
<input id="pw" type="password" name="password" autocomplete="current-password" placeholder="Пароль" autofocus required>
<div class="tools"><button type="button" id="eye">Показать</button><button type="button" id="paste">Вставить</button></div>
<button type="submit">Войти</button><p class="h" id="hint"></p></form>
<script>
var pw=document.getElementById("pw"),eye=document.getElementById("eye"),hint=document.getElementById("hint");
function show(on){pw.type=on?"text":"password";eye.textContent=on?"Скрыть":"Показать"}
eye.onclick=function(){show(pw.type==="password");pw.focus()};
document.getElementById("paste").onclick=function(){
  function manual(){show(true);pw.focus();hint.textContent="Нажмите в поле, затем «Вставить» (или значок буфера на клавиатуре)."}
  if(navigator.clipboard&&navigator.clipboard.readText){
    navigator.clipboard.readText().then(function(t){t=(t||"").trim();if(t){pw.value=t;pw.focus();hint.textContent=""}else{hint.textContent="Буфер обмена пуст"}}).catch(manual)
  }else manual()};
</script></body></html>`;
  return new Response(html, { status, headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex"
  } });
}
async function handleLogin(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const fails = await failCount(ip);
  if (fails >= ADMIN_MAX_FAILS) return loginPage("Слишком много попыток. Подождите 10 минут.", 429);
  let pw = "";
  try {
    if ((request.headers.get("Content-Type") || "").includes("application/json")) pw = (await request.json()).password;
    else pw = (await request.formData()).get("password");
  } catch (e) { }
  if (!safeEqual(String(pw || "").trim(), String(env.ADMIN_TOKEN).trim())) {
    await bumpFail(ip, fails + 1);
    await new Promise(r => setTimeout(r, 800));
    return loginPage("Неверный пароль", 401);
  }
  const value = await makeSession(env, ADMIN_SESSION_SEC);
  return new Response(null, { status: 302, headers: {
    Location: "/admin", "Cache-Control": "no-store",
    "Set-Cookie": `adm=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_SESSION_SEC}`
  } });
}
function adminJson(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function sqlEscape(v) {
  if (v === null || v === undefined || v === "") return "NULL";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

async function buildUsersExportSQL(env, overwrite) {
  // Бэкап/перенос таблицы users из D1 в виде SQL-файла (KV больше не используется,
  // источник данных — сама таблица D1; полезно для переноса на другую базу).
  const conflict = overwrite
    ? "DO UPDATE SET sync_token=excluded.sync_token, oblast_key=excluded.oblast_key, district_key=excluded.district_key, region_name=excluded.region_name, lang=excluded.lang, notify=excluded.notify, telegram_connected=excluded.telegram_connected, registered_at=excluded.registered_at, last_activity=excluded.last_activity, last_check=excluded.last_check, last_alert_state=excluded.last_alert_state, last_alert_active=excluded.last_alert_active, last_alert_start=excluded.last_alert_start, last_alert_end=excluded.last_alert_end, raw=excluded.raw"
    : "DO NOTHING";
  const lines = [];
  const PAGE_SIZE = 500;
  let offset = 0, count = 0, guard = 0;
  while (true) {
    const rows = await listUsersPage(env, offset, PAGE_SIZE);
    if (!rows.length) break;
    for (const row of rows) {
      const vals = [
        sqlEscape(row.chat_id),
        sqlEscape(row.sync_token),
        sqlEscape(row.oblast_key),
        sqlEscape(row.district_key),
        sqlEscape(row.region_name),
        sqlEscape(row.lang),
        row.notify === 0 ? "0" : "1",
        row.telegram_connected ? "1" : "0",
        sqlEscape(row.registered_at),
        sqlEscape(row.last_activity),
        sqlEscape(row.last_check),
        sqlEscape(row.last_alert_state),
        row.last_alert_active === null || row.last_alert_active === undefined ? "NULL" : (row.last_alert_active ? "1" : "0"),
        sqlEscape(row.last_alert_start),
        sqlEscape(row.last_alert_end),
        sqlEscape(row.raw)
      ];
      lines.push(`INSERT INTO users (${USER_COLUMNS}) VALUES (${vals.join(", ")}) ON CONFLICT(chat_id) ${conflict};`);
      count++;
    }
    offset += rows.length;
    if (rows.length < PAGE_SIZE) break;
    if (++guard >= 200) break;
  }
  return { sql: lines.join("\n"), count };
}

async function collectUsers(env, data, strict = false) {
  const st = { total: 0, notifyOff: 0, noRegion: 0, multi: 0, byLang: {}, byState: {}, pending: 0, byOblast: {}, truncated: false };
  const PAGE_SIZE = 500;
  let offset = 0, pages = 0;
  while (true) {
    const rows = await listUsersPage(env, offset, PAGE_SIZE, strict);
    if (!rows.length) break;
    for (const row of rows) {
      const u = rowToUser(row);
      if (!u) continue;
      st.total++;
      if (u.notify === false) st.notifyOff++;
      const locations = userLocations(u);
      if (!locations.length) { st.noRegion++; continue; }
      if (locations.length > 1) st.multi++;
      const lang = normLang(u.lang);
      st.byLang[lang] = (st.byLang[lang] || 0) + 1;
      let pending = false;
      let worst = "clear";
      for (const location of locations) {
        const knownState = u.location_states && u.location_states[locationKey(location)];
        const known = knownState && knownState.state
          ? knownState.state
          : (locations.length === 1 ? (u.last_alert_state || "clear") : "clear");
        if (known === "red") worst = "red";
        else if (known === "yellow" && worst !== "red") worst = "yellow";
        if (data && u.notify !== false && alertStatus(data, location.oblast_key, location.district_key).state !== known) pending = true;
      }
      st.byState[worst] = (st.byState[worst] || 0) + 1;
      st.byOblast[locations[0].oblast_key] = (st.byOblast[locations[0].oblast_key] || 0) + 1;
      if (pending) st.pending++;
    }
    offset += rows.length;
    if (rows.length < PAGE_SIZE) break;
    if (++pages >= 20) { st.truncated = true; break; }
  }
  st.byOblast = Object.entries(st.byOblast).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => ({ key: k, name: OBLAST_NAMES_UK[k] || k, n }));
  return st;
}

async function adminData(env, request, full, kvTest, probeUp) {
  const out = {
    version: WORKER_VERSION, time: new Date().toISOString(), langs: Object.keys(TEXTS),
    bindings: { alertsKey: !!env.ALERTS_API_KEY, botToken: !!env.BOT_TOKEN, db: !!env.DB },
    regions: { o: OBLAST_NAMES_UK, d: DISTRICT_NAMES_UK },
    config: { edgeTtl: EDGE_CACHE_TTL_SECONDS, cacheWriteIntervalSec: MIN_CACHE_WRITE_INTERVAL_SECONDS, retryWindowSec: RETRY_WINDOW_MS / 1000 }
  };
  const c = await readCache(env.DB);
  try { const cronRaw = await d1GetKV(env.DB, CRON_STATUS_KEY); out.cron = cronRaw ? JSON.parse(cronRaw) : null; } catch (e) { out.cron = null; }
  out.maintenance = await getMaintenance(env);
  out.dbSchema = await checkSchema(env.DB);
  out.snapshot = c ? {
    fetchedAt: c.fetchedAt, ageSeconds: Math.round((Date.now() - (c.fetchedAt || 0)) / 1000),
    pendingRetry: c.pendingRetry || 0, signature: c.signature,
    oblasts: c.data.oblasts, raions: c.data.raions
  } : null;
  try {
    const u = new URL(request.url); u.pathname = "/api"; u.search = "";
    out.edgeCache = !!(await caches.default.match(new Request(u.toString(), { method: "GET" })));
  } catch (e) { out.edgeCache = null; }
  if (!full) return out;

  const timed = async (fn) => { const t = Date.now(); try { return { ok: true, ms: 0, ...(await fn()), _t: t }; } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 300), rateLimited: !!(e && e.status === 429), _t: t }; } };
  const [up, wh, users, kv] = await Promise.all([
    probeUp ? timed(async () => { const d = await fetchUpstreamShared(env, 45000); return { rawAlerts: (d.alerts || []).length, oblasts: d.oblasts.length, raions: d.raions.length, sameAsSnapshot: c ? c.signature === buildStatusSignature(d) : null }; }) : Promise.resolve(null),
    timed(async () => {
      if (!env.BOT_TOKEN) throw new Error("BOT_TOKEN not configured");
      const r = await fetchWithTimeout(`${TELEGRAM_API}${env.BOT_TOKEN}/getWebhookInfo`, {}, FETCH_TIMEOUT_MS);
      const j = await r.json();
      return { info: j.result || j };
    }),
    timed(async () => ({ stats: await collectUsers(env, c && c.data, true) })),
    kvTest ? timed(async () => { await d1PutKV(env.DB, "health-check", String(Date.now())); return {}; }) : Promise.resolve(null)
  ]);
  for (const x of [up, wh, users, kv]) if (x) { x.ms = Date.now() - x._t; delete x._t; }
  out.upstream = up; out.webhook = wh; out.users = users; out.kvWrite = kv;
  return out;
}

async function handleAdmin(request, env, url) {
  const p = url.pathname;
  if (!env.ADMIN_TOKEN) return new Response("Admin disabled: set the ADMIN_TOKEN secret", { status: 404 });

  if (p === "/admin/login" && request.method === "POST") return await handleLogin(request, env);
  if (p === "/admin/logout" && request.method === "POST") {
    return new Response(JSON.stringify({ ok: true }), { headers: {
      "Content-Type": "application/json", "Cache-Control": "no-store",
      "Set-Cookie": "adm=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
    } });
  }

  if (p === "/admin/export/users.sql" && request.method === "POST") {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const fails = await failCount(ip);
    if (fails >= ADMIN_MAX_FAILS) return adminJson({ error: "too many attempts, wait 10 minutes" }, 429);
    let pw = "";
    try {
      const ct = request.headers.get("Content-Type") || "";
      if (ct.includes("application/json")) pw = (await request.json()).password;
      else pw = (await request.formData()).get("password");
    } catch (e) { }
    if (!safeEqual(String(pw || "").trim(), String(env.ADMIN_TOKEN).trim())) {
      await bumpFail(ip, fails + 1);
      return adminJson({ error: "invalid admin token" }, 401);
    }
    const { sql, count } = await buildUsersExportSQL(env, url.searchParams.get("overwrite") === "1");
    console.log(`[admin] users.sql export (POST): ${count} rows`);
    return new Response(sql, { headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="users.sql"',
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex"
    } });
  }
  if (!(await isAdmin(request, env))) {
    if (p === "/admin" || p === "/admin/login") return loginPage("");
    return new Response("Unauthorized", { status: 401 });
  }

  const userMatch = p.match(/^\/admin\/users\/(-?\d+)$/);
  if (userMatch && request.method === "GET") {
    const id = userMatch[1];
    const user = await readUser(env, `user:${id}`);
    return adminJson({ok:true,telegram_id:id,profile:user||null,telegram_connected:!!(user && user.telegram_connected !== false)});
  }
  if (p === "/admin") return new Response(ADMIN_HTML, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex"
  } });
  if (p === "/admin/data") {
    try { return adminJson(await adminData(env, request, url.searchParams.get("full") === "1", url.searchParams.get("kv") === "1", url.searchParams.get("up") === "1")); }
    catch (e) { return adminJson({ error: String(e) }, 500); }
  }
  if (p === "/admin/export/users.sql") {
    const { sql, count } = await buildUsersExportSQL(env, url.searchParams.get("overwrite") === "1");
    console.log(`[admin] users.sql export: ${count} rows`);
    return new Response(sql, { headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="users.sql"',
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex"
    } });
  }
  if (p === "/admin/action" && request.method === "POST") {
    const name = url.searchParams.get("name");
    if (name === "init-schema") return json(await ensureSchema(env));
    if (name === "setup-webhook") return await handleSetupWebhook(request, env);
    if (name === "purge-edge") {
      const u = new URL(request.url); u.pathname = "/api"; u.search = "";
      return adminJson({ ok: await caches.default.delete(new Request(u.toString(), { method: "GET" })) });
    }
    if (name === "maintenance-on") {
      let message = null;
      try {
        const ct = request.headers.get("Content-Type") || "";
        if (ct.includes("application/json")) message = (await request.json()).message;
      } catch (e) { }
      await setMaintenance(env, true, message);
      return adminJson({ ok: true, maintenance: await getMaintenance(env) });
    }
    if (name === "maintenance-off") {
      await setMaintenance(env, false, null);
      return adminJson({ ok: true, maintenance: await getMaintenance(env) });
    }
    if (name === "resync-notify") {
      const maint = await getMaintenance(env);
      if (maint.active) return adminJson({ error: "maintenance active: включите после завершения тех. работ" }, 409);
      const cached = await readCache(env.DB);
      if (!cached || !cached.data) return adminJson({ error: "нет снапшота в D1" }, 409);
      const before = await collectUsers(env, cached.data);
      const hadFailures = await notifyUsers(env, cached.data, Date.now(), cached.fetchedAt);
      const after = await collectUsers(env, cached.data);
      return adminJson({ ok: true, hadFailures, pendingBefore: before.pending, pendingAfter: after.pending });
    }
    return adminJson({ error: "unknown action" }, 400);
  }
  return adminJson({ error: "not_found" }, 404);
}

const ADMIN_HTML = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#101014">
<title>Air Raid Worker</title>
<style>
:root{--f:"Roboto","system-ui",-apple-system,"Segoe UI",sans-serif;--app-surface:rgba(20,19,26,0.82);--app-bg:radial-gradient(1200px 700px at 15% -10%,#1d1b2c 0%,#101014 60%);--pr:#aeabd9;--prc:#8f8bc7;--onpr:#1d1a42;--cy:#dbaed7;--cyc:#a97aa5;--oncy:#321030;--surf:rgba(28,27,34,0.78);--surf2:rgba(174,171,217,0.06);--s3:rgba(174,171,217,0.10);--tx:#e5e5eb;--tv:#adacb9;--ol:rgba(63,62,76,0.85);--olv:rgba(174,171,217,0.08);--ok:#8fe3b0;--okc:rgba(34,94,66,0.55);--warn:#f3cf7a;--warnc:rgba(113,63,18,0.5);--err:#f4a3a3;--errc:rgba(127,29,29,0.5)}
*,*::before,*::after{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:var(--app-bg);background-attachment:fixed;color:var(--tx);font:400 14px/20px Roboto,system-ui,-apple-system,"Segoe UI",sans-serif}
.app{display:flex;min-height:100vh;background:var(--app-surface);padding:20px;gap:0}
.rail{width:88px;flex:none;position:sticky;top:0;height:100vh;background:var(--app-surface);border-right:1px solid var(--ol);display:flex;flex-direction:column;align-items:center;padding:20px 0;gap:14px}
.ni{display:flex;flex-direction:column;align-items:center;gap:4px;font:500 12px/16px var(--f);color:var(--tv);border:0;background:none;cursor:pointer;width:80px;padding:0}
.ni .pill{width:56px;height:32px;border-radius:16px;display:grid;place-items:center;transition:background .2s}
.ni:hover .pill{background:var(--s3)}.ni.on{color:var(--tx)}.ni.on .pill{background:var(--pr);color:var(--onpr)}
.ni svg{width:24px;height:24px;fill:currentColor}
.main{flex:1;min-width:0}
.top{position:sticky;top:0;z-index:5;background:var(--surf);border-bottom:1px solid var(--ol);height:60px;display:flex;align-items:center;gap:12px;padding:0 16px}
.top h1{margin:0;font:500 18px/22px var(--f);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.top small{display:block;font:400 11px/14px var(--f);overflow:hidden;text-overflow:ellipsis;color:var(--tv)}
.prog{height:4px;background:var(--s3);overflow:hidden;position:sticky;top:60px;z-index:5;opacity:0;transition:opacity .2s}
.prog.on{opacity:1}.prog i{display:block;height:100%;width:40%;background:var(--pr);border-radius:2px;animation:ind 1.1s infinite ease-in-out}
@keyframes ind{0%{margin-left:-40%}100%{margin-left:100%}}
.ib{width:40px;height:40px;border-radius:20px;border:0;background:none;color:var(--tv);display:grid;place-items:center;cursor:pointer}
.ib:hover{background:var(--s3)}.ib svg{width:24px;height:24px;fill:currentColor}
.sw{display:flex;align-items:center;gap:8px;color:var(--tv);font-size:12px;cursor:pointer}
.sw i{width:52px;height:32px;border-radius:16px;border:2px solid var(--ol);background:var(--s3);position:relative;transition:.2s}
.sw i:after{content:"";position:absolute;top:6px;left:6px;width:16px;height:16px;border-radius:50%;background:var(--ol);transition:.2s}
.sw.on i{background:var(--pr);border-color:var(--pr)}.sw.on i:after{left:22px;top:2px;width:24px;height:24px;background:var(--onpr)}
.view{padding:8px 16px 120px;max-width:1000px;margin:0 auto;display:grid;gap:12px}
.card{background:var(--app-surface);border:1px solid var(--ol);border-radius:20px;padding:18px;box-shadow:0 10px 30px rgba(0,0,0,0.45)}
.card h2{margin:0 0 8px;font:500 14px/20px var(--f);color:var(--pr);letter-spacing:.1px}
.hero{border-radius:28px;padding:24px;display:flex;gap:16px;align-items:center}
.hero.ok{background:linear-gradient(135deg,rgba(47,107,79,.92),rgba(29,77,54,.92));color:#eafaf0}.hero.warn{background:linear-gradient(135deg,rgba(120,86,30,.92),rgba(84,60,22,.92));color:#fdf6e6}.hero.bad{background:linear-gradient(135deg,rgba(120,44,44,.92),rgba(84,30,30,.92));color:#fdeaea}
.hero .ic{width:56px;height:56px;border-radius:28px;background:rgba(255,255,255,.12);display:grid;place-items:center;font-size:28px;flex:none}
.hero b{display:block;font:400 24px/32px var(--f)}.hero span{opacity:.85}
.metrics{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.m{background:rgba(28,27,34,0.55);border-radius:16px;padding:16px}.m .v{font:400 32px/40px var(--f);color:var(--tx)}.m .l{color:var(--tv);font-size:12px}
.m.hl{background:var(--s3)}.m.hl .v{color:var(--tx)}
.li{display:flex;align-items:center;gap:16px;padding:10px 0;border-bottom:1px solid var(--olv);cursor:default}
.li:last-child{border:0}.li .av{width:40px;height:40px;border-radius:20px;background:var(--s3);color:var(--tx);display:grid;place-items:center;flex:none;font-size:18px}
.li .av.ok{background:var(--okc);color:var(--ok)}.li .av.warn{background:var(--warnc);color:var(--warn)}.li .av.bad{background:var(--errc);color:var(--err)}
.li .t{flex:1;min-width:0}.li .t b{display:block;font-weight:500;overflow:hidden;text-overflow:ellipsis}.li .t span{color:var(--tv);font-size:12px;word-break:break-word}
.li .e{color:var(--tv);font-size:12px;text-align:right;white-space:nowrap}
.kv{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--olv)}.kv:last-child{border:0}
.kv span:first-child{color:var(--tv)}.kv span:last-child{text-align:right;word-break:break-word}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--err)}
.chips{display:flex;gap:8px;flex-wrap:wrap}
.chip{height:32px;padding:0 14px;border-radius:8px;border:1px solid var(--ol);background:none;color:var(--tv);font:500 13px var(--f);cursor:pointer}
.chip.on{background:var(--pr);color:var(--onpr);border-color:transparent}
.field{background:var(--s3);border-radius:28px;height:48px;display:flex;align-items:center;padding:0 16px;gap:12px}
.field input{flex:1;min-width:0;width:100%;background:none;border:0;outline:0;color:var(--tx);font:inherit;font-size:16px}
.btn{height:34px;padding:0 14px;border-radius:10px;font:600 13px var(--f);cursor:pointer;background:var(--pr);color:var(--onpr);line-height:34px}
.btn:hover{filter:brightness(1.15)}.btn.f{background:var(--pr);color:var(--onpr)}.btn.o{background:none;border:1px solid var(--ol);color:var(--pr);flex:none;white-space:nowrap}.btn.t{background:none;color:var(--pr);padding:0 12px}
.row{display:flex;gap:8px;flex-wrap:wrap}.row .field{min-width:0}
 .btns{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:6px}.btns .btn{width:100%;text-align:center;padding:0 10px}
.bar{height:8px;border-radius:4px;background:var(--s3);overflow:hidden;margin-top:4px}.bar i{display:block;height:100%;background:var(--pr);border-radius:4px}
.bl{display:flex;justify-content:space-between;margin-top:10px;font-size:13px}
.tag{padding:2px 10px;border-radius:8px;font-size:12px;font-weight:500}.tag.red{background:var(--errc);color:var(--err)}.tag.yellow{background:var(--warnc);color:var(--warn)}
.empty{text-align:center;color:var(--tv);padding:32px 8px}.empty .big{font-size:40px}
pre{margin:0;white-space:pre-wrap;word-break:break-all;font:12px/16px ui-monospace,Menlo,monospace;color:var(--tv);max-height:360px;overflow:auto}
.fab{position:fixed;right:16px;bottom:24px;height:44px;padding:0 16px 0 12px;border-radius:12px;border:0;background:var(--pr);color:var(--onpr);font:600 13px var(--f);display:flex;align-items:center;gap:8px;cursor:pointer;z-index:6}
.fab svg{width:24px;height:24px;fill:currentColor}
.scrim{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;place-items:center;z-index:20}.scrim.on{display:grid}
.dlg{background:var(--app-surface);border:1px solid var(--ol);border-radius:28px;padding:24px;width:min(360px,calc(100% - 32px))}.dlg h3{margin:0 0 16px;font:400 24px/32px var(--f)}.dlg p{margin:0 0 24px;color:var(--tv)}.dlg .row{justify-content:flex-end}
.snack{position:fixed;left:50%;transform:translate(-50%,16px);opacity:0;visibility:hidden;pointer-events:none;bottom:96px;background:#dcdbf0;color:#1d1a42;padding:14px 16px;border-radius:12px;max-width:calc(100% - 32px);z-index:30;box-shadow:0 4px 12px rgba(0,0,0,.4);transition:transform .3s cubic-bezier(.2,0,0,1),opacity .3s ease,visibility 0s .3s}
.snack.on{transform:translate(-50%,0);opacity:1;visibility:visible;transition:transform .3s cubic-bezier(.2,0,0,1),opacity .3s ease,visibility 0s}
.tag.green{background:var(--okc);color:var(--ok)}
.sh{margin:14px 0 2px;font:500 12px/16px var(--f);color:var(--tv);letter-spacing:.5px;text-transform:uppercase}
.menu{display:none;position:absolute;right:0;top:44px;background:var(--s3);border-radius:12px;padding:8px 0;min-width:280px;box-shadow:0 4px 16px rgba(0,0,0,.6);z-index:15}.menu.on{display:block}
.mi{display:flex;gap:12px;padding:12px 16px;cursor:pointer}.mi:hover{background:var(--s3)}.mi span{width:16px;color:var(--pr)}.mi.on{color:var(--pr)}
@media(max-width:600px){.menu{position:fixed;left:16px;right:16px;top:auto;bottom:100px;min-width:0}}
@media(min-width:840px){.metrics{grid-template-columns:repeat(4,1fr)}.fab{bottom:24px}.snack{bottom:24px}}
@media(max-width:839px){.rail{position:fixed;bottom:0;left:0;right:0;top:auto;width:100%;height:80px;flex-direction:row;justify-content:space-around;padding:12px 0 calc(12px + env(safe-area-inset-bottom,0px));background:var(--app-surface);border:0;z-index:10;height:auto}
.fab{bottom:96px;right:16px;width:56px;padding:0;justify-content:center}.fab span{display:none}.snack{bottom:170px}.sw b{display:none}}
</style></head><body>
<div class="app">
<nav class="rail" id="nav"></nav>
<div class="main">
<header class="top"><h1>Air Raid Worker<small id="sub"></small></h1><div class="sw on" id="auto" title="Автообновление 30с"><b>Авто</b><i></i></div>
<button class="ib" id="rf" title="Обновить"><svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg></button><button class="ib" id="lo" title="Выйти"><svg viewBox="0 0 24 24"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg></button></header>
<div class="prog" id="prog"><i></i></div>
<main class="view" id="view"></main>
</div></div>
<button class="fab" id="fab" title="Полная проверка" aria-label="Полная проверка"><svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg><span>Полная проверка</span></button>
<div class="scrim" id="scrim"><div class="dlg"><h3 id="dt"></h3><p id="dp"></p><div class="row"><button class="btn t" id="dn">Отмена</button><button class="btn f" id="dy">Выполнить</button></div></div></div>
<div class="snack" id="snack"></div>
<script>
var TZ="Europe/Kyiv",S={tab:"ov",d:null,f:{},flt:"all",sort:"lvl",q:"",auto:true,busy:0};
var IC={ov:"M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",al:"M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z",us:"M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",sy:"M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.61l-1.92-3.32a.5.5 0 0 0-.59-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.48-.41h-3.84a.5.5 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.59.22L2.74 8.87a.5.5 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.5.5 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.5.5 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"};
var TABS=[["ov","Обзор"],["al","Тревоги"],["us","Юзеры"],["sy","Система"]];
function $(i){return document.getElementById(i)}
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function tm(x){return x?new Date(x).toLocaleTimeString("ru-RU",{timeZone:TZ,hour:"2-digit",minute:"2-digit"}):"—"}
function dtm(x){return x?new Date(x).toLocaleString("ru-RU",{timeZone:TZ}):"—"}
function age(s){if(s==null)return"—";if(s<90)return s+" с";if(s<5400)return Math.round(s/60)+" мин";return(s/3600).toFixed(1)+" ч"}
function dur(x){if(!x)return"—";var m=Math.max(0,Math.round((Date.now()-new Date(x))/60000));if(m<60)return m+" мин";var t=Math.floor(m/60);if(t<48)return t+" ч "+(m%60)+" мин";var d=Math.floor(t/24);return d+" дн "+(t%24)+" ч"}
function kv(k,v,c){return'<div class="kv"><span>'+esc(k)+'</span><span class="'+(c||"")+'">'+(v==null||v===""?"—":esc(v))+'</span></div>'}
function li(ic,cls,t,s,e,go){return'<div class="li"'+(go?' style="cursor:pointer" onclick="tab(\\''+go+'\\')"':'')+'><div class="av '+cls+'">'+ic+'</div><div class="t"><b>'+esc(t)+'</b><span>'+esc(s)+'</span></div><div class="e">'+(e||"")+'</div></div>'}
function card(t,b){return'<div class="card"><h2>'+esc(t)+'</h2>'+b+'</div>'}
function nav(){$("nav").innerHTML=TABS.map(function(t){return'<button class="ni'+(S.tab===t[0]?" on":"")+'" onclick="tab(\\''+t[0]+'\\')"><div class="pill"><svg viewBox="0 0 24 24"><path d="'+IC[t[0]]+'"/></svg></div>'+t[1]+'</button>'}).join("")}
function tab(t){S.tab=t;nav();draw();scrollTo(0,0)}
function whErr(w){var i=w&&w.ok&&w.info;return i&&i.last_error_message&&i.last_error_date&&(Date.now()/1000-i.last_error_date)<3600?i.last_error_message:""}
function health(){var d=S.d,f=S.f,is=[],lvl="ok";
 function bad(m){is.push(m);lvl="bad"}function wr(m){is.push(m);if(lvl!=="bad")lvl="warn"}
  if(!d.bindings.alertsKey)bad("Нет ALERTS_API_KEY");if(!d.bindings.botToken)bad("Нет BOT_TOKEN");
  if(d.dbSchema&&!d.dbSchema.ok)bad("D1: "+(d.dbSchema.missing&&d.dbSchema.missing.length?"нет таблиц: "+d.dbSchema.missing.join(", "):"не хватает колонок в "+((d.dbSchema.badColumns||[]).map(function(x){return x.table}).join(", ")||"users")));
  if(!d.snapshot)bad("Нет снапшота");else if(d.snapshot.ageSeconds>2100)bad("Снапшот устарел ("+age(d.snapshot.ageSeconds)+")");
 if(d.snapshot&&d.snapshot.pendingRetry)wr("Есть неудачные доставки (retry)");
 if(f.upstream&&!f.upstream.ok&&!f.upstream.rateLimited)bad("alerts.in.ua: "+f.upstream.error);
  if(d.cron&&d.cron.state==="fail"&&Date.now()-d.cron.lastAt<900000)wr("Cron: сбой опроса alerts.in.ua с "+dtm(d.cron.since)+" ("+d.cron.error+")");
 if(f.webhook){if(!f.webhook.ok)wr("Webhook: "+f.webhook.error);else if(!f.webhook.info.url)bad("Webhook не установлен");else if(whErr(f.webhook))wr("Webhook: "+whErr(f.webhook))}
 if(f.users&&f.users.ok&&f.users.stats.pending)wr(f.users.stats.pending+" пользователей ждут доставки");
 if(f.kvWrite&&!f.kvWrite.ok)bad("Запись в D1 не работает: "+f.kvWrite.error);
 return{lvl:lvl,is:is}}
function vOv(){var d=S.d,f=S.f,s=d.snapshot,h=health(),n=s?s.oblasts.length+s.raions.length:0;
 var T={ok:["✓","Всё работает","Критических проблем не обнаружено"],warn:["!","Есть замечания",""],bad:["✕","Есть проблемы",""]}[h.lvl];
 var o="";
 if(d.maintenance&&d.maintenance.active){o+='<div class="hero card warn"><div class="ic">🛠</div><div><b>Технические работы</b><span>'+esc(d.maintenance.message||"Рассылка уведомлений приостановлена")+' · с '+dtm(d.maintenance.since)+'</span></div></div>'}
 o+='<div class="hero card '+h.lvl+'"><div class="ic">'+T[0]+'</div><div><b>'+T[1]+'</b><span>'+esc(h.is.length?h.is.join(" · "):T[2])+'</span></div></div>';
 o+='<div class="metrics"><div class="m'+(n?' hl':'')+'"><div class="v">'+n+'</div><div class="l">Активных тревог</div></div>'
  +'<div class="m"><div class="v '+(s?(s.ageSeconds>2100?"bad":""):"bad")+'">'+(s?age(s.ageSeconds):"—")+'</div><div class="l">Возраст снапшота</div></div>'
  +'<div class="m"><div class="v">'+(f.users&&f.users.ok?f.users.stats.total:"—")+'</div><div class="l">Пользователей</div></div>'
  +'<div class="m"><div class="v">'+(f.users&&f.users.ok?f.users.stats.pending:"—")+'</div><div class="l">Ждут доставки</div></div></div>';
 var u=f.upstream,w=f.webhook,c=d.cron,L="";
 L+=li("⚙",d.bindings.alertsKey&&d.bindings.botToken&&d.bindings.db?"ok":"bad","Переменные и биндинги","API key "+(d.bindings.alertsKey?"✓":"✕")+" · Bot "+(d.bindings.botToken?"✓":"✕")+" · D1 "+(d.bindings.db?"✓":"✕"),"","sy");
 L+=li("◷",!s?"bad":s.ageSeconds>2100?"bad":s.ageSeconds>d.config.cacheWriteIntervalSec?"warn":"ok","Снапшот D1",s?"Обновлено "+dtm(s.fetchedAt)+" · edge-кэш /api: "+(d.edgeCache?"есть":"пуст"):"cron ещё не отработал",s?age(s.ageSeconds):"","sy");
 L+=li("☁",u?(u.ok?"ok":(u.rateLimited?"warn":"bad")):(!s?"bad":(c&&c.state==="fail"?"warn":"ok")),"alerts.in.ua",u?(u.ok?u.oblasts+" областей, "+u.raions+" районов"+(u.sameAsSnapshot===false?" · отличается от снапшота":""):(u.rateLimited?"Живая проверка: лимит запросов (429). На бота это не влияет — он берёт данные через cron":u.error)):(c&&c.state==="fail"?"Cron получает ошибки — см. строку ниже":"Данные приходят через cron без сбоев. Живая проверка — вкладка «Система»"),u?u.ms+" мс":"","sy");
  var c=d.cron;L+=li("⏱",!c?"":(c.state==="fail"?"warn":"ok"),"Опрос alerts.in.ua (cron)",!c?"Сбоев не зафиксировано":(c.state==="fail"?"Сбой с "+dtm(c.since)+": "+c.error:"Восстановлен "+dtm(c.at)+" (сбой был с "+dtm(c.recoveredFrom)+")"),"","sy");
 L+=li("✈",w?(w.ok&&w.info.url&&!whErr(w)?"ok":"warn"):"","Telegram webhook",w?(w.ok?(whErr(w)||("pending: "+w.info.pending_update_count+(w.info.last_error_message?" · старая ошибка "+dtm(w.info.last_error_date*1000):""))):w.error):"Не проверено",w&&w.ok?w.ms+" мс":"","sy");
 o+=card("Сервисы",L);
 if(n){o+=card("Сейчас в тревоге",activeList(6)+(n>6?'<div class="row" style="margin-top:8px"><button class="btn t" onclick="tab(\\'al\\')">Показать все ('+n+')</button></div>':""))}
 return o}
var RK={red:0,yellow:1,green:2},LB={red:"Красный",yellow:"Жёлтый",green:"Зелёный"},GH={red:"🔴 Красные",yellow:"🟡 Жёлтые",green:"🟢 Спокойно"};
var FL=[["all","Все"],["red","🔴 Красные"],["yellow","🟡 Жёлтые"],["green","🟢 Спокойно"],["o","Области"],["r","Районы"]];
var SO=[["lvl","По уровню тревоги (красные → зелёные)"],["dur","По длительности тревоги"],["name","По названию (А–Я)"]];
function all(){var d=S.d,s=d.snapshot,R=d.regions||{o:{},d:{}},ao={},ar={},res=[],k;
 if(s){s.oblasts.forEach(function(o){ao[o.key]=o});s.raions.forEach(function(r){ar[r.key]=r})}
 function lv(x){return x?(x.alert_level==="yellow"?"yellow":"red"):"green"}
 for(k in R.o){var x=ao[k];res.push({t:"o",n:R.o[k],l:lv(x),at:x&&x.started_at})}
 for(k in R.d){var y=ar[k],ob=k.split(":")[0];res.push({t:"r",n:(R.o[ob]||ob).replace(" область","")+" · "+R.d[k]+" район",l:lv(y),at:y&&y.started_at})}
 return res}
function items(){return all().filter(function(x){return x.l!=="green"})}
function cmp(m){return function(a,b){var nm=a.n.localeCompare(b.n,"uk");
 if(m==="name")return nm;
 if(m==="dur")return((a.l==="green")-(b.l==="green"))||(new Date(a.at||0)-new Date(b.at||0))||nm;
 return(RK[a.l]-RK[b.l])||(a.at&&b.at?new Date(a.at)-new Date(b.at):0)||nm}}
function rowOf(x){var g=x.l==="green";
 return li(x.t==="o"?"🗺":"◎",x.l==="red"?"bad":x.l==="yellow"?"warn":"ok",x.n,(x.t==="o"?"Область":"Район")+(g?" · тревоги нет":" · с "+tm(x.at)),'<span class="tag '+x.l+'">'+LB[x.l]+'</span>'+(g?"":"<br>"+dur(x.at)))}
function activeList(max){return items().sort(cmp("lvl")).slice(0,max).map(rowOf).join("")}
function vAl(){var a=all(),c={all:a.length,red:0,yellow:0,green:0,o:0,r:0};
 a.forEach(function(x){c[x.l]++;c[x.t]++});
 var ch=FL.map(function(f,i){return'<button class="chip'+(S.flt===f[0]?" on":"")+'" onclick="setF('+i+')">'+f[1]+' · '+c[f[0]]+'</button>'}).join("");
 var mn=SO.map(function(s,i){return'<div class="mi'+(S.sort===s[0]?" on":"")+'" onclick="setS('+i+')"><span>'+(S.sort===s[0]?"✓":"")+'</span>'+s[1]+'</div>'}).join("");
 var cur={lvl:"Уровень",dur:"Время",name:"А–Я"}[S.sort];
 var o='<div class="row" style="flex-wrap:nowrap;align-items:center"><div class="field" style="flex:1"><span>🔍</span><input id="q" placeholder="Поиск региона" value="'+esc(S.q)+'" oninput="S.q=this.value;listOnly()"></div>'
  +'<div style="position:relative"><button class="btn o" onclick="toggleMenu(event)">⇅ '+esc(cur)+'</button><div class="menu" id="menu">'+mn+'</div></div></div>'
  +'<div class="chips">'+ch+'</div><div class="card" id="lst"></div>';
 setTimeout(listOnly,0);return o}
function listOnly(){var el=$("lst");if(!el||!S.d)return;var q=S.q.trim().toLowerCase(),F=S.flt;
 var a=all().filter(function(x){return(F==="all"||F===x.l||F===x.t)&&(!q||x.n.toLowerCase().indexOf(q)>-1)}).sort(cmp(S.sort));
 if(!a.length){el.innerHTML='<div class="empty"><div class="big">🔎</div>'+(S.d.regions?"Ничего не найдено":"Нет данных")+'</div>';return}
 var h='<h2>Найдено: '+a.length+'</h2>',prev=null,cnt={};
 if(S.sort==="lvl")a.forEach(function(x){cnt[x.l]=(cnt[x.l]||0)+1});
 a.forEach(function(x){if(S.sort==="lvl"&&x.l!==prev){h+='<div class="sh">'+GH[x.l]+' · '+cnt[x.l]+'</div>';prev=x.l}h+=rowOf(x)});
 el.innerHTML=h}
function setF(i){S.flt=FL[i][0];draw()}
function setS(i){S.sort=SO[i][0];draw()}
function toggleMenu(e){e.stopPropagation();$("menu").classList.toggle("on")}
document.addEventListener("click",function(){var m=$("menu");if(m)m.classList.remove("on")});
function bars(obj,total){return Object.keys(obj).map(function(k){var v=obj[k],p=total?Math.round(v*100/total):0;return'<div class="bl"><span>'+esc(k)+'</span><span>'+v+' · '+p+'%</span></div><div class="bar"><i style="width:'+p+'%"></i></div>'}).join("")}
function vUs(){var u=S.f.users;if(!u)return'<div class="card empty"><div class="big">👥</div>Статистика пользователей загружается при полной проверке<br><br><button class="btn f" onclick="load(true)">Проверить</button></div>';
 if(!u.ok)return card("Пользователи",kv("Ошибка",u.error,"bad"));var t=u.stats,tot=t.total-t.noRegion;
 var o='<div class="metrics"><div class="m hl"><div class="v">'+t.total+'</div><div class="l">Всего</div></div><div class="m"><div class="v">'+(t.total-t.notifyOff)+'</div><div class="l">С уведомлениями</div></div><div class="m"><div class="v">'+t.notifyOff+'</div><div class="l">Отключили</div></div><div class="m"><div class="v '+(t.pending?"warn":"")+'">'+t.pending+'</div><div class="l">Ждут доставки</div></div></div>';
 o+=card("Языки",bars(t.byLang,tot));
 o+=card("Состояние (last_alert_state)",bars(t.byState,tot));
 o+=card("Топ областей",t.byOblast.map(function(x){var p=tot?Math.round(x.n*100/tot):0;return'<div class="bl"><span>'+esc(x.name)+'</span><span>'+x.n+'</span></div><div class="bar"><i style="width:'+Math.min(100,p*3)+'%"></i></div>'}).join("")||'<div class="empty">Нет данных</div>');
 o+=card("Прочее",kv("Без региона",t.noRegion)+(t.truncated?kv("Внимание","список обрезан (10 страниц)","warn"):"")+kv("Время проверки",u.ms+" мс"));return o}
function vSy(){var d=S.d,f=S.f,s=d.snapshot,o="",m=d.maintenance||{active:false};
 o+=card("Технические работы",(m.active?kv("Статус","включены с "+dtm(m.since),"warn")+kv("Сообщение",m.message||"—"):kv("Статус","выключены","ok"))+'<div class="row" style="margin-top:12px">'
   +'<button class="btn f" '+(m.active?"disabled":"")+' onclick="ask(\\'maintenance-on\\',\\'Начать технические работы?\\',\\'Рассылка Telegram-уведомлений будет приостановлена cron\\\'ом до завершения. Плагины увидят флаг maintenance в /api.\\')">Начать тех. работы</button>'
   +'<button class="btn o" '+(!m.active?"disabled":"")+' onclick="ask(\\'maintenance-off\\',\\'Завершить технические работы?\\',\\'Рассылка уведомлений возобновится на следующем тике cron (раз в минуту).\\')">Завершить тех. работы</button></div>');
 o+=card("Действия",'<div class="sh">Проверки</div><div class="btns"><button class="btn" onclick="load(true)">Полная проверка</button><button class="btn" onclick="load(true,false,false,true)">Проверить alerts.in.ua</button><button class="btn" onclick="load(true,true)">Тест записи D1</button></div><div class="sh">Обслуживание</div><div class="btns"><button class="btn o" onclick="ask(\\'init-schema\\',\\'Создать недостающие таблицы D1?\\',\\'Выполнит CREATE TABLE IF NOT EXISTS для users, cache_kv, notified_events, device_links. Существующие таблицы и данные не изменяются.\\')">Инициализировать D1</button><button class="btn o" onclick="ask(\\'setup-webhook\\',\\'Установить webhook?\\',\\'Выполнится setWebhook с drop_pending_updates=true — очередь ожидающих апдейтов будет очищена.\\')">Setup webhook</button><button class="btn o" onclick="ask(\\'purge-edge\\',\\'Сбросить кэш /api?\\',\\'Следующий запрос плагина пойдёт в D1/upstream.\\')">Сбросить кэш /api</button></div><div class="sh">Рассылка и данные</div><div class="btns"><button class="btn o" onclick="ask(\\'resync-notify\\',\\'Досинхронизировать рассылку?\\',\\'Разошлёт сообщения всем, у кого сохранённое состояние разошлось с текущим снапшотом, не дожидаясь нового изменения тревог.\\')">Досинхронизировать рассылку</button><a class="btn" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none" href="/admin/export/users.sql?overwrite=1">Скачать users.sql</a></div>');
 o+=card("Воркер",kv("Версия",d.version)+kv("Языки",d.langs.join(", "))+kv("Время",dtm(d.time))+kv("Edge TTL /api",d.config.edgeTtl+" с")+kv("Мин. интервал записи D1",d.config.cacheWriteIntervalSec+" с")+kv("Окно ретраев",d.config.retryWindowSec+" с"));
 if(s)o+=card("Снапшот",kv("Возраст",age(s.ageSeconds),s.ageSeconds>2100?"bad":"ok")+kv("Обновлено",dtm(s.fetchedAt))+kv("Областей / районов",s.oblasts.length+" / "+s.raions.length)+kv("pendingRetry",s.pendingRetry?dtm(s.pendingRetry):"нет",s.pendingRetry?"warn":"ok")+kv("Подпись",(s.signature||"").slice(0,60)+((s.signature||"").length>60?"…":"")));
 var u=f.upstream;if(u)o+=card("alerts.in.ua (live)",kv("Статус",u.ok?"OK":(u.rateLimited?"Лимит (429)":"Ошибка"),u.ok?"ok":(u.rateLimited?"warn":"bad"))+kv("Ответ",u.ms+" мс")+(u.ok?kv("Сырых alerts",u.rawAlerts)+kv("Области / районы",u.oblasts+" / "+u.raions)+kv("Совпадает со снапшотом",u.sameAsSnapshot==null?"—":u.sameAsSnapshot?"да":"нет",u.sameAsSnapshot===false?"warn":"ok"):kv("Ошибка",u.error,"bad")));
 var w=f.webhook;if(w){var i=w.info||{};o+=card("Telegram webhook",w.ok?kv("URL",i.url||"не задан",i.url?"":"bad")+kv("В очереди",i.pending_update_count,i.pending_update_count>0?"warn":"ok")+kv("Последняя ошибка",i.last_error_message||"нет",i.last_error_message?"bad":"ok")+kv("Когда",i.last_error_date?dtm(i.last_error_date*1000):"—")+kv("Макс. соединений",i.max_connections)+kv("Ответ",w.ms+" мс"):kv("Ошибка",w.error,"bad"))}
 if(f.kvWrite)o+=card("Тест записи D1",kv("Результат",f.kvWrite.ok?"OK · "+f.kvWrite.ms+" мс":f.kvWrite.error,f.kvWrite.ok?"ok":"bad"));
 var r=JSON.parse(JSON.stringify({d:d,full:f}));if(r.d.snapshot){delete r.d.snapshot.oblasts;delete r.d.snapshot.raions}
 o+=card("Raw JSON",'<pre>'+esc(JSON.stringify(r,null,2))+'</pre>');return o}
function draw(){if(!S.d){$("view").innerHTML='<div class="empty card">Загрузка…</div>';return}
 var v={ov:vOv,al:vAl,us:vUs,sy:vSy}[S.tab]();var q=$("q"),foc=q&&document.activeElement===q,pos=foc?q.selectionStart:0;
 $("view").innerHTML=v;if(foc){q=$("q");q.focus();q.setSelectionRange(pos,pos)}
 $("sub").textContent=new Date().toLocaleTimeString("ru-RU",{timeZone:TZ})+" · "+S.d.version}
function snack(m){var e=$("snack");e.textContent=m;e.classList.add("on");clearTimeout(snack.t);snack.t=setTimeout(function(){e.classList.remove("on")},2500)}
function busy(n){S.busy+=n;$("prog").classList.toggle("on",S.busy>0)}
function load(full,kv,quiet,up){busy(1);
 fetch("/admin/data"+(full?"?full=1"+(kv?"&kv=1":"")+(up?"&up=1":""):""),{cache:"no-store"}).then(function(r){if(r.status===401){location.href="/admin";return}return r.json()}).then(function(d){if(!d)return;
  if(full)["upstream","webhook","users","kvWrite"].forEach(function(k){if(d[k])S.f[k]=d[k]});
  S.d=d;draw();if(full&&!quiet)snack("Полная проверка завершена")}).catch(function(e){snack("Ошибка: "+e)}).then(function(){busy(-1)})}
function ask(name,t,p){$("dt").textContent=t;$("dp").textContent=p;$("scrim").classList.add("on");
 $("dy").onclick=function(){$("scrim").classList.remove("on");busy(1);fetch("/admin/action?name="+name,{method:"POST"}).then(function(r){return r.json()}).then(function(j){var msg=j.ok?"успешно":JSON.stringify(j).slice(0,120);if(name==="resync-notify"&&j.ok)msg="готово: ждали "+j.pendingBefore+" → осталось "+j.pendingAfter+(j.hadFailures?" (есть сбои доставки, см. логи)":"");snack(name+": "+msg);load(true,false,true)}).catch(function(e){snack("Ошибка: "+e)}).then(function(){busy(-1)})}}
$("dn").onclick=function(){$("scrim").classList.remove("on")};
$("scrim").onclick=function(e){if(e.target===this)this.classList.remove("on")};
$("rf").onclick=function(){load(false)};$("lo").onclick=function(){fetch("/admin/logout",{method:"POST"}).then(function(){location.href="/admin"})};$("fab").onclick=function(){load(true)};
$("auto").onclick=function(){S.auto=!S.auto;this.classList.toggle("on",S.auto)};
nav();draw();load(true,false,true);setInterval(function(){if(S.auto&&!document.hidden)load(false)},30000);
</script></body></html>`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      return await handleAdmin(request, env, url);
    }

    if (url.pathname === "/") {
      return json({ ok: true, service: "Air Raid Alert — Universal Worker" });
    }

    const restricted = url.pathname === "/setup-webhook" || url.pathname === "/webhook-info";
    if (restricted) {
      if (!env.ADMIN_TOKEN) return json({ ok: false, error: "ADMIN_TOKEN secret is not set; configure it first, then manage these endpoints via /admin" }, 403);
      if (!(await isAdmin(request, env))) return new Response("Unauthorized. Log in at /admin", { status: 401 });
    }

    if (url.pathname === "/setup-webhook") {
      return await handleSetupWebhook(request, env);
    }

    if (url.pathname === "/webhook-info") {
      if (!env.BOT_TOKEN) return json({ ok: false, error: "BOT_TOKEN not configured" }, 500);
      try {
        const r = await fetchWithTimeout(`${TELEGRAM_API}${env.BOT_TOKEN}/getWebhookInfo`, {}, FETCH_TIMEOUT_MS);
        return json(await r.json());
      } catch (e) {
        return json({ ok: false, error: String(e) }, 502);
      }
    }

    if (url.pathname === "/tick") {
      const key = url.searchParams.get("key") || request.headers.get("X-Tick-Key") || "";
      const allowed = [env.TICK_SECRET, env.ADMIN_TOKEN].filter(Boolean);
      if (!allowed.length) return json({ error: "tick disabled: set TICK_SECRET or ADMIN_TOKEN" }, 403);
      if (!allowed.some(secret => safeEqual(String(key), String(secret)))) return json({ error: "forbidden" }, 403);
      if (env.TICKER) {
        try {
          const stub = env.TICKER.get(env.TICKER.idFromName("main"));
          const r = await stub.fetch("https://ticker/now", { method: "POST" });
          const out = await r.json().catch(() => ({ ok: false }));
          return json({ ok: true, ticker: out });
        } catch (e) {
          return json({ ok: false, error: String(e && e.message || e).slice(0, 200) }, 502);
        }
      }
      try {
        await checkAllUsers(env);
        return json({ ok: true, ticker: "cron" });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message || e).slice(0, 200) }, 502);
      }
    }

    if (url.pathname === "/health") {
      const out = { version: WORKER_VERSION, langs: Object.keys(TEXTS), time: new Date().toISOString(), hasAlertsKey: !!env.ALERTS_API_KEY, hasBotToken: !!env.BOT_TOKEN, ticker: env.TICKER ? "durable" : "cron", tickMs: resolveTickMs(env) };
      if (env.TICKER) {
        try {
          const r = await env.TICKER.get(env.TICKER.idFromName("main")).fetch("https://ticker/status");
          const st = await r.json();
          out.tickerState = {
            tickMs: st.tickMs,
            callsLastMinute: st.callsLastMinute,
            lastRunAt: st.lastRunAt,
            lastOk: st.lastOk,
            lastStatus: st.lastStatus,
            last429At: st.last429At
          };
        } catch (e) { out.tickerState = { error: String(e && e.message || e).slice(0, 120) }; }
      }
      try {
        const c = await readCache(env.DB);
        out.snapshot = c ? { ageSeconds: Math.round((Date.now() - (c.fetchedAt || 0)) / 1000), pendingRetry: c.pendingRetry || 0 } : null;
      } catch (e) { out.snapshot = { error: String(e).slice(0, 200) }; }
      const schema = await checkSchema(env.DB);
      out.db = { ok: schema.ok, missing: schema.missing, badColumns: schema.badColumns };
      if (await isAdmin(request, env)) {
        out.db.tables = schema.tables;
        try {
          const d = await fetchUpstreamShared(env, 45000);
          out.upstream = { ok: true, oblasts: (d.oblasts || []).length, raions: (d.raions || []).length };
        } catch (e) { out.upstream = { ok: false, rateLimited: !!(e && e.status === 429), error: String(e && e.message || e).slice(0, 200) }; }
        try { const cronRaw = await d1GetKV(env.DB, CRON_STATUS_KEY); out.cron = cronRaw ? JSON.parse(cronRaw) : null; } catch (e) { out.cron = null; }
        if (url.searchParams.get("kv") === "1") {
          try { await d1PutKV(env.DB, "health-check", String(Date.now())); out.kvWrite = { ok: true }; }
          catch (e) { out.kvWrite = { ok: false, error: String(e && e.message || e).slice(0, 200) }; }
        }
      } else {
        out.detail = "log in at /admin for upstream and DB checks";
      }
      return json(out);
    }

        if (url.pathname === "/api") {
      try {
        return json(await getPublicAlerts(env, request, ctx));
      } catch (e) {
        return json({ ok: false, error: String(e) }, 502);
      }
    }

    if (url.pathname === "/telegram/webhook" && method === "POST") {
      return await handleTelegramWebhook(request, env, ctx);
    }

    const deviceMatch = url.pathname.match(/^\/telegram\/get-chat-id\/([a-zA-Z0-9-]+)$/);
    if (deviceMatch && method === "GET") {
      const data = await getDeviceLink(env, deviceMatch[1]);
      if (data && data.chat_id && data.sync_token) return json({ ok: true, chat_id: data.chat_id, sync_token: data.sync_token, lang: normLang(data.lang) });
      return json({ ok: false, chat_id: null });
    }

    if (url.pathname === "/register" && method === "POST") {
      try {
        const body = await request.json();
        const { chat_id, oblast_key, district_key, region_name, sync_token } = body;
        if (!chat_id) return json({ error: "missing chat_id" }, 400);
        if (body.device_id && !/^[a-zA-Z0-9-]{1,64}$/.test(String(body.device_id))) {
          return json({ error: "invalid device_id" }, 400);
        }

        const key = `user:${chat_id}`;
        let existing;
        try {
          existing = await readUser(env, key, true);
        } catch (e) {
          console.error("[register] users table read failed:", e);
          return json({ error: "database_unavailable", detail: String(e && e.message || e).slice(0, 200) }, 503);
        }

        let deviceLink = null;
        if (body.device_id) {
          const candidate = await getDeviceLink(env, body.device_id);
          if (candidate && String(candidate.chat_id) === String(chat_id) && validSyncToken(candidate, sync_token)) {
            deviceLink = candidate;
          }
        }

        const lang = body.lang
          ? normLang(body.lang)
          : normLang(deviceLink && deviceLink.lang || existing && existing.lang);

        if (existing && !validSyncToken(existing, sync_token) && !deviceLink) {
          return json({ error: "invalid sync token" }, 403);
        }
        if (!(await checkAndSetEphemeralFlag(`register-rate:${chat_id}`, 2))) {
          return json({ error: "rate limited" }, 429);
        }
        if (!existing && !deviceLink) {
          return json({ error: "missing device link" }, 403);
        }

        const token = deviceLink
          ? ((typeof sync_token === "string" && sync_token) || await randomToken())
          : ((existing && existing.sync_token) || (typeof sync_token === "string" && sync_token) || await randomToken());

        const hasLocationsField = Object.prototype.hasOwnProperty.call(body, "locations");
        const hasSingleField = Object.prototype.hasOwnProperty.call(body, "oblast_key");
        let nextLocations;
        if (hasLocationsField) {
          const parsed = parseLocationsInput(body.locations);
          if (parsed === null) return json({ error: "invalid locations" }, 400);
          nextLocations = parsed;
        } else if (hasSingleField) {
          if (oblast_key === null || oblast_key === undefined || oblast_key === "") {
            nextLocations = [];
          } else {
            const location = normalizeLocation({
              oblast_key,
              district_key,
              region_name
            });
            if (!location) return json({ error: "unknown oblast_key or district_key" }, 400);
            nextLocations = [location];
          }
        } else {
          nextLocations = userLocations(existing);
        }

        const previousLocations = userLocations(existing);
        const locationsChanged = !existing || JSON.stringify(previousLocations) !== JSON.stringify(nextLocations);
        const prevNotify = existing ? existing.notify !== false : true;
        const notify = typeof body.notify === "boolean" ? body.notify : prevNotify;
        const notifyChanged = !!existing && notify !== prevNotify;
        const relinked = !!deviceLink;
        const resync = !existing || locationsChanged || (notifyChanged && notify) || relinked;

        let snapshot = null;
        if (nextLocations.length) {
          try {
            snapshot = await getSharedSnapshot(env);
          } catch (e) {
            // An alerts.in.ua outage must not prevent the account from being
            // saved. Fall back to a clear state; the cron will resync it.
            console.error("[register] snapshot unavailable, saving with clear state:", e);
          }
        }
        const statuses = {};
        let firstStatus = { state: "clear", since: null };
        for (const location of nextLocations) {
          const status = alertStatus(snapshot && snapshot.data, location.oblast_key, location.district_key);
          statuses[locationKey(location)] = status;
          if (location === nextLocations[0]) firstStatus = status;
        }

        const oldStates = existing && existing.location_states && typeof existing.location_states === "object"
          ? existing.location_states
          : {};
        const legacyState = existing && existing.last_alert_state
          ? { state: existing.last_alert_state, since: existing.last_alert_start || null, end: existing.last_alert_end || null }
          : null;
        const locationStates = {};
        for (const location of nextLocations) {
          const locationId = locationKey(location);
          const status = statuses[locationId];
          const known = oldStates[locationId];
          if (!known || typeof known !== "object") {
            locationStates[locationId] = !resync && nextLocations.length === 1 && legacyState
              ? { ...legacyState }
              : { state: status.state, since: status.since || null, end: null };
          } else if (resync) {
            locationStates[locationId] = { state: status.state, since: status.since || null, end: null };
          } else {
            locationStates[locationId] = known;
          }
        }

        const userData = {
          chat_id: String(chat_id),
          sync_token: token,
          lang,
          notify,
          last_activity: new Date().toISOString(),
          telegram_connected: true,
          registered_at: existing && existing.registered_at ? existing.registered_at : new Date().toISOString(),
          last_check: new Date().toISOString(),
          locations: nextLocations,
          location_states: locationStates,
          sessions: normalizeSessions(existing),
          oblast_key: nextLocations[0] ? nextLocations[0].oblast_key : null,
          district_key: nextLocations[0] ? nextLocations[0].district_key : null,
          region_name: nextLocations[0] ? nextLocations[0].region_name : null,
          last_alert_state: existing ? existing.last_alert_state : null,
          last_alert_active: existing ? existing.last_alert_active : null,
          last_alert_start: existing ? existing.last_alert_start : null,
          last_alert_end: existing ? existing.last_alert_end : null
        };
        addSession(userData, token, body.device_id);
        applyLegacyFields(userData);

        const nothingChanged = !!existing && !relinked &&
          JSON.stringify(previousLocations) === JSON.stringify(nextLocations) &&
          normLang(existing.lang) === userData.lang &&
          (existing.notify !== false) === notify &&
          existing.sync_token === token &&
          JSON.stringify(normalizeSessions(existing)) === JSON.stringify(userData.sessions);
        const changed = !nothingChanged;
        if (changed) {
          try {
            await writeUser(env, key, userData);
          } catch (e) {
            console.error("[register] users table write failed:", e);
            return json({ error: "database_write_failed", detail: "could not save user; check D1 schema and logs" }, 503);
          }
        }
        const isNewDeviceLink = !!deviceLink;
        if (deviceLink) await deleteDeviceLink(env, body.device_id);

        const sendNotifications = async () => {
          const m = M(lang);
          if (isNewDeviceLink) {
            await sendTelegramTracked(env, chat_id, m.connected);
          }
          if (notify) {
            if (nextLocations.length && resync) {
              const label = nextLocations.map(l => l.region_name).join(", ");
              await sendTelegramTracked(env, chat_id, m.subscribed(escapeHtml(label)));
              await sendTelegramTracked(env, chat_id, stateMessage(nextLocations[0].region_name, firstStatus, lang));
            } else if (!nextLocations.length && notifyChanged) {
              await sendTelegramTracked(env, chat_id, m.enabled);
            }
          } else if (notifyChanged) {
            await sendTelegramTracked(env, chat_id, m.unsubscribed);
          }
        };
        if (ctx && typeof ctx.waitUntil === "function") {
          ctx.waitUntil(sendNotifications());
        } else {
          await sendNotifications();
        }

        return json({
          ok: true,
          changed,
          notify,
          sync_token: token,
          locations: nextLocations,
          oblast_key: userData.oblast_key,
          district_key: userData.district_key,
          region_name: userData.region_name,
          statuses,
          status: {
            state: nextLocations.length ? firstStatus.state : null,
            active: nextLocations.length ? firstStatus.state !== "clear" : null,
            since: nextLocations.length ? firstStatus.since : null,
            fetchedAt: snapshot ? snapshot.fetchedAt : null,
            lastUpstreamCheckAt: snapshot ? (snapshot.heartbeat || null) : null,
            stale: snapshot ? (snapshot.heartbeat ? (Date.now() - snapshot.heartbeat > STALE_SNAPSHOT_MS) : true) : null
          }
        });
      } catch (e) {
        return json({ error: String(e) }, 400);
      }
    }

    if (url.pathname === "/unregister" && method === "POST") {
      try {
        const { chat_id, sync_token } = await request.json();
        if (!chat_id) return json({ error: "missing chat_id" }, 400);

        const existing = await readUser(env, `user:${chat_id}`);
        if (!existing) return json({ ok: true, existed: false });
        if (existing.sync_token && !validSyncToken(existing, sync_token)) {
          return json({ error: "invalid sync token" }, 403);
        }

        await deleteUser(env, chat_id);
        await sendTelegramTracked(env, chat_id, M(existing.lang).unsubscribed);

        return json({ ok: true, existed: true });
      } catch (e) {
        return json({ error: String(e) }, 400);
      }
    }

    if (url.pathname === "/telegram/test" && method === "POST") {
      try {
        const { chat_id, sync_token } = await request.json();
        if (!chat_id) return json({ error: "missing chat_id" }, 400);

        const existing = await readUser(env, `user:${chat_id}`);
        if (!existing) return json({ error: "no user record found on server, reconnect telegram" }, 403);
        if (!validSyncToken(existing, sync_token)) return json({ error: "sync token mismatch, reconnect telegram" }, 403);
        if (!(await checkAndSetEphemeralFlag(`test:${chat_id}`, 15))) {
          return json({ error: "test rate limited, wait 15s" }, 429);
        }

        if (!env.BOT_TOKEN) return json({ error: "BOT_TOKEN not configured on worker" }, 500);
        const sendResult = await sendTelegramTracked(env, chat_id, M(existing.lang).test);
        if (!sendResult.ok) return json({ error: sendResult.description || "telegram sendMessage failed, check worker logs" }, 502);
        return json({ ok: true });
      } catch (e) {
        return json({ error: String(e) }, 400);
      }
    }

    return json({ error: "not_found" }, 404);
  },

  async scheduled(event, env, ctx) {
    // Prefer the Durable Object alarm loop: it re-runs every few seconds, so
    // alerts reach Telegram in seconds instead of waiting for the next
    // one-minute cron tick. The cron stays as the watchdog that (re)starts
    // the loop, and falls back to an inline check if the binding is missing
    // or the DO cannot be reached.
    let viaTicker = false;
    if (env.TICKER) {
      try {
        const stub = env.TICKER.get(env.TICKER.idFromName("main"));
        await stub.fetch("https://ticker/ensure", { method: "POST" });
        viaTicker = true;
      } catch (e) {
        console.error("[ticker] ensure failed, falling back to inline check:", e);
      }
    }
    if (!viaTicker) {
      try {
        await checkAllUsers(env);
      } catch (e) {
        console.error("[cron] checkAllUsers error:", e);
        await recordCron(env, false, e);
      }
    }
    ctx.waitUntil(
      env.DB.prepare("DELETE FROM device_links WHERE expires_at < ?1").bind(Date.now()).run().catch(e => {
        console.error("[device] cleanup error:", e);
      })
    );
    ctx.waitUntil(
      env.DB.prepare("DELETE FROM notified_events WHERE created_at < ?1").bind(Date.now() - 30 * 24 * 3600 * 1000).run().catch(e => {
        console.error("[dedupe] cleanup error:", e);
      })
    );
  }
};

export class AlertTicker {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.recent = [];
  }

  async fetch(request) {
    await this._ensureLoaded();
    const path = new URL(request.url).pathname;
    if (path === "/status") {
      const callsLastMinute = this._recentCalls();
      const hourAgo = Date.now() - 3600000;
      return new Response(JSON.stringify({
        ok: true,
        tickMs: resolveTickMs(this.env),
        alarmInMs: this.alarmAt ? Math.max(0, this.alarmAt - Date.now()) : null,
        callsLastMinute,
        callsLastHour: this.recent.filter(t => t >= hourAgo).length,
        lastRunAt: this.lastRunAt || null,
        lastOk: this.lastOk === undefined ? null : this.lastOk,
        lastStatus: this.lastStatus || null,
        lastError: this.lastError || null,
        last429At: this.last429At || null,
        last429Error: this.last429Error || null
      }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }
    if (path === "/now") {
      if (this._recentCalls() >= TICK_MAX_PER_WINDOW) {
        return new Response(JSON.stringify({ ok: false, skipped: "rate_limit_window", callsLastMinute: this.recent.length }), {
          headers: { "Content-Type": "application/json" }
        });
      }
      this.recent.push(Date.now());
      return new Response(JSON.stringify(await this._run()), {
        headers: { "Content-Type": "application/json" }
      });
    }
    if (path === "/stop") {
      await this.state.storage.deleteAlarm();
      return new Response(JSON.stringify({ ok: true, stopped: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    const alarm = await this.state.storage.getAlarm();
    if (alarm == null) await this.state.storage.setAlarm(Date.now() + 1000);
    return new Response(JSON.stringify({
      ok: true,
      alarm: await this.state.storage.getAlarm(),
      tickMs: resolveTickMs(this.env),
      callsLastMinute: this._recentCalls()
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  _recentCalls() {
    const now = Date.now();
    this.recent = (this.recent || []).filter(t => now - t < 3600000);
    return this.recent.filter(t => now - t < TICK_WINDOW_MS).length;
  }

  async _ensureLoaded() {
    if (this._loaded) return;
    this._loaded = true;
    try {
      const saved = await this.state.storage.get("state");
      if (saved && typeof saved === "object") {
        this.recent = Array.isArray(saved.recent) ? saved.recent : [];
        this.lastRunAt = saved.lastRunAt || null;
        this.lastOk = saved.lastOk;
        this.lastStatus = saved.lastStatus || null;
        this.lastError = saved.lastError || null;
        this.last429At = saved.last429At || null;
        this.last429Error = saved.last429Error || null;
      }
    } catch (e) { }
  }

  async _persist() {
    try {
      await this.state.storage.put("state", {
        recent: this.recent.slice(-120),
        lastRunAt: this.lastRunAt || null,
        lastOk: this.lastOk,
        lastStatus: this.lastStatus || null,
        lastError: this.lastError || null,
        last429At: this.last429At || null,
        last429Error: this.last429Error || null
      });
    } catch (e) { }
  }

  async alarm() {
    await this._ensureLoaded();
    const now = Date.now();
    const calls = this._recentCalls();
    let delay;
    if (calls >= TICK_MAX_PER_WINDOW) {
      // Sliding-window guard: never exceed the cap even if the interval was
      // lowered too far or a manual /tick just ran.
      const oldest = this.recent.filter(t => now - t < TICK_WINDOW_MS)[0] || now;
      delay = Math.max(1000, TICK_WINDOW_MS - (now - oldest) + 250);
    } else {
      this.recent.push(now);
      const res = await this._run();
      if (res.ok) delay = resolveTickMs(this.env) + Math.floor(Math.random() * TICK_JITTER_MS);
      else if (res.status === 403) delay = 10 * 60 * 1000;
      else if (res.status === 429) delay = Math.max(res.retryAfterMs || 0, TICK_429_BACKOFF_MS);
      else if (res.retryAfterMs) delay = Math.min(Math.max(res.retryAfterMs, 60000), 10 * 60 * 1000);
      else delay = TICK_ERROR_BACKOFF_MS;
    }
    this.alarmAt = Date.now() + delay;
    await this._persist();
    await this.state.storage.setAlarm(this.alarmAt);
  }

  async _run() {
    const started = Date.now();
    this.lastRunAt = new Date().toISOString();
    try {
      await checkAllUsers(this.env);
      this.lastOk = true; this.lastStatus = null; this.lastError = null;
      return { ok: true, at: this.lastRunAt, durationMs: Date.now() - started };
    } catch (e) {
      console.error("[ticker] checkAllUsers error:", e);
      this.lastOk = false;
      this.lastStatus = e && e.status ? e.status : null;
      this.lastError = String(e && e.message || e).slice(0, 200);
      if (this.lastStatus === 429) {
        this.last429At = this.lastRunAt;
        this.last429Error = this.lastError;
      }
      return {
        ok: false,
        at: this.lastRunAt,
        durationMs: Date.now() - started,
        status: this.lastStatus,
        retryAfterMs: e && e.retryAfterMs ? e.retryAfterMs : 0,
        error: this.lastError
      };
    }
  }
}
