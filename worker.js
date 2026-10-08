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
const EDGE_CACHE_TTL_SECONDS = 10;
const WORKER_VERSION = "air-raid-panel-2026-10-01";
const SEND_CONCURRENCY = 15;
const MIN_CACHE_WRITE_INTERVAL_SECONDS = 1800;
const RETRY_WINDOW_MS = 5 * 60 * 1000;
const SNAPSHOT_KEY = "alerts-in-ua";
const DEVICE_LINK_TTL_SECONDS = 600;
const UPDATE_DEDUP_TTL_SECONDS = 120;
const SYNC_TOKEN_BYTES = 18;
const KYIV_TZ = "Europe/Kyiv";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
  await d1PutKV(
    db,
    SNAPSHOT_KEY,
    JSON.stringify({ fetchedAt, signature: signature || buildStatusSignature(data), data, pendingRetry: Number(pendingRetry) || 0 })
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
  if (!json.alerts) return { alerts: [], oblasts: [], raions: [] };
  
  const oblasts = {};
  const raions = [];
  
  for (const alert of json.alerts) {
    if (alert.alert_type !== 'air_raid') continue;

    const oblastSlug = OBLAST_NAME_NORM_TO_SLUG[normalizeUk(alert.location_oblast)];
    if (!oblastSlug) {
      console.error(`[alerts.in.ua] unknown oblast name: ${alert.location_oblast}`);
      continue;
    }
    
    if (alert.location_type === 'oblast') {
      oblasts[oblastSlug] = {
        key: oblastSlug,
        name: alert.location_oblast,
        oblast: alert.location_oblast,
        alert_level: alert.alert_level,
        started_at: alert.started_at
      };
    } else if (alert.location_type === 'raion') {
      const raionName = alert.location_raion || alert.location_title;
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
      raions.push({
        key: `${oblastSlug}:${districtSlug}`,
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
    const transient = e && (e.status === 429 || e.status >= 500 || (!e.status && !/not configured/.test(String(e.message))));
    if (!transient || (e.retryAfterMs || 0) > 5000) throw e;
    await new Promise(r => setTimeout(r, e.status === 429 ? (e.retryAfterMs || 2500) : 1500));
    return await fetchUpstream(env);
  }
}

const CRON_STATUS_KEY = "cron-status";
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
  const signature = buildStatusSignature(data);
  await writeCache(env.DB, data, fetchedAt, signature);
  return { fetchedAt, signature, data, heartbeat: fetchedAt };
}

async function getPublicAlerts(env, request, ctx = null) {
  const u = new URL(request.url);
  u.pathname = "/api";
  u.search = "";
  const cacheKey = new Request(u.toString(), { method: "GET" });

  const edge = await caches.default.match(cacheKey);
  if (edge) {
    const payload = await edge.json();
    return { ...payload, serverTime: new Date().toISOString() };
  }

  let stored = await readCache(env.DB);
  if (stored && stored.fetchedAt && Date.now() - stored.fetchedAt > 2100000 && !(await hasEphemeralFlag("live-refresh"))) {
    await setEphemeralFlag("live-refresh", 20);
    try {
      const liveData = await fetchUpstreamShared(env);
      const liveAt = Date.now();
      const liveSig = buildStatusSignature(liveData);
      await writeCache(env.DB, liveData, liveAt, liveSig);
      stored = { fetchedAt: liveAt, signature: liveSig, data: liveData };
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
      stale: heartbeat ? (Date.now() - heartbeat > 2100000) : false,
      staleAgeSeconds: heartbeat ? Math.max(0, Math.round((Date.now() - heartbeat) / 1000)) : null
    };
    const response = new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${EDGE_CACHE_TTL_SECONDS}` }
    });
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    else await caches.default.put(cacheKey, response.clone());
    return { ...payload, serverTime: new Date().toISOString() };
  }

  const data = await fetchUpstreamShared(env);
  const fetchedAt = Date.now();
  const signature = buildStatusSignature(data);
  await writeCache(env.DB, data, fetchedAt, signature);
  const payload = { ...data, fetchedAt, snapshotSignature: signature, lastUpstreamCheckAt: fetchedAt, stale: false, staleAgeSeconds: 0 };
  const response = new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${EDGE_CACHE_TTL_SECONDS}` }
  });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  else await caches.default.put(cacheKey, response.clone());
  return { ...payload, serverTime: new Date().toISOString() };
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
    if (key) items.push(`o:${key}:${stateOf(x)}`);
  }
  for (const x of (data?.raions || [])) {
    if (!x || typeof x !== "object") continue;
    const key = String(x.key || "");
    if (key) items.push(`r:${key}:${stateOf(x)}`);
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
    state: alert.alert_level === "yellow" ? "yellow" : "red", 
    since: alert.started_at 
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
  if (status.state === "red") return m.red(region, formatTimeKyiv(new Date(status.since || Date.now())));
  if (status.state === "yellow") return m.yellow(region, formatTimeKyiv(new Date(status.since || Date.now())));
  return m.clear(region);
}

async function checkAllUsers(env) {
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
    await writeCache(env.DB, data, now, signature);
    return;
  }

  const changed = previous.signature !== signature;
  const lastWriteAt = previous.fetchedAt || 0;
  const dueForRefresh = now - lastWriteAt >= MIN_CACHE_WRITE_INTERVAL_SECONDS * 1000;
  const retrySince = typeof previous.pendingRetry === "number" ? previous.pendingRetry : (previous.pendingRetry === true ? now : 0);
  const needsRetryPass = retrySince > 0 && now - retrySince < RETRY_WINDOW_MS;
  const retryBefore = needsRetryPass ? retrySince : 0;

  if (changed || dueForRefresh) {
    await writeCache(env.DB, data, now, signature, retryBefore);
  }

  if (changed || needsRetryPass) {
    const hadFailures = await notifyUsers(env, previous.data, data, now);
    const retryAfter = hadFailures ? (retryBefore || now) : 0;
    if (retryAfter !== retryBefore || (previous.pendingRetry && !retryBefore)) {
      await writeCache(env.DB, data, changed || dueForRefresh ? now : (previous.fetchedAt || now), signature, retryAfter);
    }
  }
}

async function deliverChange(env, job, now) {
  const { key, user, oldStatus, newStatus } = job;
  let text;
  const m = M(user.lang);
  if (newStatus.state === "clear") {
    const start = oldStatus.since || user.last_alert_start;
    const duration = start ? formatDuration(now - new Date(start).getTime(), user.lang) : null;
    text = duration ? m.clearEnd(user.region_name, formatTimeKyiv(new Date(start)), formatTimeKyiv(new Date(now)), duration) : m.clear(user.region_name);
  } else {
    text = stateMessage(user.region_name, newStatus, user.lang);
  }
  const dedupeOccurrence = newStatus.state === "clear"
    ? (oldStatus.since || user.last_alert_start || "")
    : (newStatus.since || "");
  const dedupeName = `notified:${user.chat_id}:${newStatus.state}:${dedupeOccurrence}`;
  const alreadySent = await hasEphemeralFlag(dedupeName);
  const res = alreadySent ? { ok: true, permanent: false, status: 0 } : await sendTelegramTracked(env, user.chat_id, text);
  if (res.ok && !alreadySent) await setEphemeralFlag(dedupeName, 900);
  if (!res.ok && !res.permanent) {
    console.error(`[notify] delivery failed for chat ${user.chat_id}, will retry`);
    return false;
  }
  if (!res.ok && res.permanent) {
    console.error(`[notify] permanent failure for chat ${user.chat_id} (HTTP ${res.status}), not retrying`);
  }
  user.last_alert_state = newStatus.state;
  user.last_alert_active = newStatus.state !== "clear";
  user.last_alert_start = newStatus.state === "clear" ? null : newStatus.since;
  user.last_alert_end = newStatus.state === "clear" ? new Date(now).toISOString() : null;
  user.last_check = new Date(now).toISOString();
  try {
    await writeUser(env, key, user);
  } catch (e) {
    console.error("[notify] could not save user state (KV write failed?):", e);
  }
  return true;
}

async function notifyUsers(env, previousData, data, now) {
  const jobs = [];
  const allUsers = await listUsers(env);
  for (const user of allUsers) {
    if (!user || !user.chat_id || !user.oblast_key) continue;
    if (user.notify === false) continue;
    const newStatus = alertStatus(data, user.oblast_key, user.district_key);
    const knownState = user.last_alert_state || "clear";
    if (knownState === newStatus.state) continue;
    const oldStatus = alertStatus(previousData, user.oblast_key, user.district_key);
    jobs.push({ key: user.chat_id, user, oldStatus, newStatus });
  }

  let hadFailures = false;
  for (let i = 0; i < jobs.length; i += SEND_CONCURRENCY) {
    const results = await Promise.all(jobs.slice(i, i + SEND_CONCURRENCY).map(job =>
      deliverChange(env, job, now).catch(e => { console.error("[notify] deliver error:", e); return false; })
    ));
    if (results.some(ok => !ok)) hadFailures = true;
  }
  return hadFailures;
}

function formatDuration(ms, lang) {
  const u = M(lang).units;
  const seconds = Math.max(0, Math.round(ms / 1000));
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

const USER_COLUMNS = [
  "chat_id", "sync_token", "oblast_key", "district_key", "region_name", "lang", "notify",
  "last_activity", "telegram_connected", "telegram_username", "telegram_first_name", "telegram_last_name",
  "registered_at", "last_check", "last_alert_state", "last_alert_active", "last_alert_start", "last_alert_end"
];
const USER_BOOL_COLUMNS = new Set(["notify", "telegram_connected", "last_alert_active"]);

function rowToUser(row) {
  if (!row) return null;
  const user = {};
  for (const col of USER_COLUMNS) {
    user[col] = USER_BOOL_COLUMNS.has(col) ? !!row[col] : row[col];
  }
  return user;
}

async function readUser(env, chatId) {
  try {
    const row = await env.DB.prepare("SELECT * FROM users WHERE chat_id = ?1").bind(String(chatId)).first();
    return rowToUser(row);
  } catch (e) {
    console.error(`[user] read error for ${chatId}:`, e);
    return null;
  }
}

async function writeUser(env, chatId, user) {
  try {
    const data = { ...user, chat_id: String(chatId) };
    const cols = USER_COLUMNS;
    const placeholders = cols.map((_, i) => `?${i + 1}`).join(", ");
    const updates = cols.filter(c => c !== "chat_id").map(c => `${c} = excluded.${c}`).join(", ");
    const values = cols.map(c => {
      const v = data[c];
      if (v === undefined) return null;
      if (USER_BOOL_COLUMNS.has(c)) return v ? 1 : 0;
      return v;
    });
    await env.DB.prepare(
      `INSERT INTO users (${cols.join(", ")}) VALUES (${placeholders}) ON CONFLICT(chat_id) DO UPDATE SET ${updates}`
    ).bind(...values).run();
  } catch (e) {
    console.error(`[user] write error for ${chatId}:`, e);
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

async function listUsers(env) {
  try {
    const { results } = await env.DB.prepare("SELECT * FROM users").all();
    return (results || []).map(rowToUser);
  } catch (e) {
    console.error("[user] list error:", e);
    return [];
  }
}

async function randomToken() {
  const bytes = new Uint8Array(SYNC_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

async function checkAndSetEphemeralFlag(name, ttlSeconds) {
  const url = `https://ephemeral-flags.internal/${encodeURIComponent(name)}`;
  const key = new Request(url);
  const existing = await caches.default.match(key);
  if (existing) return false;
  const resp = new Response("1", { headers: { "Cache-Control": `max-age=${ttlSeconds}` } });
  await caches.default.put(key, resp);
  return true;
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
  return !!existing && !!existing.sync_token && typeof token === "string" && token === existing.sync_token;
}

async function handleTelegramWebhook(request, env) {
  try {
    return await handleTelegramWebhookInner(request, env);
  } catch (e) {
    console.error("[webhook] handler error:", e);
    return json({ ok: true, error: "logged" });
  }
}

async function handleTelegramWebhookInner(request, env) {
  if (env.WEBHOOK_SECRET) {
    const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
    if (!safeEqual(got, env.WEBHOOK_SECRET)) {
      return json({ ok: false }, 401);
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
      const chatIdKey = message.chat.id;
      const user = await readUser(env, chatIdKey);
      if (user) await writeUser(env, chatIdKey, {
        ...user,
        telegram_username: message.from.username || user.telegram_username || null,
        telegram_first_name: message.from.first_name || user.telegram_first_name || null,
        telegram_last_name: message.from.last_name || user.telegram_last_name || null,
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
    const deviceId = dashIdx >= 0 ? payload.slice(0, dashIdx) : payload;
    const lang = normLang(dashIdx >= 0 ? payload.slice(dashIdx + 1) : (message.from && message.from.language_code));

    await sendTelegramTracked(env, chatId, M(lang).linking);

    const syncToken = await randomToken();
    await env.USERS.put(
      `device:${deviceId}`,
      JSON.stringify({ chat_id: String(chatId), lang, sync_token: syncToken, connected_at: new Date().toISOString() }),
      { expirationTtl: DEVICE_LINK_TTL_SECONDS }
    );
  } else if (command === "/start") {
    await sendTelegramTracked(env, chatId, M(message.from && message.from.language_code).genericStart);
  } else if (command === "/status") {
    const user = await readUser(env, chatId);
    const lang = normLang(message.from && message.from.language_code || (user && user.lang));
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
  if (!env.WEBHOOK_SECRET) {
    return json({ ok: false, error: "WEBHOOK_SECRET not configured" }, 500);
  }
  const target = new URL(request.url);
  target.pathname = "/telegram/webhook";
  target.search = "";

  const setUrl = new URL(`${TELEGRAM_API}${env.BOT_TOKEN}/setWebhook`);
  setUrl.searchParams.set("url", target.toString());
  setUrl.searchParams.set("allowed_updates", JSON.stringify(["message", "callback_query"]));
  setUrl.searchParams.set("drop_pending_updates", "true");
  setUrl.searchParams.set("secret_token", env.WEBHOOK_SECRET);

  const r = await fetchWithTimeout(setUrl.toString(), {}, FETCH_TIMEOUT_MS);
  const body = await r.json();
  return json({ ok: r.ok, webhook_url: target.toString(), telegram_response: body });
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
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#141218"><title>Вход</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#141218;color:#e6e0e9;font:400 15px/22px Roboto,system-ui,sans-serif}
form{background:#211f26;border-radius:28px;padding:28px;width:min(380px,calc(100% - 32px));display:grid;gap:16px}
h1{margin:0;font:400 24px/32px Roboto,system-ui,sans-serif}p{margin:0;color:#cac4d0}.e{color:#f2b8b5}
input{background:#2b2930;border:0;border-bottom:2px solid #938f99;border-radius:12px 12px 0 0;height:56px;padding:0 16px;color:#e6e0e9;font-size:16px;outline:0}
input:focus{border-color:#d0bcff}.tools{display:flex;gap:8px}.tools button{flex:1;height:40px;background:#36343b;color:#e6e0e9;font:500 14px Roboto,system-ui,sans-serif}.h{font-size:12px;min-height:16px}button{height:48px;border:0;border-radius:24px;background:#d0bcff;color:#381e72;font:500 15px Roboto,system-ui,sans-serif;cursor:pointer}</style></head>
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

async function collectUsers(env, data) {
  const st = { total: 0, notifyOff: 0, noRegion: 0, byLang: {}, byState: {}, pending: 0, byOblast: {}, truncated: false };
  const allUsers = await listUsers(env);
  for (const u of allUsers) {
    if (!u) continue;
    st.total++;
    if (u.notify === false) st.notifyOff++;
    if (!u.oblast_key) { st.noRegion++; continue; }
    const lang = normLang(u.lang);
    st.byLang[lang] = (st.byLang[lang] || 0) + 1;
    const known = u.last_alert_state || "clear";
    st.byState[known] = (st.byState[known] || 0) + 1;
    st.byOblast[u.oblast_key] = (st.byOblast[u.oblast_key] || 0) + 1;
    if (data && u.notify !== false && alertStatus(data, u.oblast_key, u.district_key).state !== known) st.pending++;
  }
  st.byOblast = Object.entries(st.byOblast).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => ({ key: k, name: OBLAST_NAMES_UK[k] || k, n }));
  return st;
}

async function adminData(env, request, full, kvTest, probeUp) {
  const out = {
    version: WORKER_VERSION, time: new Date().toISOString(), langs: Object.keys(TEXTS),
    bindings: { alertsKey: !!env.ALERTS_API_KEY, botToken: !!env.BOT_TOKEN, db: !!env.DB, users: !!env.USERS },
    regions: { o: OBLAST_NAMES_UK, d: DISTRICT_NAMES_UK },
    config: { edgeTtl: EDGE_CACHE_TTL_SECONDS, cacheWriteIntervalSec: MIN_CACHE_WRITE_INTERVAL_SECONDS, retryWindowSec: RETRY_WINDOW_MS / 1000 }
  };
  const c = await readCache(env.DB);
  try { const cronRaw = await d1GetKV(env.DB, CRON_STATUS_KEY); out.cron = cronRaw ? JSON.parse(cronRaw) : null; } catch (e) { out.cron = null; }
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
    timed(async () => ({ stats: await collectUsers(env, c && c.data) })),
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

  if (!(await isAdmin(request, env))) {
    if (p === "/admin") return loginPage("");
    return new Response("Unauthorized", { status: 401 });
  }

  const userMatch = p.match(/^\/admin\/users\/(-?\d+)$/);
  if (userMatch && request.method === "GET") {
    const id = userMatch[1];
    const user = await readUser(env, id);
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
  if (p === "/admin/action" && request.method === "POST") {
    const name = url.searchParams.get("name");
    if (name === "setup-webhook") return await handleSetupWebhook(request, env);
    if (name === "debug-kv-users") {
      const out = [];
      let cursor;
      do {
        const page = await env.USERS.list({ prefix: "user:", limit: 1000, ...(cursor ? { cursor } : {}) });
        for (const item of page.keys || []) {
          let valueText = null, valueErr = null;
          try { valueText = await env.USERS.get(item.name); } catch (e) { valueErr = String(e); }
          out.push({
            name: item.name,
            expiration: item.expiration || null,
            metadataType: typeof item.metadata,
            metadata: item.metadata === undefined ? null : item.metadata,
            valueLength: valueText == null ? null : valueText.length,
            valueSample: valueText == null ? null : valueText.slice(0, 500),
            valueErr
          });
        }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      return adminJson({ ok: true, keys: out });
    }
    if (name === "migrate-users-kv-to-d1") {
      const purge = url.searchParams.get("purge") === "1";
      const migrated = [];
      const errors = [];
      let cursor;
      do {
        const page = await env.USERS.list({ prefix: "user:", limit: 1000, ...(cursor ? { cursor } : {}) });
        for (const item of page.keys || []) {
          const chatId = item.name.slice("user:".length);
          try {
            const userData = await env.USERS.get(item.name, "json");
            if (!userData || typeof userData !== "object") { errors.push({ chatId, error: "empty value" }); continue; }
            await writeUser(env, chatId, userData);
            migrated.push(chatId);
            if (purge) await env.USERS.delete(item.name);
          } catch (e) {
            errors.push({ chatId, error: String(e) });
          }
        }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      return adminJson({ ok: true, migrated, purged: purge, errors });
    }
    if (name === "purge-edge") {
      const u = new URL(request.url); u.pathname = "/api"; u.search = "";
      return adminJson({ ok: await caches.default.delete(new Request(u.toString(), { method: "GET" })) });
    }
    return adminJson({ error: "unknown action" }, 400);
  }
  return adminJson({ error: "not_found" }, 404);
}

const ADMIN_HTML = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#141218">
<title>Air Raid Worker</title>
<style>
:root{--f:Roboto,system-ui,-apple-system,"Segoe UI",sans-serif;--bg:#141218;--s1:#1d1b20;--s2:#211f26;--s3:#2b2930;--s4:#36343b;--tx:#e6e0e9;--tv:#cac4d0;--ol:#938f99;--olv:#49454f;
--pr:#d0bcff;--onpr:#381e72;--prc:#4f378b;--onprc:#eaddff;--sec:#ccc2dc;--secc:#4a4458;--onsecc:#e8def8;--ter:#efb8c8;
--err:#f2b8b5;--errc:#8c1d18;--ok:#a8dab5;--okc:#0f3d22;--warn:#ffd8a0;--warnc:#4a3200}
*,*::before,*::after{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:var(--bg);color:var(--tx);font:400 14px/20px Roboto,system-ui,-apple-system,"Segoe UI",sans-serif}
.app{display:flex;min-height:100vh}
.rail{width:88px;flex:none;position:sticky;top:0;height:100vh;background:var(--bg);display:flex;flex-direction:column;align-items:center;padding:20px 0;gap:14px;border-right:1px solid var(--olv)}
.ni{display:flex;flex-direction:column;align-items:center;gap:4px;font:500 12px/16px var(--f);color:var(--tv);border:0;background:none;cursor:pointer;width:80px;padding:0}
.ni .pill{width:56px;height:32px;border-radius:16px;display:grid;place-items:center;transition:background .2s}
.ni:hover .pill{background:var(--s3)}.ni.on{color:var(--tx)}.ni.on .pill{background:var(--secc);color:var(--onsecc)}
.ni svg{width:24px;height:24px;fill:currentColor}
.main{flex:1;min-width:0}
.top{position:sticky;top:0;z-index:5;background:var(--bg);height:60px;display:flex;align-items:center;gap:12px;padding:0 16px}
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
.card{background:var(--s2);border-radius:16px;padding:16px}
.card h2{margin:0 0 8px;font:500 14px/20px var(--f);color:var(--pr);letter-spacing:.1px}
.hero{border-radius:28px;padding:24px;display:flex;gap:16px;align-items:center}
.hero.ok{background:var(--prc);color:var(--onprc)}.hero.warn{background:var(--warnc);color:var(--warn)}.hero.bad{background:var(--errc);color:var(--err)}
.hero .ic{width:56px;height:56px;border-radius:28px;background:rgba(255,255,255,.12);display:grid;place-items:center;font-size:28px;flex:none}
.hero b{display:block;font:400 24px/32px var(--f)}.hero span{opacity:.85}
.metrics{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.m{background:var(--s2);border-radius:16px;padding:16px}.m .v{font:400 32px/40px var(--f);color:var(--tx)}.m .l{color:var(--tv);font-size:12px}
.m.hl{background:var(--secc)}.m.hl .v{color:var(--onsecc)}
.li{display:flex;align-items:center;gap:16px;padding:10px 0;border-bottom:1px solid var(--olv);cursor:default}
.li:last-child{border:0}.li .av{width:40px;height:40px;border-radius:20px;background:var(--secc);color:var(--onsecc);display:grid;place-items:center;flex:none;font-size:18px}
.li .av.ok{background:var(--okc);color:var(--ok)}.li .av.warn{background:var(--warnc);color:var(--warn)}.li .av.bad{background:var(--errc);color:var(--err)}
.li .t{flex:1;min-width:0}.li .t b{display:block;font-weight:500;overflow:hidden;text-overflow:ellipsis}.li .t span{color:var(--tv);font-size:12px;word-break:break-word}
.li .e{color:var(--tv);font-size:12px;text-align:right;white-space:nowrap}
.kv{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--olv)}.kv:last-child{border:0}
.kv span:first-child{color:var(--tv)}.kv span:last-child{text-align:right;word-break:break-word}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--err)}
.chips{display:flex;gap:8px;flex-wrap:wrap}
.chip{height:32px;padding:0 14px;border-radius:8px;border:1px solid var(--ol);background:none;color:var(--tv);font:500 13px var(--f);cursor:pointer}
.chip.on{background:var(--secc);color:var(--onsecc);border-color:transparent}
.field{background:var(--s3);border-radius:28px;height:48px;display:flex;align-items:center;padding:0 16px;gap:12px}
.field input{flex:1;min-width:0;width:100%;background:none;border:0;outline:0;color:var(--tx);font:inherit;font-size:16px}
.btn{height:40px;padding:0 24px;border-radius:20px;border:0;font:500 14px var(--f);cursor:pointer;background:var(--secc);color:var(--onsecc)}
.btn:hover{filter:brightness(1.15)}.btn.f{background:var(--pr);color:var(--onpr)}.btn.o{background:none;border:1px solid var(--ol);color:var(--pr);flex:none;white-space:nowrap}.btn.t{background:none;color:var(--pr);padding:0 12px}
.row{display:flex;gap:8px;flex-wrap:wrap}.row .field{min-width:0}
.bar{height:8px;border-radius:4px;background:var(--s3);overflow:hidden;margin-top:4px}.bar i{display:block;height:100%;background:var(--pr);border-radius:4px}
.bl{display:flex;justify-content:space-between;margin-top:10px;font-size:13px}
.tag{padding:2px 10px;border-radius:8px;font-size:12px;font-weight:500}.tag.red{background:var(--errc);color:var(--err)}.tag.yellow{background:var(--warnc);color:var(--warn)}
.empty{text-align:center;color:var(--tv);padding:32px 8px}.empty .big{font-size:40px}
pre{margin:0;white-space:pre-wrap;word-break:break-all;font:12px/16px ui-monospace,Menlo,monospace;color:var(--tv);max-height:360px;overflow:auto}
.fab{position:fixed;right:16px;bottom:24px;height:56px;padding:0 20px 0 16px;border-radius:16px;border:0;background:var(--prc);color:var(--onprc);font:500 14px var(--f);display:flex;align-items:center;gap:12px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.5);z-index:6}
.fab svg{width:24px;height:24px;fill:currentColor}
.scrim{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;place-items:center;z-index:20}.scrim.on{display:grid}
.dlg{background:var(--s3);border-radius:28px;padding:24px;width:min(360px,calc(100% - 32px))}.dlg h3{margin:0 0 16px;font:400 24px/32px var(--f)}.dlg p{margin:0 0 24px;color:var(--tv)}.dlg .row{justify-content:flex-end}
.snack{position:fixed;left:50%;transform:translate(-50%,16px);opacity:0;visibility:hidden;pointer-events:none;bottom:96px;background:#e6e0e9;color:#322f35;padding:14px 16px;border-radius:12px;max-width:calc(100% - 32px);z-index:30;box-shadow:0 4px 12px rgba(0,0,0,.4);transition:transform .3s cubic-bezier(.2,0,0,1),opacity .3s ease,visibility 0s .3s}
.snack.on{transform:translate(-50%,0);opacity:1;visibility:visible;transition:transform .3s cubic-bezier(.2,0,0,1),opacity .3s ease,visibility 0s}
.tag.green{background:var(--okc);color:var(--ok)}
.sh{margin:14px 0 2px;font:500 12px/16px var(--f);color:var(--tv);letter-spacing:.5px;text-transform:uppercase}
.menu{display:none;position:absolute;right:0;top:44px;background:var(--s3);border-radius:12px;padding:8px 0;min-width:280px;box-shadow:0 4px 16px rgba(0,0,0,.6);z-index:15}.menu.on{display:block}
.mi{display:flex;gap:12px;padding:12px 16px;cursor:pointer}.mi:hover{background:var(--s4)}.mi span{width:16px;color:var(--pr)}.mi.on{color:var(--pr)}
@media(max-width:600px){.menu{position:fixed;left:16px;right:16px;top:auto;bottom:100px;min-width:0}}
@media(min-width:840px){.metrics{grid-template-columns:repeat(4,1fr)}.fab{bottom:24px}.snack{bottom:24px}}
@media(max-width:839px){.rail{position:fixed;bottom:0;left:0;right:0;top:auto;width:100%;height:80px;flex-direction:row;justify-content:space-around;padding:12px 0 calc(12px + env(safe-area-inset-bottom,0px));background:var(--s2);border:0;z-index:10;height:auto}
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
 var o='<div class="hero card '+h.lvl+'"><div class="ic">'+T[0]+'</div><div><b>'+T[1]+'</b><span>'+esc(h.is.length?h.is.join(" · "):T[2])+'</span></div></div>';
 o+='<div class="metrics"><div class="m'+(n?' hl':'')+'"><div class="v">'+n+'</div><div class="l">Активных тревог</div></div>'
  +'<div class="m"><div class="v '+(s?(s.ageSeconds>2100?"bad":""):"bad")+'">'+(s?age(s.ageSeconds):"—")+'</div><div class="l">Возраст снапшота</div></div>'
  +'<div class="m"><div class="v">'+(f.users&&f.users.ok?f.users.stats.total:"—")+'</div><div class="l">Пользователей</div></div>'
  +'<div class="m"><div class="v">'+(f.users&&f.users.ok?f.users.stats.pending:"—")+'</div><div class="l">Ждут доставки</div></div></div>';
 var u=f.upstream,w=f.webhook,c=d.cron,L="";
 L+=li("⚙",d.bindings.alertsKey&&d.bindings.botToken&&d.bindings.db&&d.bindings.users?"ok":"bad","Переменные и биндинги","API key "+(d.bindings.alertsKey?"✓":"✕")+" · Bot "+(d.bindings.botToken?"✓":"✕")+" · D1 "+(d.bindings.db?"✓":"✕")+" · KV users "+(d.bindings.users?"✓":"✕"),"","sy");
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
function vSy(){var d=S.d,f=S.f,s=d.snapshot,o="";
 o+=card("Действия",'<div class="row"><button class="btn" onclick="load(true)">Полная проверка</button><button class="btn" onclick="load(true,false,false,true)">Проверить alerts.in.ua</button><button class="btn" onclick="load(true,true)">Тест записи D1</button><button class="btn o" onclick="ask(\\'purge-edge\\',\\'Сбросить кэш /api?\\',\\'Следующий запрос плагина пойдёт в D1/upstream.\\')">Сбросить кэш /api</button><button class="btn o" onclick="ask(\\'setup-webhook\\',\\'Установить webhook?\\',\\'Выполнится setWebhook с drop_pending_updates=true — очередь ожидающих апдейтов будет очищена.\\')">Setup webhook</button><button class="btn o" onclick="migrateUsers(false)">Мигрировать KV→D1</button><button class="btn o" onclick="migrateUsers(true)">Мигрировать KV→D1 (purge)</button><button class="btn o" onclick="debugKv()">Отладка KV user:*</button></div>');
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
 $("dy").onclick=function(){$("scrim").classList.remove("on");busy(1);fetch("/admin/action?name="+name,{method:"POST"}).then(function(r){return r.json()}).then(function(j){snack(name+": "+(j.ok?"успешно":JSON.stringify(j).slice(0,120)));load(true,false,true)}).catch(function(e){snack("Ошибка: "+e)}).then(function(){busy(-1)})}}
function debugKv(){
 busy(1);
 fetch("/admin/action?name=debug-kv-users",{method:"POST"}).then(function(r){return r.json()}).then(function(j){
  alert(JSON.stringify(j.keys||j,null,2).slice(0,3500));
 }).catch(function(e){snack("Ошибка: "+e)}).then(function(){busy(-1)})
}
function migrateUsers(purge){
 if(!confirm(purge?"Перенести пользователей KV→D1 и удалить старые KV-записи?":"Перенести пользователей KV→D1 (без удаления старых KV-записей)?"))return;
 busy(1);
 fetch("/admin/action?name=migrate-users-kv-to-d1"+(purge?"&purge=1":""),{method:"POST"}).then(function(r){return r.json()}).then(function(j){
  alert("Migrated: "+((j.migrated||[]).length)+" ("+((j.migrated||[]).join(", ")||"—")+")\\nErrors: "+JSON.stringify(j.errors||[]));
  load(true,false,true)
 }).catch(function(e){snack("Ошибка: "+e)}).then(function(){busy(-1)})
}
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

    const adminGate = (url.pathname === "/setup-webhook" || url.pathname === "/webhook-info") &&
      env.ADMIN_TOKEN && !(await isAdmin(request, env));
    if (adminGate) return new Response("Unauthorized. Open /admin?token=... first", { status: 401 });

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

    if (url.pathname === "/health") {
      const out = { version: WORKER_VERSION, langs: Object.keys(TEXTS), time: new Date().toISOString(), hasAlertsKey: !!env.ALERTS_API_KEY, hasBotToken: !!env.BOT_TOKEN };
      try {
        const c = await readCache(env.DB);
        out.snapshot = c ? { ageSeconds: Math.round((Date.now() - (c.fetchedAt || 0)) / 1000), pendingRetry: c.pendingRetry || 0 } : null;
      } catch (e) { out.snapshot = { error: String(e).slice(0, 200) }; }
      if (await isAdmin(request, env)) {
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
      return await handleTelegramWebhook(request, env);
    }

    const deviceMatch = url.pathname.match(/^\/telegram\/get-chat-id\/([a-zA-Z0-9-]+)$/);
    if (deviceMatch && method === "GET") {
      const data = await env.USERS.get(`device:${deviceMatch[1]}`, "json");
      if (data && data.chat_id && data.sync_token) return json({ ok: true, chat_id: data.chat_id, sync_token: data.sync_token, lang: normLang(data.lang) });
      return json({ ok: false, chat_id: null });
    }

    if (url.pathname === "/register" && method === "POST") {
      try {
        const body = await request.json();
        const { chat_id, oblast_key, district_key, region_name, sync_token } = body;
        if (!chat_id) return json({ error: "missing chat_id" }, 400);

        const key = String(chat_id);
        const existing = await readUser(env, key);
        const lang = body.lang ? normLang(body.lang) : normLang(existing && existing.lang);

        let deviceLink = null;
        if (body.device_id) {
          const candidate = await env.USERS.get(`device:${body.device_id}`, "json");
          if (candidate && String(candidate.chat_id) === String(chat_id) && validSyncToken(candidate, sync_token)) {
            deviceLink = candidate;
          }
        }

        if (existing && existing.sync_token && !validSyncToken(existing, sync_token) && !deviceLink) {
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

        const sameLocation = !!existing &&
          String(existing.oblast_key || "") === String(oblast_key || "") &&
          String(existing.district_key || "") === String(district_key || "");

        const prevNotify = existing ? existing.notify !== false : true;
        const notify = typeof body.notify === "boolean" ? body.notify : prevNotify;
        const notifyChanged = !!existing && notify !== prevNotify;
        const relinked = !!deviceLink;
        const resync = !existing || !sameLocation || (notifyChanged && notify) || relinked;
        const changed = !existing || !sameLocation || notifyChanged || relinked;

        const hasLocation = !!oblast_key;
        const snapshot = hasLocation ? await getSharedSnapshot(env) : null;
        const status = hasLocation
          ? alertStatus(snapshot.data, String(oblast_key), district_key ? String(district_key) : null)
          : { state: "clear", since: null };

        const userData = {
          chat_id: String(chat_id),
          sync_token: token,
          oblast_key: hasLocation ? String(oblast_key) : null,
          district_key: hasLocation && district_key ? String(district_key) : null,
          region_name: hasLocation ? (region_name || "Unknown") : null,
          lang,
          notify,
          last_activity: new Date().toISOString(),
          telegram_connected: true,
          registered_at: existing && existing.registered_at ? existing.registered_at : new Date().toISOString(),
          last_check: new Date().toISOString(),
          last_alert_state: resync ? status.state : (existing.last_alert_state || (existing.last_alert_active ? "red" : "clear")),
          last_alert_active: resync ? status.state !== "clear" : existing.last_alert_active,
          last_alert_start: resync ? status.since : existing.last_alert_start,
          last_alert_end: resync ? null : existing.last_alert_end
        };

        const nothingChanged = !!existing && !relinked &&
          String(existing.oblast_key || "") === String(userData.oblast_key || "") &&
          String(existing.district_key || "") === String(userData.district_key || "") &&
          String(existing.region_name || "") === String(userData.region_name || "") &&
          normLang(existing.lang) === userData.lang &&
          (existing.notify !== false) === notify &&
          existing.sync_token === token;
        if (!nothingChanged) await writeUser(env, key, userData);
        const isNewDeviceLink = !!deviceLink;
        if (deviceLink) await env.USERS.delete(`device:${body.device_id}`);

        const sendNotifications = async () => {
          const m = M(lang);
          if (isNewDeviceLink) {
            await sendTelegramTracked(env, chat_id, m.connected);
          }
          if (notify) {
            if (hasLocation && (!existing || !sameLocation || notifyChanged || relinked)) {
              await sendTelegramTracked(env, chat_id, m.subscribed(region_name));
              await sendTelegramTracked(env, chat_id, stateMessage(region_name, status, lang));
            } else if (!hasLocation && notifyChanged) {
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
          status: {
            state: hasLocation ? status.state : null,
            active: hasLocation ? status.state !== "clear" : null,
            since: hasLocation ? status.since : null,
            fetchedAt: snapshot ? snapshot.fetchedAt : null,
            lastUpstreamCheckAt: snapshot ? (snapshot.heartbeat || null) : null,
            stale: snapshot ? (snapshot.heartbeat ? (Date.now() - snapshot.heartbeat > 180000) : true) : null
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

        const existing = await readUser(env, chat_id);
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

        const existing = await readUser(env, chat_id);
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
    await checkAllUsers(env);
          }
};