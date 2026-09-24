const ALERTS_API = "https://api.alerts.in.ua/v1/alerts/active.json";
const TELEGRAM_API = "https://api.telegram.org/bot";
const FETCH_TIMEOUT_MS = 5000;
const EDGE_CACHE_TTL_SECONDS = 10; // plugin-facing /api cache; low so plugins see changes almost as fast as the bot
const SEND_CONCURRENCY = 15; // parallel Telegram sends (Telegram limit ~30 msg/s)
const MIN_CACHE_WRITE_INTERVAL_SECONDS = 1800;
const RETRY_WINDOW_MS = 5 * 60 * 1000; // stop retrying failed deliveries after 5 min (old alerts are useless)
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

async function readCache(cache) {
  try {
    const cached = await cache.get(SNAPSHOT_KEY, { cacheTtl: 30 }); // 30s = KV minimum edge cache
    if (!cached) return null;
    const wrapped = JSON.parse(cached);
    if (wrapped && wrapped.data && isValidAlerts(wrapped.data)) return wrapped;
  } catch (e) {
    console.error("[cache] read error:", e);
  }
  return null;
}

async function writeCache(cache, data, fetchedAt = Date.now(), signature = null, pendingRetry = 0) {
  try {
    await cache.put(
      SNAPSHOT_KEY,
      JSON.stringify({ fetchedAt, signature: signature || buildStatusSignature(data), data, pendingRetry: Number(pendingRetry) || 0 })
    );
  } catch (e) {
    console.error("[cache] write error:", e);
  }
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
  "Кір��воградська область": "kirovohradska",
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
  if (!r.ok) throw new Error(`alerts.in.ua HTTP ${r.status}`);
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

function statusChanged(previous, current) {
  if (!previous) return true;
  const prevSig = previous.signature || buildStatusSignature(previous.data);
  const currSig = buildStatusSignature(current);
  return prevSig !== currSig;
}

async function getSharedSnapshot(env) {
  const cached = await readCache(env.CACHE);
  if (cached) {
    return { ...cached, heartbeat: cached.fetchedAt };
  }

  const data = await fetchUpstream(env);
  const fetchedAt = Date.now();
  const signature = buildStatusSignature(data);
  await writeCache(env.CACHE, data, fetchedAt, signature);
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

  const stored = await readCache(env.CACHE);
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

  const data = await fetchUpstream(env);
  const fetchedAt = Date.now();
  const signature = buildStatusSignature(data);
  await writeCache(env.CACHE, data, fetchedAt, signature);
  const payload = { ...data, fetchedAt, snapshotSignature: signature, lastUpstreamCheckAt: fetchedAt, stale: false, staleAgeSeconds: 0 };
  const response = new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${EDGE_CACHE_TTL_SECONDS}` }
  });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  else await caches.default.put(cacheKey, response.clone());
  return { ...payload, serverTime: new Date().toISOString() };
}

function slug(v) {
  return String(v || "").trim().toLowerCase().replace(/ё/g, "е").replace(/і/g, "i").replace(/ї/g, "i").replace(/є/g, "ie").replace(/ґ/g, "g").replace(/[^a-zа-яіїє0-9]+/gi, "-").replace(/^-+|-+$/g, "");
}

function normalizeText(v) {
  return String(v || "").trim().toLowerCase().replace(/’/g, "'").replace(/\s+/g, " ");
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
    if (key === wanted || key.split(":")[1] === district) return x;
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

function stateMessage(region, status) {
  if (status.state === "red") return MESSAGES.red(region, formatTimeKyiv(new Date(status.since || Date.now())));
  if (status.state === "yellow") return MESSAGES.yellow(region, formatTimeKyiv(new Date(status.since || Date.now())));
  return MESSAGES.clear(region);
}

async function checkAllUsers(env) {
  const previous = await readCache(env.CACHE);
  let data;
  try {
    data = await fetchUpstream(env);
  } catch (e) {
    console.error("[upstream] scheduled fetch error:", e);
    return;
  }
  const now = Date.now();
  const signature = buildStatusSignature(data);

  if (!previous) {
    await writeCache(env.CACHE, data, now, signature);
    return;
  }

  const changed = previous.signature !== signature;
  const lastWriteAt = previous.fetchedAt || 0;
  const dueForRefresh = now - lastWriteAt >= MIN_CACHE_WRITE_INTERVAL_SECONDS * 1000;
  const retrySince = typeof previous.pendingRetry === "number" ? previous.pendingRetry : (previous.pendingRetry === true ? now : 0);
  const needsRetryPass = retrySince > 0 && now - retrySince < RETRY_WINDOW_MS;
  const retryBefore = needsRetryPass ? retrySince : 0;

  if (changed || dueForRefresh) {
    await writeCache(env.CACHE, data, now, signature, retryBefore);
  }

  if (changed || needsRetryPass) {
    const hadFailures = await notifyUsers(env, previous.data, data, now);
    const retryAfter = hadFailures ? (retryBefore || now) : 0;
    if (retryAfter !== retryBefore || (previous.pendingRetry && !retryBefore)) {
      await writeCache(env.CACHE, data, changed || dueForRefresh ? now : (previous.fetchedAt || now), signature, retryAfter);
    }
  }
}

async function deliverChange(env, job, now) {
  const { key, user, oldStatus, newStatus } = job;
  let text;
  if (newStatus.state === "clear") {
    const start = oldStatus.since || user.last_alert_start;
    const duration = start ? formatDuration(now - new Date(start).getTime()) : null;
    text = duration ? MESSAGES.clearEnd(user.region_name, formatTimeKyiv(new Date(start)), formatTimeKyiv(new Date(now)), duration) : MESSAGES.clear(user.region_name);
  } else {
    text = stateMessage(user.region_name, newStatus);
  }
  const res = await sendTelegramDetailed(env.BOT_TOKEN, user.chat_id, text);
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
  await writeUser(env, key, user);
  return true;
}

async function notifyUsers(env, previousData, data, now) {
  const jobs = [];
  let cursor;
  do {
    const page = await env.USERS.list({ prefix: "user:", limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const item of page.keys || []) {
      const user = item.metadata || await readUser(env, item.name);
      if (!user || !user.chat_id || !user.oblast_key) continue;
      if (user.notify === false) continue;
      const newStatus = alertStatus(data, user.oblast_key, user.district_key);
      const knownState = user.last_alert_state || "clear";
      if (knownState === newStatus.state) continue;
      const oldStatus = alertStatus(previousData, user.oblast_key, user.district_key);
      jobs.push({ key: item.name, user, oldStatus, newStatus });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  let hadFailures = false;
  for (let i = 0; i < jobs.length; i += SEND_CONCURRENCY) {
    const results = await Promise.all(jobs.slice(i, i + SEND_CONCURRENCY).map(job =>
      deliverChange(env, job, now).catch(e => { console.error("[notify] deliver error:", e); return false; })
    ));
    if (results.some(ok => !ok)) hadFailures = true;
  }
  return hadFailures;
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${mins} хв`;
  if (mins === 0) return `${hours} год`;
  return `${hours} год ${mins} хв`;
}

const MESSAGES = {
  connected: "🟢 Telegram-бот підключено",
  genericStart: "Щоб підключити сповіщення, натисни кнопку в налаштуваннях плагіна Air Raid Alert.",
  subscribed: region => `✅ Підписка активна: <b>${region}</b>`,
  clear: region => `🟢 <b>Тривоги немає</b>\n${region}`,
  yellow: (region,time) => `🟡 <b>Жовтий рівень загрози</b>\n${region} • ${time}`,
  red: (region,time) => `🔴 <b>Повітряна тривога</b>\n${region} • ${time}`,
  clearEnd: (region,start,end,duration) => `🟢 <b>Тривоги немає</b>\n${region} • ${start}–${end} • ${duration}`,
  enabled: "✅ Сповіщення через Telegram увімкнено",
  unsubscribed: "❌ Сповіщення через Telegram вимкнено",
  test: "⚪ Це тестове повідомлення від Air Raid Alert."
};

async function sendTelegramMessage(botToken, chatId, text) {
  return (await sendTelegramDetailed(botToken, chatId, text)).ok;
}

// Returns { ok, permanent, status }. permanent = retrying can never help
// (403 bot blocked, 400 chat not found, 404).
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
    if (!r.ok) {
      console.error(`[telegram] sendMessage HTTP ${r.status}:`, await r.text());
      const permanent = r.status === 400 || r.status === 403 || r.status === 404;
      return { ok: false, permanent, status: r.status };
    }
    return { ok: true, permanent: false, status: r.status };
  } catch (e) {
    console.error("[telegram] sendMessage error:", e);
    return { ok: false, permanent: false, status: 0 };
  }
}

async function readUser(env, key) {
  try {
    const result = await env.USERS.getWithMetadata(key);
    if (!result) return null;
    
    let userData = result.metadata;
    if (typeof userData === "string") {
      try {
        userData = JSON.parse(userData);
      } catch (parseErr) {
        console.error(`[user] failed to parse metadata for ${key}:`, parseErr);
        return null;
      }
    }
    
    if (userData && typeof userData === "object") return userData;
  } catch (e) {
    console.error(`[user] read error for ${key}:`, e);
  }
  return null;
}

async function writeUser(env, key, user) {
  try {
    await env.USERS.put(key, "", { metadata: user });
  } catch (e) {
    console.error(`[user] write error for ${key}:`, e);
    throw e;
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

async function markUpdateProcessed(env, updateId) {
  if (updateId === undefined || updateId === null) return true;
  return await checkAndSetEphemeralFlag(`tg-update:${updateId}`, UPDATE_DEDUP_TTL_SECONDS);
}

function validSyncToken(existing, token) {
  return !!existing && !!existing.sync_token && typeof token === "string" && token === existing.sync_token;
}

async function handleTelegramWebhook(request, env) {
  let update;
  try {
    update = await request.json();
  } catch (e) {
    return json({ ok: false }, 400);
  }

  if (!(await markUpdateProcessed(env, update.update_id))) return json({ ok: true, duplicate: true });

  const message = update.message;
  if (!message || !message.text) return json({ ok: true });

  const chatId = message.chat.id;
  const parts = message.text.trim().split(/\s+/);
  const command = parts[0];
  const payload = parts[1];

  if (command === "/start" && payload) {
    const dashIdx = payload.lastIndexOf("-");
    const deviceId = dashIdx >= 0 ? payload.slice(0, dashIdx) : payload;
    const lang = "uk";

    const syncToken = await randomToken();
    await env.USERS.put(
      `device:${deviceId}`,
      JSON.stringify({ chat_id: String(chatId), lang, sync_token: syncToken, connected_at: new Date().toISOString() }),
      { expirationTtl: DEVICE_LINK_TTL_SECONDS }
    );
  } else if (command === "/start") {
    await sendTelegramMessage(env.BOT_TOKEN, chatId, MESSAGES.genericStart);
  }

  return json({ ok: true });
}

async function handleSetupWebhook(request, env) {
  if (!env.BOT_TOKEN) {
    return json({ ok: false, error: "BOT_TOKEN not configured" }, 500);
  }
  const target = new URL(request.url);
  target.pathname = "/telegram/webhook";
  target.search = "";

  const setUrl = new URL(`${TELEGRAM_API}${env.BOT_TOKEN}/setWebhook`);
  setUrl.searchParams.set("url", target.toString());
  setUrl.searchParams.set("allowed_updates", JSON.stringify(["message", "callback_query"]));
  setUrl.searchParams.set("drop_pending_updates", "true");

  const r = await fetchWithTimeout(setUrl.toString(), {}, FETCH_TIMEOUT_MS);
  const body = await r.json();
  return json({ ok: r.ok, webhook_url: target.toString(), telegram_response: body });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/") {
      return json({ ok: true, service: "Air Raid Alert — Universal Worker" });
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
      if (data && data.chat_id && data.sync_token) return json({ ok: true, chat_id: data.chat_id, sync_token: data.sync_token, lang: "uk" });
      return json({ ok: false, chat_id: null });
    }

    if (url.pathname === "/register" && method === "POST") {
      try {
        const body = await request.json();
        const { chat_id, oblast_key, district_key, region_name, sync_token } = body;
        const lang = "uk";
        if (!chat_id) return json({ error: "missing chat_id" }, 400);

        const key = `user:${chat_id}`;
        const existing = await readUser(env, key);

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
          String(existing.oblast_key) === String(oblast_key) &&
          String(existing.district_key || "") === String(district_key || "") &&
          String(existing.region_name || "") === String(region_name || "");
        const sameLanguage = !!existing && existing.lang === "uk";

        const prevNotify = existing ? existing.notify !== false : true;
        const notify = typeof body.notify === "boolean" ? body.notify : prevNotify;
        const notifyChanged = !!existing && notify !== prevNotify;
        const resync = !existing || !sameLocation || (notifyChanged && notify);
        const changed = !existing || !sameLocation || !sameLanguage || notifyChanged;

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
          registered_at: existing?.registered_at || new Date().toISOString(),
          last_check: new Date().toISOString(),
          last_alert_state: status.state,
          last_alert_active: status.state !== "clear",
          last_alert_start: status.since,
          last_alert_end: status.state === "clear" ? new Date().toISOString() : null,
          ...((existing && typeof existing === 'object') ? existing : {})
        };

        await writeUser(env, key, userData);
        if (deviceLink) await env.USERS.delete(`device:${body.device_id}`);

        return json({ ok: true, registered: true, status: userData.last_alert_state, sync_token: token, resync, changed });
      } catch (e) {
        return json({ ok: false, error: String(e) }, 500);
      }
    }

    return json({ ok: false, error: "not found" }, 404);
  }
};
