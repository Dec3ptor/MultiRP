// Shared helpers for every page: config, roster, live status, watch list.

export const CFG = Object.assign(
  {
    siteName: "MultiRP",
    serverName: "NoPixel",
    titleFilter: "no\\s?pixel",
    twitchGameId: "32982",
    twitchClientId: "",
    refreshSeconds: 120,
    tiles: {},
    defaultTiles: "atlas",
  },
  window.MULTIRP_CONFIG || {}
);

export const TITLE_RE = safeRegExp(CFG.titleFilter);

function safeRegExp(src) {
  try {
    return new RegExp(src, "i");
  } catch {
    return /no\s?pixel/i;
  }
}

// ---------- DOM + formatting ----------

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
}

export function fmtViewers(n) {
  if (n == null) return "";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

export function fmtUptime(startedAt) {
  if (!startedAt) return "";
  const mins = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${String(mins % 60).padStart(2, "0")}m` : `${mins}m`;
}

export function fmtAgo(date) {
  if (!date) return "";
  const s = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  const d = Math.round(s / 86400);
  if (d < 60) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

const AVATAR_COLORS = ["#7c3aed", "#db2777", "#2563eb", "#059669", "#d97706", "#dc2626", "#0891b2", "#4f46e5"];
export function avatarFallback(name) {
  const text = (name || "?").trim().charAt(0).toUpperCase() || "?";
  let hash = 0;
  for (const ch of name || "") hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const color = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/><text x="32" y="42" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#fff" text-anchor="middle">${esc(text)}</text></svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

export function thumbUrl(login, width = 440, height = 248) {
  // Twitch refreshes previews every few minutes; bust the cache on that cadence.
  const bucket = Math.floor(Date.now() / 300000);
  return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${encodeURIComponent(login)}-${width}x${height}.jpg?t=${bucket}`;
}

let toastWrap;
export function toast(message, ms = 2600) {
  if (!toastWrap) {
    toastWrap = document.createElement("div");
    toastWrap.className = "toast-wrap";
    document.body.appendChild(toastWrap);
  }
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = message;
  toastWrap.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

// ---------- Storage ----------

export function loadLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode): ignore */
  }
}

// ---------- Channels ----------

// A channel id is "login" for Twitch or "kick:slug" for Kick.
export function parseChannel(input) {
  let s = String(input || "").trim();
  if (!s) return null;
  s = s.replace(/^@/, "");
  let platform = "twitch";
  const kick = s.match(/^(?:https?:\/\/)?(?:www\.)?kick\.com\/([^/?#\s]+)/i) || s.match(/^kick:([^\s]+)$/i);
  if (kick) {
    platform = "kick";
    s = kick[1];
  } else {
    const tw = s.match(/^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/([^/?#\s]+)/i) || s.match(/^twitch:([^\s]+)$/i);
    if (tw) s = tw[1];
  }
  s = s.toLowerCase();
  if (platform === "twitch" && !/^[a-z0-9_]{2,25}$/.test(s)) return null;
  if (platform === "kick" && !/^[a-z0-9_-]{2,40}$/.test(s)) return null;
  return platform === "kick" ? `kick:${s}` : s;
}

export function channelInfo(id) {
  if (id.startsWith("kick:")) return { platform: "kick", login: id.slice(5) };
  return { platform: "twitch", login: id };
}

export function multistreamUrl(ids) {
  // Channel ids are already validated ([a-z0-9_-] plus "kick:"), so commas stay readable.
  const path = new URL("multistream.html", location.href).pathname;
  return ids.length ? `${path}?c=${ids.join(",")}` : path;
}

// ---------- Watch list (shared between pages) ----------

const WATCH_KEY = "multirp.watchlist";

export function getWatchlist() {
  return loadLocal(WATCH_KEY, []);
}

export function setWatchlist(ids) {
  saveLocal(WATCH_KEY, [...new Set(ids)]);
  window.dispatchEvent(new CustomEvent("watchlist-change"));
}

export function toggleWatch(id) {
  const list = getWatchlist();
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else list.push(id);
  setWatchlist(list);
  return i < 0;
}

// ---------- Roster ----------

const CUSTOM_KEY = "multirp.customStreamers";

function rawId(raw) {
  return parseChannel(raw.kick ? `kick:${raw.kick}` : raw.twitch || raw.login || raw.id);
}

function normalizeStreamer(raw, custom = false) {
  const id = rawId(raw);
  if (!id) return null;
  const { platform, login } = channelInfo(id);
  return {
    id,
    platform,
    login,
    name: raw.name || login,
    characters: Array.isArray(raw.characters) ? raw.characters : raw.character ? [raw.character] : [],
    group: raw.group || "",
    spot: raw.spot || "",
    pos: Array.isArray(raw.pos) && raw.pos.length === 2 ? raw.pos.map(Number) : null,
    custom,
  };
}

export async function loadRoster() {
  let base = [];
  try {
    const res = await fetch("data/streamers.json", { cache: "no-cache" });
    if (res.ok) {
      const json = await res.json();
      base = Array.isArray(json) ? json : json.streamers || [];
    }
  } catch (err) {
    console.warn("Could not load data/streamers.json", err);
  }
  // Entries saved in this browser (added streamers, map positions) are merged
  // over the shipped list. "custom" marks streamers that exist only locally.
  const raws = new Map();
  for (const raw of base) {
    const id = rawId(raw);
    if (id) raws.set(id, { raw, custom: false });
  }
  for (const raw of loadLocal(CUSTOM_KEY, [])) {
    const id = rawId(raw);
    if (!id) continue;
    const prev = raws.get(id);
    raws.set(id, prev ? { raw: { ...prev.raw, ...raw }, custom: prev.custom } : { raw, custom: true });
  }
  return [...raws.values()].map(({ raw, custom }) => normalizeStreamer(raw, custom)).filter(Boolean);
}

export function saveCustomStreamer(entry) {
  const list = loadLocal(CUSTOM_KEY, []);
  const id = rawId(entry);
  const i = list.findIndex((e) => rawId(e) === id);
  if (i >= 0) list[i] = { ...list[i], ...entry };
  else list.push(entry);
  saveLocal(CUSTOM_KEY, list);
}

export function removeCustomStreamer(id) {
  saveLocal(CUSTOM_KEY, loadLocal(CUSTOM_KEY, []).filter((e) => rawId(e) !== id));
}

export function hasLocalEdits() {
  return loadLocal(CUSTOM_KEY, []).length > 0;
}

export function streamerToJson(s) {
  const out = s.platform === "kick" ? { kick: s.login } : { twitch: s.login };
  if (s.name && s.name !== s.login) out.name = s.name;
  if (s.characters?.length) out.characters = s.characters;
  if (s.group) out.group = s.group;
  if (s.spot) out.spot = s.spot;
  if (s.pos) out.pos = s.pos.map((n) => Math.round(n));
  return out;
}

// ---------- Twitch auth (optional) ----------

const TOKEN_KEY = "multirp.twitchToken";

export function twitchRedirectUri() {
  return new URL("./", location.href).href;
}

export function getTwitchToken() {
  const t = loadLocal(TOKEN_KEY, null);
  if (!t || !t.token || (t.expires && t.expires < Date.now())) return null;
  return t.token;
}

export function twitchLogin() {
  if (!CFG.twitchClientId) {
    toast("Add your Twitch Client ID to config.js first.");
    return;
  }
  const state = Math.random().toString(36).slice(2);
  sessionStorage.setItem("multirp.oauthState", state);
  sessionStorage.setItem("multirp.oauthReturn", location.pathname + location.search);
  const url = new URL("https://id.twitch.tv/oauth2/authorize");
  url.searchParams.set("client_id", CFG.twitchClientId);
  url.searchParams.set("redirect_uri", twitchRedirectUri());
  url.searchParams.set("response_type", "token");
  url.searchParams.set("scope", "");
  url.searchParams.set("state", state);
  location.href = url.toString();
}

export function twitchLogout() {
  localStorage.removeItem(TOKEN_KEY);
}

// Call once on page load: stores a token handed back by Twitch in the URL hash.
export async function handleTwitchRedirect() {
  if (!location.hash.includes("access_token=")) return;
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get("access_token");
  const state = params.get("state");
  const expected = sessionStorage.getItem("multirp.oauthState");
  history.replaceState(null, "", location.pathname + location.search);
  if (!token || !expected || state !== expected) {
    toast("Twitch login failed (state mismatch). Try again.");
    return;
  }
  let expires = Date.now() + 50 * 86400000;
  try {
    const res = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${token}` },
    });
    if (res.ok) {
      const info = await res.json();
      if (info.expires_in) expires = Date.now() + info.expires_in * 1000;
    }
  } catch {
    /* validation is best-effort */
  }
  saveLocal(TOKEN_KEY, { token, expires });
  const back = sessionStorage.getItem("multirp.oauthReturn");
  sessionStorage.removeItem("multirp.oauthState");
  sessionStorage.removeItem("multirp.oauthReturn");
  if (back && back !== location.pathname + location.search) location.replace(back);
  else toast("Connected to Twitch.");
}

async function helix(path, params) {
  const token = getTwitchToken();
  const url = new URL("https://api.twitch.tv/helix/" + path);
  for (const [k, v] of params) url.searchParams.append(k, v);
  const res = await fetch(url, {
    headers: { "Client-Id": CFG.twitchClientId, Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    twitchLogout();
    throw new Error("Twitch session expired");
  }
  if (!res.ok) throw new Error(`Twitch API ${res.status}`);
  return res.json();
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function helixUsers(logins) {
  const map = new Map();
  for (const part of chunk(logins, 100)) {
    const json = await helix("users", part.map((l) => ["login", l]));
    for (const u of json.data || []) {
      map.set(u.login, { displayName: u.display_name, avatar: u.profile_image_url });
    }
  }
  return map;
}

function helixStreamInfo(s) {
  return {
    live: true,
    title: s.title,
    viewers: s.viewer_count,
    startedAt: s.started_at,
    game: s.game_name,
    displayName: s.user_name,
    thumb: s.thumbnail_url ? s.thumbnail_url.replace("{width}", "440").replace("{height}", "248") : null,
  };
}

// ---------- Live status ----------

const LIVE_CACHE_KEY = "multirp.liveCache";
const LIVE_CACHE_MS = 60000;

// Returns Map(login -> { live, title, viewers, startedAt, game, avatar, displayName, lastLive }).
export async function fetchLive(logins, { force = false } = {}) {
  logins = [...new Set(logins.map((l) => l.toLowerCase()))];
  const result = new Map();
  if (!logins.length) return result;

  let cache = {};
  try {
    cache = JSON.parse(sessionStorage.getItem(LIVE_CACHE_KEY) || "{}");
  } catch {
    cache = {};
  }
  const fresh = (l) => cache[l] && Date.now() - cache[l].at < LIVE_CACHE_MS;
  const todo = force ? logins : logins.filter((l) => !fresh(l));

  if (todo.length) {
    const fetched = getTwitchToken() && CFG.twitchClientId ? await liveViaHelix(todo) : await liveViaIvr(todo);
    for (const [login, info] of fetched) cache[login] = { ...info, at: Date.now() };
    try {
      sessionStorage.setItem(LIVE_CACHE_KEY, JSON.stringify(cache));
    } catch {
      /* ignore */
    }
  }
  for (const l of logins) if (cache[l]) result.set(l, cache[l]);
  return result;
}

async function liveViaHelix(logins) {
  const out = new Map();
  const users = await helixUsers(logins);
  for (const l of logins) {
    const u = users.get(l);
    out.set(l, { live: false, displayName: u?.displayName, avatar: u?.avatar });
  }
  for (const part of chunk(logins, 100)) {
    const json = await helix("streams", part.map((l) => ["user_login", l]));
    for (const s of json.data || []) {
      const prev = out.get(s.user_login) || {};
      out.set(s.user_login, { ...prev, ...helixStreamInfo(s) });
    }
  }
  return out;
}

// api.ivr.fi is a free public Twitch API (no key needed).
function ivrToInfo(u) {
  const s = u.stream;
  return {
    live: !!s,
    title: s?.title ?? u.lastBroadcast?.title ?? "",
    viewers: s?.viewersCount ?? s?.viewers ?? null,
    startedAt: s?.createdAt ?? null,
    game: s?.game?.displayName ?? s?.game?.name ?? "",
    avatar: u.logo || null,
    displayName: u.displayName || u.login,
    lastLive: u.lastBroadcast?.startedAt ?? null,
  };
}

async function ivrFetch(logins) {
  const url = "https://api.ivr.fi/v2/twitch/user?login=" + logins.map(encodeURIComponent).join(",");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ivr ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? json : [json];
}

async function liveViaIvr(logins) {
  const out = new Map();
  const take = (users) => {
    for (const u of users) if (u && u.login) out.set(u.login.toLowerCase(), ivrToInfo(u));
  };
  await Promise.all(
    chunk(logins, 25).map(async (part) => {
      try {
        take(await ivrFetch(part));
      } catch {
        // Batch failed (bad name in the list, rate limit, ...): retry one by one.
        await Promise.all(
          part.map(async (l) => {
            try {
              take(await ivrFetch([l]));
            } catch {
              /* unknown or banned channel */
            }
          })
        );
      }
    })
  );
  return out;
}

// Find every live stream in the GTA V category whose title matches the
// server filter. Needs a Twitch login (Helix API).
export async function discoverStreams(maxPages = 10) {
  if (!getTwitchToken() || !CFG.twitchClientId) return null;
  const found = [];
  let cursor = "";
  for (let page = 0; page < maxPages; page++) {
    const params = [
      ["game_id", CFG.twitchGameId],
      ["first", "100"],
    ];
    if (cursor) params.push(["after", cursor]);
    const json = await helix("streams", params);
    for (const s of json.data || []) {
      if (TITLE_RE.test(s.title || "")) found.push({ login: s.user_login, ...helixStreamInfo(s) });
    }
    cursor = json.pagination?.cursor;
    // Streams are sorted by viewers; stop once they get tiny.
    const last = json.data?.[json.data.length - 1];
    if (!cursor || !last || last.viewer_count < 3) break;
  }
  if (found.length) {
    const users = await helixUsers(found.map((f) => f.login));
    for (const f of found) f.avatar = users.get(f.login)?.avatar || null;
  }
  return found;
}

// ---------- Header ----------

export function initHeader() {
  const here = location.pathname.split("/").pop() || "index.html";
  for (const a of $$(".nav a")) {
    const target = a.getAttribute("href");
    if (target === here || (here === "" && target === "index.html")) a.classList.add("active");
  }
  for (const n of $$("[data-site-name]")) n.textContent = CFG.siteName;
  for (const n of $$("[data-server-name]")) n.textContent = CFG.serverName;
}

export function setLiveCount(n) {
  const node = $("#live-count");
  if (!node) return;
  node.classList.toggle("hidden", n == null);
  const num = $(".num", node);
  if (num) num.textContent = n ?? "";
}
