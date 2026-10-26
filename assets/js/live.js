import {
  CFG, TITLE_RE, $, esc, fmtViewers, fmtUptime, fmtAgo, avatarFallback, thumbUrl, toast,
  loadLocal, saveLocal, parseChannel, channelInfo, multistreamUrl, getWatchlist, setWatchlist,
  toggleWatch, loadRoster, saveCustomStreamer, removeCustomStreamer, fetchLive, discoverStreams,
  getTwitchToken, twitchLogin, twitchLogout, handleTwitchRedirect, initHeader, setLiveCount,
} from "./common.js";

let roster = [];
let live = new Map();
let discovered = [];
let lastError = "";
const state = { q: "", group: "", npOnly: loadLocal("multirp.npOnly", true) };

function onServer(info) {
  return !!info?.live && (!state.npOnly || TITLE_RE.test(info.title || ""));
}

function matches(s) {
  if (state.group && s.group !== state.group) return false;
  if (!state.q) return true;
  const hay = [s.login, s.name, s.group, ...s.characters, live.get(s.login)?.title].join(" ").toLowerCase();
  return hay.includes(state.q);
}

function twitchUrl(s) {
  return s.platform === "kick" ? `https://kick.com/${s.login}` : `https://www.twitch.tv/${s.login}`;
}

function cardHtml(s, info, selected) {
  const name = info?.displayName || s.name;
  const avatar = info?.avatar || avatarFallback(name);
  const chips = [
    ...s.characters.map((c) => `<span class="chip">${esc(c)}</span>`),
    s.group ? `<span class="chip np">${esc(s.group)}</span>` : "",
  ].join("");
  return `
  <article class="card${selected ? " selected" : ""}" data-id="${esc(s.id)}">
    <div class="thumb" data-act="toggle" role="button" tabindex="0" aria-label="Select ${esc(name)}">
      <img loading="lazy" src="${esc(info?.thumb || thumbUrl(s.login))}" alt="" onerror="this.style.visibility='hidden'">
      <span class="chip live">LIVE</span>
      ${info?.viewers != null ? `<span class="viewers">👁 ${fmtViewers(info.viewers)}</span>` : ""}
      ${info?.startedAt ? `<span class="uptime">${fmtUptime(info.startedAt)}</span>` : ""}
      <span class="select-box">${selected ? "✓" : ""}</span>
    </div>
    <div class="card-body">
      <img class="avatar" loading="lazy" src="${esc(avatar)}" alt="" onerror="this.src='${avatarFallback(name)}'">
      <div class="card-info">
        <div class="card-name"><a href="${esc(twitchUrl(s))}" target="_blank" rel="noopener">${esc(name)}</a></div>
        <div class="card-title" title="${esc(info?.title)}">${esc(info?.title || "")}</div>
        <div class="card-meta">${chips}${info?.game && !TITLE_RE.test(info.title || "") ? `<span class="chip">${esc(info.game)}</span>` : ""}</div>
      </div>
    </div>
    <div class="card-actions">
      <a class="btn small primary" href="${esc(multistreamUrl([s.id]))}">▶ Watch</a>
      <button class="btn small" data-act="toggle">${selected ? "✓ Selected" : "+ Multi"}</button>
    </div>
  </article>`;
}

function offlineHtml(s, info, selected) {
  const name = info?.displayName || s.name;
  const avatar = info?.avatar || avatarFallback(name);
  let sub;
  if (s.platform === "kick") sub = "Kick – live status not available";
  else if (info?.live) sub = `Live elsewhere: ${info.game || info.title || "other"}`;
  else if (info?.lastLive) sub = `Last live ${fmtAgo(info.lastLive)}`;
  else sub = s.characters.join(", ") || (info ? "Offline" : "Status unknown");
  return `
  <div class="offline-item" data-id="${esc(s.id)}">
    <img class="avatar" loading="lazy" src="${esc(avatar)}" alt="" onerror="this.src='${avatarFallback(name)}'">
    <div class="info">
      <div class="name"><a href="${esc(twitchUrl(s))}" target="_blank" rel="noopener" style="color:inherit">${esc(name)}</a></div>
      <div class="sub" title="${esc(sub)}">${esc(sub)}</div>
    </div>
    <button class="btn small icon${selected ? " on" : ""}" data-act="toggle" title="${selected ? "Remove from" : "Add to"} multistream">${selected ? "✓" : "+"}</button>
    ${s.custom ? `<button class="btn small icon ghost" data-act="remove" title="Remove from your list">✕</button>` : ""}
  </div>`;
}

function render() {
  const watch = new Set(getWatchlist());
  const list = roster.filter(matches);

  const liveList = list
    .filter((s) => s.platform === "twitch" && onServer(live.get(s.login)))
    .sort((a, b) => (live.get(b.login).viewers || 0) - (live.get(a.login).viewers || 0));
  const liveIds = new Set(liveList.map((s) => s.id));
  const offline = list
    .filter((s) => !liveIds.has(s.id))
    .sort((a, b) => {
      const ia = live.get(a.login), ib = live.get(b.login);
      if (!!ib?.live !== !!ia?.live) return ib?.live ? 1 : -1;
      return new Date(ib?.lastLive || 0) - new Date(ia?.lastLive || 0);
    });

  $("#live-grid").innerHTML = liveList.length
    ? liveList.map((s) => cardHtml(s, live.get(s.login), watch.has(s.id))).join("")
    : `<div class="empty">${lastError ? "Live status unavailable right now." : "Nobody from your list is live on the server right now."}</div>`;
  $("#live-total").textContent = liveList.length ? `(${liveList.length})` : "";

  $("#offline-list").innerHTML = offline.map((s) => offlineHtml(s, live.get(s.login), watch.has(s.id))).join("");
  $("#offline-total").textContent = offline.length ? `(${offline.length})` : "";

  const rosterLogins = new Set(roster.map((s) => s.login));
  const extra = discovered
    .filter((d) => !rosterLogins.has(d.login))
    .map((d) => ({ s: { id: d.login, platform: "twitch", login: d.login, name: d.displayName || d.login, characters: [], group: "" }, info: d }))
    .filter(({ s, info }) => !state.q || [s.login, s.name, info.title].join(" ").toLowerCase().includes(state.q));
  $("#discovered-wrap").classList.toggle("hidden", !extra.length || !!state.group);
  $("#discovered-grid").innerHTML = extra.map(({ s, info }) => cardHtml(s, info, watch.has(s.id))).join("");
  $("#discovered-total").textContent = extra.length ? `(${extra.length})` : "";

  setLiveCount(liveList.length + (state.group ? 0 : extra.length));
  renderSelection();
}

function renderSelection() {
  const ids = getWatchlist();
  $("#selection-bar").classList.toggle("hidden", !ids.length);
  $("#sel-count").textContent = ids.length;
  $("#sel-watch").href = multistreamUrl(ids);
}

function renderGroups() {
  const groups = [...new Set(roster.map((s) => s.group).filter(Boolean))].sort();
  const sel = $("#group");
  sel.innerHTML = `<option value="">All groups</option>` + groups.map((g) => `<option>${esc(g)}</option>`).join("");
  sel.value = groups.includes(state.group) ? state.group : "";
  sel.classList.toggle("hidden", !groups.length);
}

function renderTwitchButton() {
  const btn = $("#twitch-btn");
  if (!CFG.twitchClientId) return btn.classList.add("hidden");
  btn.classList.remove("hidden");
  btn.textContent = getTwitchToken() ? "Disconnect Twitch" : "Connect Twitch";
  btn.title = getTwitchToken()
    ? "Stop using your Twitch login"
    : "Log in with Twitch to find everyone live on the server, not just your list";
}

let refreshing = false;
async function refresh(force = false) {
  if (refreshing) return;
  refreshing = true;
  $("#refresh").disabled = true;
  const status = $("#status");
  try {
    const logins = roster.filter((s) => s.platform === "twitch").map((s) => s.login);
    live = await fetchLive(logins, { force });
    lastError = "";
    if (logins.length && !live.size) lastError = "No response from the live status service.";
  } catch (err) {
    lastError = err.message || String(err);
  }
  try {
    discovered = (await discoverStreams()) || [];
  } catch (err) {
    discovered = [];
    toast(`Twitch: ${err.message}`);
    renderTwitchButton();
  }
  status.classList.toggle("hidden", !lastError);
  status.textContent = lastError
    ? `Couldn't load live status (${lastError}). Showing your list without it — try Refresh in a minute.`
    : "";
  render();
  $("#refresh").disabled = false;
  refreshing = false;
}

function bind() {
  $("#search").addEventListener("input", (e) => {
    state.q = e.target.value.trim().toLowerCase();
    render();
  });
  $("#group").addEventListener("change", (e) => {
    state.group = e.target.value;
    render();
  });
  const np = $("#np-only");
  np.checked = state.npOnly;
  np.addEventListener("change", () => {
    state.npOnly = np.checked;
    saveLocal("multirp.npOnly", state.npOnly);
    render();
  });
  $("#refresh").addEventListener("click", () => refresh(true));
  $("#twitch-btn").addEventListener("click", () => {
    if (getTwitchToken()) {
      twitchLogout();
      discovered = [];
      renderTwitchButton();
      render();
    } else twitchLogin();
  });

  const onAction = async (e) => {
    const act = e.target.closest("[data-act]");
    if (!act) return;
    const holder = act.closest("[data-id]");
    if (!holder) return;
    const id = holder.dataset.id;
    if (act.dataset.act === "toggle") {
      e.preventDefault();
      toggleWatch(id);
    } else if (act.dataset.act === "remove") {
      removeCustomStreamer(id);
      roster = await loadRoster();
      renderGroups();
      setWatchlist(getWatchlist().filter((x) => x !== id)); // re-renders
    }
  };
  for (const id of ["#live-grid", "#discovered-grid", "#offline-list"]) {
    $(id).addEventListener("click", onAction);
    $(id).addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches(".thumb")) onAction(e);
    });
  }

  $("#sel-clear").addEventListener("click", () => setWatchlist([]));
  window.addEventListener("watchlist-change", render);
  window.addEventListener("storage", (e) => e.key === "multirp.watchlist" && render());

  $("#add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const id = parseChannel(f.channel.value);
    if (!id) return toast("That doesn't look like a Twitch or Kick channel.");
    const { platform, login } = channelInfo(id);
    const entry = { [platform]: login };
    if (f.name.value.trim()) entry.name = f.name.value.trim();
    if (f.character.value.trim()) entry.characters = [f.character.value.trim()];
    if (f.group.value.trim()) entry.group = f.group.value.trim();
    saveCustomStreamer(entry);
    f.reset();
    roster = await loadRoster();
    renderGroups();
    toast(`Added ${login}.`);
    refresh();
  });
}

async function main() {
  initHeader();
  await handleTwitchRedirect();
  renderTwitchButton();
  roster = await loadRoster();
  renderGroups();
  bind();
  render();
  await refresh();
  setInterval(() => document.visibilityState === "visible" && refresh(), Math.max(30, CFG.refreshSeconds) * 1000);
}

main();
