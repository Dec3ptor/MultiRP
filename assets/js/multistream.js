import {
  TITLE_RE, $, $$, esc, fmtViewers, avatarFallback, toast, copyText, loadLocal, saveLocal,
  parseChannel, channelInfo, loadRoster, fetchLive, discoverStreams, initHeader, setLiveCount,
} from "./common.js";

const HOST = location.hostname || "localhost";
const RATIO = 16 / 9;
const MAX_STREAMS = 16;
const SESSION_KEY = "multirp.lastSession";

const stage = $("#stage");
const state = {
  streams: [], // channel ids in display order
  layout: "grid", // "grid" | "focus"
  focus: null, // id shown big in focus layout
  audio: new Set(), // ids with sound on
  chat: false,
  chatTab: null,
  chatWidth: loadLocal("multirp.chatWidth", 340),
};
const tiles = new Map(); // id -> { el, playerEl, player, ready, platform, login }
const volumes = loadLocal("multirp.volumes", {});

// ---------- Twitch player API ----------

let twitchApi;
function loadTwitchApi() {
  if (!twitchApi) {
    twitchApi = new Promise((resolve) => {
      if (window.Twitch?.Player) return resolve(window.Twitch);
      const s = document.createElement("script");
      s.src = "https://player.twitch.tv/js/embed/v1.js";
      s.async = true;
      const timer = setTimeout(() => resolve(null), 8000);
      s.onload = () => {
        clearTimeout(timer);
        resolve(window.Twitch?.Player ? window.Twitch : null);
      };
      s.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      document.head.appendChild(s);
    });
  }
  return twitchApi;
}

function plainIframe(src) {
  const f = document.createElement("iframe");
  f.src = src;
  f.allow = "autoplay; fullscreen; encrypted-media; picture-in-picture";
  f.allowFullscreen = true;
  f.setAttribute("scrolling", "no");
  return f;
}

function kickSrc(login, muted) {
  return `https://player.kick.com/${encodeURIComponent(login)}?autoplay=true&muted=${muted}`;
}

async function mountPlayer(t, id) {
  t.playerEl.innerHTML = "";
  t.player = null;
  t.ready = false;
  const muted = !state.audio.has(id);
  if (t.platform === "kick") {
    t.playerEl.appendChild(plainIframe(kickSrc(t.login, muted)));
    t.kickMuted = muted;
    return;
  }
  const Twitch = await loadTwitchApi();
  if (!tiles.has(id)) return; // removed while loading
  if (Twitch) {
    const holder = document.createElement("div");
    holder.id = "player-" + Math.random().toString(36).slice(2);
    holder.style.cssText = "position:absolute;inset:0";
    t.playerEl.appendChild(holder);
    t.player = new Twitch.Player(holder.id, {
      channel: t.login,
      parent: [HOST],
      width: "100%",
      height: "100%",
      muted,
      autoplay: true,
    });
    t.player.addEventListener(Twitch.Player.READY, () => {
      t.ready = true;
      applyAudio(id);
    });
  } else {
    // Twitch script blocked: fall back to a plain embed (no sound control from here).
    const src = `https://player.twitch.tv/?channel=${encodeURIComponent(t.login)}&parent=${encodeURIComponent(HOST)}&muted=${muted}&autoplay=true`;
    t.playerEl.appendChild(plainIframe(src));
  }
  renderTileBar(id);
}

function applyAudio(id) {
  const t = tiles.get(id);
  if (!t) return;
  const on = state.audio.has(id);
  if (t.platform === "kick") {
    // Kick's embed has no API; reload it with the new mute setting.
    if (t.kickMuted !== !on) {
      t.kickMuted = !on;
      const f = $("iframe", t.playerEl);
      if (f) f.src = kickSrc(t.login, !on);
    }
  } else if (t.player && t.ready) {
    try {
      t.player.setMuted(!on);
      if (on) t.player.setVolume(volumes[id] ?? 0.6);
    } catch {
      /* player not ready yet */
    }
  }
  t.el.classList.toggle("audio", on);
  renderTileBar(id);
}

// ---------- Tiles ----------

function tileBarHtml(id, index) {
  const t = tiles.get(id);
  const on = state.audio.has(id);
  const canVolume = t.platform === "twitch" && t.player;
  const url = t.platform === "kick" ? `https://kick.com/${t.login}` : `https://www.twitch.tv/${t.login}`;
  return `
    <span class="num">${index + 1}</span>
    <span class="name" draggable="true" title="Drag to swap places">${esc(t.label || t.login)}${t.platform === "kick" ? ' <span class="chip">Kick</span>' : ""}</span>
    <button class="btn icon small${on ? " on" : ""}" data-act="audio" title="Sound: click to solo, Shift+click to mix">${on ? "🔊" : "🔇"}</button>
    ${canVolume && on ? `<input type="range" min="0" max="1" step="0.05" value="${volumes[id] ?? 0.6}" data-act="volume" title="Volume">` : ""}
    <button class="btn icon small${state.layout === "focus" && currentFocus() === id ? " on" : ""}" data-act="focus" title="Make this the big one">⤢</button>
    <button class="btn icon small" data-act="chat" title="Show chat">💬</button>
    <button class="btn icon small" data-act="reload" title="Reload player">⟳</button>
    <a class="btn icon small" href="${esc(url)}" target="_blank" rel="noopener" title="Open channel">↗</a>
    <button class="btn icon small" data-act="remove" title="Remove">✕</button>`;
}

function renderTileBar(id) {
  const t = tiles.get(id);
  if (!t) return;
  $(".tile-bar", t.el).innerHTML = tileBarHtml(id, state.streams.indexOf(id));
}

function createTile(id) {
  const { platform, login } = channelInfo(id);
  const el = document.createElement("div");
  el.className = "tile no-anim";
  el.dataset.id = id;
  el.innerHTML = `<div class="player"></div><div class="tile-bar"></div>`;
  stage.appendChild(el);
  const t = { el, playerEl: $(".player", el), platform, login, label: rosterNames.get(id) };
  tiles.set(id, t);
  mountPlayer(t, id);
  renderTileBar(id);
}

function destroyTile(id) {
  const t = tiles.get(id);
  if (!t) return;
  t.el.remove();
  tiles.delete(id);
  const chat = chatFrames.get(id);
  if (chat) {
    chat.remove();
    chatFrames.delete(id);
  }
}

// ---------- Layout ----------

function fitGrid(n, W, H, x0 = 0, y0 = 0) {
  if (n <= 0 || W <= 0 || H <= 0) return [];
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    let w = W / cols;
    let h = w / RATIO;
    if (h * rows > H) {
      h = H / rows;
      w = h * RATIO;
    }
    if (!best || w > best.w + 0.5) best = { cols, rows, w, h };
  }
  const { cols, rows, w, h } = best;
  const offY = y0 + (H - rows * h) / 2;
  const rects = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const inRow = r === rows - 1 ? n - cols * (rows - 1) : cols;
    const offX = x0 + (W - inRow * w) / 2;
    rects.push({ x: offX + c * w, y: offY + r * h, w, h });
  }
  return rects;
}

function currentFocus() {
  return state.streams.includes(state.focus) ? state.focus : state.streams[0];
}

function computeRects(W, H) {
  const ids = state.streams;
  const out = new Map();
  if (state.layout === "grid" || ids.length < 2) {
    fitGrid(ids.length, W, H).forEach((r, i) => out.set(ids[i], r));
    return out;
  }
  const main = currentFocus();
  const others = ids.filter((id) => id !== main);
  if (W / H >= RATIO) {
    // Wide screen: small streams in a column on the right.
    let stripW = Math.min(Math.max(W * 0.22, 200), 480);
    const mainW = Math.min(W - stripW, H * RATIO);
    stripW = W - mainW;
    out.set(main, fitGrid(1, mainW, H)[0]);
    fitGrid(others.length, stripW, H, mainW, 0).forEach((r, i) => out.set(others[i], r));
  } else {
    // Tall screen: small streams in a row underneath.
    let stripH = Math.min(Math.max(H * 0.24, 110), 320);
    const mainH = Math.min(H - stripH, W / RATIO);
    stripH = H - mainH;
    out.set(main, fitGrid(1, W, mainH)[0]);
    fitGrid(others.length, W, stripH, 0, mainH).forEach((r, i) => out.set(others[i], r));
  }
  return out;
}

function layout() {
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  const rects = computeRects(W, H);
  for (const [id, r] of rects) {
    const t = tiles.get(id);
    if (!t) continue;
    Object.assign(t.el.style, {
      left: Math.round(r.x) + "px",
      top: Math.round(r.y) + "px",
      width: Math.round(r.w) + "px",
      height: Math.round(r.h) + "px",
    });
  }
  // Let first placement snap, later moves animate.
  requestAnimationFrame(() => tiles.forEach((t) => t.el.classList.remove("no-anim")));
}

// ---------- State changes ----------

function sync({ relayout = true } = {}) {
  // Create / destroy tiles to match state.streams (existing tiles never move in the DOM,
  // so their players keep playing when the layout changes).
  for (const id of [...tiles.keys()]) if (!state.streams.includes(id)) destroyTile(id);
  for (const id of state.streams) if (!tiles.has(id)) createTile(id);
  for (const id of [...state.audio]) if (!state.streams.includes(id)) state.audio.delete(id);
  state.streams.forEach((id) => renderTileBar(id));
  $("#stage-empty").classList.toggle("hidden", state.streams.length > 0);
  $$("#layout-seg button").forEach((b) => b.classList.toggle("on", b.dataset.layout === state.layout));
  $("#chat-btn").classList.toggle("on", state.chat);
  document.title = state.streams.length
    ? `${state.streams.map((id) => channelInfo(id).login).join(", ")} – Multistream`
    : "MultiRP – Multistream";
  if (relayout) layout();
  renderChat();
  saveUrl();
  if (!state.streams.length) renderSuggestions();
}

function addStream(input, { quiet = false } = {}) {
  const id = parseChannel(input);
  if (!id) {
    if (!quiet) toast(`"${input}" isn't a valid Twitch or Kick channel.`);
    return false;
  }
  if (state.streams.includes(id)) {
    if (!quiet) toast(`${channelInfo(id).login} is already on screen.`);
    return false;
  }
  if (state.streams.length >= MAX_STREAMS) {
    toast(`That's ${MAX_STREAMS} streams — remove one first.`);
    return false;
  }
  state.streams.push(id);
  if (state.streams.length === 1) state.audio = new Set([id]);
  return true;
}

function removeStream(id) {
  state.streams = state.streams.filter((x) => x !== id);
  if (state.focus === id) state.focus = null;
  if (state.chatTab === id) state.chatTab = state.streams[0] || null;
  sync();
}

function setAudio(id, mix = false) {
  if (mix) {
    if (state.audio.has(id)) state.audio.delete(id);
    else state.audio.add(id);
  } else {
    state.audio = state.audio.has(id) && state.audio.size === 1 ? new Set() : new Set([id]);
  }
  state.streams.forEach(applyAudio);
}

function setFocus(id) {
  state.focus = id;
  state.layout = "focus";
  sync();
}

// ---------- URL + session ----------

function saveUrl() {
  const p = new URLSearchParams();
  if (state.streams.length) p.set("c", state.streams.join(","));
  if (state.layout !== "grid") p.set("l", state.layout);
  if (state.layout === "focus" && state.focus) p.set("f", state.focus);
  const qs = p.toString().replace(/%2C/g, ",").replace(/%3A/g, ":");
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  saveLocal(SESSION_KEY, { streams: state.streams, layout: state.layout, focus: state.focus });
}

function loadInitial() {
  const p = new URLSearchParams(location.search);
  let streams, layoutName, focus;
  if (p.has("c")) {
    streams = p.get("c").split(",");
    layoutName = p.get("l");
    focus = p.get("f");
  } else {
    const last = loadLocal(SESSION_KEY, null);
    if (last) ({ streams, layout: layoutName, focus } = last);
  }
  for (const s of streams || []) addStream(s, { quiet: true });
  state.layout = layoutName === "focus" ? "focus" : "grid";
  state.focus = parseChannel(focus) || null;
  state.audio = new Set(state.streams.slice(0, 1));
}

// ---------- Chat ----------

const chatFrames = new Map();

function chatSrc(id) {
  const { platform, login } = channelInfo(id);
  if (platform === "kick") return null;
  return `https://www.twitch.tv/embed/${encodeURIComponent(login)}/chat?parent=${encodeURIComponent(HOST)}&darkpopout`;
}

function renderChat() {
  const panel = $("#chat-panel");
  panel.classList.toggle("hidden", !state.chat);
  panel.style.width = state.chatWidth + "px";
  if (!state.chat) return;
  if (!state.streams.includes(state.chatTab)) state.chatTab = state.streams[0] || null;
  $("#chat-tabs").innerHTML = state.streams
    .map((id) => `<button role="tab" data-id="${esc(id)}" class="${id === state.chatTab ? "on" : ""}">${esc(tiles.get(id)?.label || channelInfo(id).login)}</button>`)
    .join("");
  const frames = $("#chat-frames");
  $$(".chat-note", frames).forEach((n) => n.remove());
  if (!state.chatTab) {
    frames.insertAdjacentHTML("beforeend", `<div class="chat-note">Add a stream to see its chat.</div>`);
  }
  for (const [id, f] of chatFrames) f.style.display = id === state.chatTab ? "" : "none";
  if (state.chatTab && !chatFrames.has(state.chatTab)) {
    const src = chatSrc(state.chatTab);
    if (src) {
      const f = document.createElement("iframe");
      f.src = src;
      f.title = "Chat";
      chatFrames.set(state.chatTab, f);
      frames.appendChild(f);
    } else {
      const login = channelInfo(state.chatTab).login;
      frames.insertAdjacentHTML(
        "beforeend",
        `<div class="chat-note">Kick chat can't be embedded here.<br><br><a class="btn" href="https://kick.com/${esc(login)}" target="_blank" rel="noopener">Open on Kick ↗</a></div>`
      );
    }
  }
}

function initChatResize() {
  const handle = $(".chat-resize");
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    stage.classList.add("resizing");
    $$(".chat-frames iframe").forEach((f) => (f.style.pointerEvents = "none"));
    const startX = e.clientX;
    const startW = state.chatWidth;
    const move = (ev) => {
      state.chatWidth = Math.min(700, Math.max(240, startW + (startX - ev.clientX)));
      $("#chat-panel").style.width = state.chatWidth + "px";
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      stage.classList.remove("resizing");
      $$(".chat-frames iframe").forEach((f) => (f.style.pointerEvents = ""));
      saveLocal("multirp.chatWidth", state.chatWidth);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
}

// ---------- Live list (drawer + empty state) ----------

let roster = [];
const rosterNames = new Map();
let liveInfo = new Map();
let discovered = [];

async function loadLiveData() {
  roster = await loadRoster();
  for (const s of roster) rosterNames.set(s.id, s.name);
  try {
    liveInfo = await fetchLive(roster.filter((s) => s.platform === "twitch").map((s) => s.login));
  } catch {
    liveInfo = new Map();
  }
  try {
    discovered = (await discoverStreams()) || [];
  } catch {
    discovered = [];
  }
  const liveCount = liveEntries().length;
  setLiveCount(liveCount || null);
  tiles.forEach((t, id) => {
    if (rosterNames.has(id)) t.label = rosterNames.get(id);
  });
  state.streams.forEach(renderTileBar);
  if (state.chat) renderChat();
}

function liveEntries() {
  const out = [];
  for (const s of roster) {
    const info = liveInfo.get(s.login);
    if (s.platform === "twitch" && info?.live && TITLE_RE.test(info.title || "")) out.push({ s, info });
  }
  const known = new Set(roster.map((s) => s.login));
  for (const d of discovered) {
    if (!known.has(d.login)) {
      out.push({ s: { id: d.login, login: d.login, name: d.displayName || d.login, characters: [], group: "" }, info: d });
    }
  }
  return out.sort((a, b) => (b.info.viewers || 0) - (a.info.viewers || 0));
}

function entryHtml({ s, info }, compact = false) {
  const name = info?.displayName || s.name;
  const on = state.streams.includes(s.id);
  const sub = [s.characters?.[0], info?.viewers != null ? `👁 ${fmtViewers(info.viewers)}` : ""].filter(Boolean).join(" · ");
  return `
    <div class="${compact ? "suggest" : "sb-item suggest"}" data-add="${esc(s.id)}" title="${esc(info?.title || "")}">
      <img class="avatar" loading="lazy" src="${esc(info?.avatar || avatarFallback(name))}" alt="">
      <div class="info" style="flex:1">
        <div>${esc(name)} ${on ? "✓" : ""}</div>
        <div class="sub">${esc(sub || (info?.live ? "Live" : "Offline"))}</div>
      </div>
    </div>`;
}

function renderSuggestions() {
  const entries = liveEntries().slice(0, 12);
  $("#suggest").innerHTML = entries.length
    ? entries.map((e) => entryHtml(e, true)).join("")
    : `<div class="muted" style="grid-column:1/-1;text-align:center">Nobody from your list is live right now — add any channel by name above.</div>`;
}

function renderDrawer() {
  const q = $("#drawer-search").value.trim().toLowerCase();
  const liveList = liveEntries();
  const liveIds = new Set(liveList.map((e) => e.s.id));
  const offline = roster.filter((s) => !liveIds.has(s.id)).map((s) => ({ s, info: liveInfo.get(s.login) }));
  const filt = (e) => !q || [e.s.login, e.s.name, ...(e.s.characters || []), e.s.group, e.info?.title].join(" ").toLowerCase().includes(q);
  $("#drawer-body").innerHTML =
    `<div class="sb-section">Live (${liveList.filter(filt).length})</div>` +
    (liveList.filter(filt).map((e) => entryHtml(e)).join("") || `<div class="muted">Nobody live.</div>`) +
    `<div class="sb-section" style="margin-top:14px">Your list – offline</div>` +
    offline.filter(filt).map((e) => entryHtml(e)).join("");
}

// ---------- Events ----------

function bind() {
  $("#add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#add-input");
    let added = false;
    for (const part of input.value.split(/[\s,]+/).filter(Boolean)) added = addStream(part) || added;
    if (added) {
      input.value = "";
      sync();
    }
  });

  $("#layout-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-layout]");
    if (!b) return;
    state.layout = b.dataset.layout;
    sync();
  });

  $("#chat-btn").addEventListener("click", () => {
    state.chat = !state.chat;
    sync();
  });

  $("#share-btn").addEventListener("click", async () => {
    saveUrl();
    (await copyText(location.href)) ? toast("Link copied — anyone opening it sees this setup.") : toast(location.href, 6000);
  });

  $("#fs-btn").addEventListener("click", toggleFullscreen);

  $("#clear-btn").addEventListener("click", () => {
    if (!state.streams.length || !confirm("Remove all streams?")) return;
    state.streams = [];
    state.focus = null;
    sync();
  });

  $("#browse-btn").addEventListener("click", () => {
    $("#drawer").classList.toggle("hidden");
    renderDrawer();
  });
  $("#drawer-close").addEventListener("click", () => $("#drawer").classList.add("hidden"));
  $("#drawer-search").addEventListener("input", renderDrawer);

  const addFromList = (e) => {
    const item = e.target.closest("[data-add]");
    if (!item) return;
    const id = item.dataset.add;
    if (state.streams.includes(id)) removeStream(id);
    else if (addStream(id)) sync();
    renderDrawer();
  };
  $("#drawer-body").addEventListener("click", addFromList);
  $("#suggest").addEventListener("click", addFromList);

  $("#chat-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]");
    if (!b) return;
    state.chatTab = b.dataset.id;
    renderChat();
  });

  // Tile controls
  stage.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    const tileEl = e.target.closest(".tile");
    if (!act || !tileEl) return;
    const id = tileEl.dataset.id;
    switch (act.dataset.act) {
      case "audio":
        setAudio(id, e.shiftKey || e.ctrlKey || e.metaKey);
        break;
      case "focus":
        setFocus(id);
        break;
      case "chat":
        state.chat = true;
        state.chatTab = id;
        sync({ relayout: true });
        break;
      case "reload":
        mountPlayer(tiles.get(id), id);
        break;
      case "remove":
        removeStream(id);
        break;
    }
  });
  stage.addEventListener("input", (e) => {
    if (e.target.dataset.act !== "volume") return;
    const id = e.target.closest(".tile").dataset.id;
    volumes[id] = Number(e.target.value);
    saveLocal("multirp.volumes", volumes);
    try {
      tiles.get(id)?.player?.setVolume(volumes[id]);
    } catch {
      /* not ready */
    }
  });

  // Drag a tile's name onto another tile to swap them.
  let dragId = null;
  stage.addEventListener("dragstart", (e) => {
    const tileEl = e.target.closest(".tile");
    if (!tileEl) return;
    dragId = tileEl.dataset.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragId);
    stage.classList.add("dragging");
  });
  stage.addEventListener("dragover", (e) => {
    if (!dragId) return;
    e.preventDefault();
    const over = e.target.closest(".tile");
    $$(".tile.drag-over", stage).forEach((t) => t !== over && t.classList.remove("drag-over"));
    if (over && over.dataset.id !== dragId) over.classList.add("drag-over");
  });
  stage.addEventListener("drop", (e) => {
    e.preventDefault();
    const over = e.target.closest(".tile");
    if (dragId && over && over.dataset.id !== dragId) {
      const a = state.streams.indexOf(dragId);
      const b = state.streams.indexOf(over.dataset.id);
      [state.streams[a], state.streams[b]] = [state.streams[b], state.streams[a]];
      if (state.layout === "focus" && (state.focus === over.dataset.id || currentFocus() === over.dataset.id)) {
        state.focus = dragId;
      }
      sync();
    }
  });
  stage.addEventListener("dragend", () => {
    dragId = null;
    stage.classList.remove("dragging");
    $$(".tile.drag-over", stage).forEach((t) => t.classList.remove("drag-over"));
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select") || e.altKey) return;
    const n = Number(e.code?.replace(/^Digit/, ""));
    if (n >= 1 && n <= 9 && state.streams[n - 1]) {
      e.preventDefault();
      if (e.shiftKey) setFocus(state.streams[n - 1]);
      else setAudio(state.streams[n - 1], e.ctrlKey || e.metaKey);
      return;
    }
    if (e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (k === "f") toggleFullscreen();
    else if (k === "c") {
      state.chat = !state.chat;
      sync();
    } else if (k === "g") {
      state.layout = state.layout === "grid" ? "focus" : "grid";
      sync();
    } else if (k === "escape") $("#drawer").classList.add("hidden");
  });

  new ResizeObserver(() => layout()).observe(stage);
  initChatResize();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else (document.querySelector(".ms-body") || stage).requestFullscreen?.().catch(() => {});
}

// ---------- Start ----------

initHeader();
loadInitial();
bind();
sync();
loadLiveData().then(() => {
  if (!state.streams.length) renderSuggestions();
});
setInterval(() => document.visibilityState === "visible" && loadLiveData(), 180000);
