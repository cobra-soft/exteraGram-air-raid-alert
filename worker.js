const ALERTS_API = "https://api.alerts.in.ua/v1/alerts/active.json";
const TELEGRAM_API = "https://api.telegram.org/bot";
const FETCH_TIMEOUT_MS = 5000;
const EDGE_CACHE_TTL_SECONDS = 10; // plugin-facing /api cache; low so plugins see changes almost as fast as the bot
const SEND_CONCURRENCY = 15; // parallel Telegram sends (Telegram limit ~30 msg/s)
const MIN_CACHE_WRITE_INTERVAL_SECONDS = 1800;
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

function isValidAlerts(data) {
  return data && typeof data === "object" &&
    Array.isArray(data.raions) && Array.isArray(data.oblasts);
}

async function readCache(cache) {
  try {
    const cached = await cache.get(SNAPSHOT_KEY, { cacheTtl: 30 });
    if (!cached) return null;
    const wrapped = JSON.parse(cached);
    if (wrapped && wrapped.data && isValidAlerts(wrapped.data)) return wrapped;
  } catch (e) {
    console.error("[cache] read error:", e);
  }
  return null;
}

async function writeCache(cache, data, fetchedAt = Date.now(), signature = null) {
  try {
    await cache.put(
      SNAPSHOT_KEY,
      JSON.stringify({ fetchedAt, signature: signature || buildStatusSignature(data), data })
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

async function fetchUpstream(env) {
  if (!env.ALERTS_API_KEY) throw new Error("ALERTS_API_KEY not configured");
  const r = await fetchWithTimeout("https://api.alerts.in.ua/v1/alerts/active.json", {
    headers: { Authorization: `Bearer ${env.ALERTS_API_KEY}` }
  }, FETCH_TIMEOUT_MS);
  if (!r.ok) throw new Error(`alerts.in.ua HTTP ${r.status}`);
  const json = await r.json();
  if (!json.alerts) return { alerts: [], oblasts: [], raions: [] };

  const oblasts = {};
  const raions = [];

  for (const alert of json.alerts) {
    if (alert.alert_type !== "air_raid") continue;

    const oblastSlug = OBLAST_NAME_NORM_TO_SLUG[normalizeUk(alert.location_oblast)];
    if (!oblastSlug) {
      console.error(`[alerts.in.ua] unknown oblast name: ${alert.location_oblast}`);
      continue;
    }

    if (alert.location_type === "oblast") {
      oblasts[oblastSlug] = {
        key: oblastSlug,
        name: alert.location_oblast,
        oblast: alert.location_oblast,
        alert_level: alert.alert_level,
        started_at: alert.started_at
      };
    } else if (alert.location_type === "raion") {
      const raionName = alert.location_raion || alert.location_title;
      if (!raionName) {
        console.error(`[alerts.in.ua] raion alert with no name (id ${alert.id}) in ${alert.location_oblast}`);
        continue;
      }
      raions.push({
        key: `${oblastSlug}:${slug(raionName)}`,
        oblast: alert.location_oblast,
        name: raionName,
        alert_level: alert.alert_level,
        started_at: alert.started_at
      });
    }
  }

  return {
    alerts: json.alerts,
    oblasts: Object.values(oblasts),
    raions
  };
}

function slug(v) {
  return String(v || "").trim().toLowerCase().replace(/ё/g, "е").replace(/і/g, "i").replace(/ї/g, "i").replace(/є/g, "ie").replace(/ґ/g, "g").replace(/[^a-zа-яіїє0-9]+/gi, "-").replace(/^-+|-+$/g, "");
}

function buildStateSignature(data) {
  const items = [];
  for (const x of data?.oblasts || []) {
    if (!x || typeof x !== "object") continue;
    const key = String(x.key || "");
    if (key) items.push(`o:${key}:${String(x.alert_level || "red").toLowerCase()}`);
  }
  for (const x of data?.raions || []) {
    if (!x || typeof x !== "object") continue;
    const key = String(x.key || "");
    if (key) items.push(`r:${key}:${String(x.alert_level || "red").toLowerCase()}`);
  }
  items.sort((a, b) => a.localeCompare(b));
  return JSON.stringify(items);
}

function alertStatus(data, oblastKey, districtKey) {
  if (!data || !oblastKey) return { state: "clear", since: null };
  const district = districtKey ? String(districtKey) : "";

  if (district) {
    for (const entry of data.raions || []) {
      if (String(entry.key || "") === `${oblastKey}:${district}`) {
        return { state: entry.alert_level === "yellow" ? "yellow" : "red", since: entry.started_at };
      }
    }
  }

  for (const entry of data.oblasts || []) {
    if (String(entry.key || "") === oblastKey) {
      return { state: entry.alert_level === "yellow" ? "yellow" : "red", since: entry.started_at };
    }
  }

  return { state: "clear", since: null };
}

async function getSharedSnapshot(env) {
  const cached = await readCache(env.CACHE);
  if (cached) return { ...cached, heartbeat: cached.fetchedAt };

  const data = await fetchUpstream(env);
  const fetchedAt = Date.now();
  const signature = buildStatusSignature(data);
  await writeCache(env.CACHE, data, fetchedAt, signature);
  return { fetchedAt, signature, data, heartbeat: fetchedAt };
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
  const dueForRefresh = now - lastWriteAt >= 1800 * 1000;

  if (changed || dueForRefresh) {
    await writeCache(env.CACHE, data, now, signature);
  }
}

async function randomToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function markUpdateProcessed(env, updateId) {
  if (updateId === undefined || updateId === null) return true;
  return true;
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
    const syncToken = await randomToken();

    await env.USERS.put(
      `device:${deviceId}`,
      JSON.stringify({ chat_id: String(chatId), lang: "uk", sync_token: syncToken, connected_at: new Date().toISOString() }),
      { expirationTtl: 600 }
    );
  }

  return json({ ok: true });
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

function validSyncToken(existing, token) {
  return !!existing && !!existing.sync_token && typeof token === "string" && token === existing.sync_token;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Cache-Control": "no-store" } });
    }

    if (url.pathname === "/") {
      return json({ ok: true, service: "Air Raid Alert — Universal Worker" });
    }

    if (url.pathname === "/api") {
      try {
        const stored = await readCache(env.CACHE);
        if (stored && stored.data) {
          return json({ ...stored.data, fetchedAt: stored.fetchedAt, snapshotSignature: stored.signature || buildStatusSignature(stored.data), serverTime: new Date().toISOString() });
        }
        const data = await fetchUpstream(env);
        const fetchedAt = Date.now();
        const signature = buildStatusSignature(data);
        await writeCache(env.CACHE, data, fetchedAt, signature);
        return json({ ...data, fetchedAt, snapshotSignature: signature, serverTime: new Date().toISOString() });
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

        if (!existing && !deviceLink) {
          return json({ error: "missing device link" }, 403);
        }

        const token = deviceLink
          ? ((typeof sync_token === "string" && sync_token) || await randomToken())
          : ((existing && existing.sync_token) || (typeof sync_token === "string" && sync_token) || await randomToken());

        const hasLocation = !!oblast_key;
        const snapshot = hasLocation ? await getSharedSnapshot(env) : null;
        const status = hasLocation ? alertStatus(snapshot.data, String(oblast_key), district_key ? String(district_key) : null) : { state: "clear", since: null };

        const userData = {
          chat_id: String(chat_id),
          sync_token: token,
          oblast_key: hasLocation ? String(oblast_key) : null,
          district_key: hasLocation && district_key ? String(district_key) : null,
          region_name: hasLocation ? (region_name || "Unknown") : null,
          lang: "uk",
          notify: typeof body.notify === "boolean" ? body.notify : true,
          registered_at: existing && existing.registered_at ? existing.registered_at : new Date().toISOString(),
          last_check: new Date().toISOString(),
          last_alert_state: status.state,
          last_alert_active: status.state !== "clear",
          last_alert_start: status.since,
          last_alert_end: status.state === "clear" ? new Date().toISOString() : null
        };

        await writeUser(env, key, userData);
        if (deviceLink) await env.USERS.delete(`device:${body.device_id}`);

        return json({ ok: true, registered: true, status: userData.last_alert_state, sync_token: token });
      } catch (e) {
        return json({ ok: false, error: String(e) }, 500);
      }
    }

    return json({ ok: false, error: "not found" }, 404);
  }
};

const ALERTS_API = "https://api.alerts.in.ua/v1/alerts/active.json";
const TELEGRAM_API = "https://api.telegram.org/bot";
const FETCH_TIMEOUT_MS = 5000;
const EDGE_CACHE_TTL_SECONDS = 10; // plugin-facing /api cache; low so plugins see changes almost as fast as the bot
const SEND_CONCURRENCY = 15; // parallel Telegram sends (Telegram limit ~30 msg/s)
const MIN_CACHE_WRITE_INTERVAL_SECONDS = 1800;
const SNAPSHOT_KEY = "alerts-in-ua";
const DEVICE_LINK_TTL_SECONDS = 600;
const UPDATE_DEDUP_TTL_SECONDS = 120;
const SYNC_TOKEN_BYTES = 18;
const KYIV_TZ = "Europe/Kyiv";

