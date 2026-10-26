import {
  CFG, TITLE_RE, $, $$, esc, fmtViewers, fmtUptime, avatarFallback, toast, copyText, loadLocal,
  saveLocal, multistreamUrl, toggleWatch, getWatchlist, loadRoster, saveCustomStreamer,
  streamerToJson, fetchLive, initHeader, setLiveCount,
} from "./common.js";

const L = window.L;

// GTA V world coordinates -> Leaflet. Leaflet's LatLng is [y, x] in game units.
// These constants line up the standard 256px GTA V tile pyramid with the game world.
const GTA_CRS = L.extend({}, L.CRS.Simple, {
  projection: L.Projection.LonLat,
  scale: (zoom) => Math.pow(2, zoom),
  zoom: (scale) => Math.log(scale) / Math.LN2,
  distance: (a, b) => Math.hypot(b.lng - a.lng, b.lat - a.lat),
  transformation: new L.Transformation(0.02072, 117.3, -0.0205, 172.8),
  infinite: true,
});
const toLatLng = ([x, y]) => L.latLng(y, x);
const toXY = (ll) => [Math.round(ll.lng), Math.round(ll.lat)];
// The area the zoom-0 tile covers, nudged in so edge tiles aren't requested twice.
const TILE_BOUNDS = L.latLngBounds([-4057, -5660], [8428, 6693]);
const ISLAND = L.latLngBounds([-3900, -3700], [7700, 4300]);

let roster = [];
let live = new Map();
let places = [];
let categories = {};
let editing = false;
let placing = null; // streamer id waiting for a map click
let searchQ = "";

const layerPrefs = loadLocal("multirp.mapLayers", {});
const map = L.map("map", {
  crs: GTA_CRS,
  minZoom: 1,
  maxZoom: 7,
  zoomSnap: 0.5,
  zoomControl: false,
  maxBounds: TILE_BOUNDS.pad(0.1),
  maxBoundsViscosity: 0.7,
});
L.control.zoom({ position: "bottomright" }).addTo(map);

// The view lives in the URL (#x,y,zoom) so a link opens the same spot.
function readHashView() {
  const m = location.hash.match(/^#(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/);
  return m ? { pos: [Number(m[1]), Number(m[2])], zoom: Number(m[3]) } : null;
}
const startView = readHashView();
if (startView) map.setView(toLatLng(startView.pos), startView.zoom);
else map.fitBounds(ISLAND);
map.on("moveend", () => {
  const [x, y] = toXY(map.getCenter());
  history.replaceState(null, "", `${location.pathname}${location.search}#${x},${y},${map.getZoom()}`);
});
window.addEventListener("hashchange", () => {
  const v = readHashView();
  if (v) map.setView(toLatLng(v.pos), v.zoom);
});

// ---------- Base map ----------

const baseLayers = {};
for (const [key, t] of Object.entries(CFG.tiles || {})) {
  baseLayers[key] = L.tileLayer(t.url, {
    minZoom: 0,
    maxZoom: 7,
    maxNativeZoom: 5,
    noWrap: true,
    bounds: TILE_BOUNDS,
    attribution: 'Map © Rockstar Games · tiles <a href="https://github.com/meesvrh/gtav-map-tiles" target="_blank" rel="noopener">gtav-map-tiles</a>',
  });
}
let currentStyle = loadLocal("multirp.mapStyle", CFG.defaultTiles);
if (!baseLayers[currentStyle]) currentStyle = Object.keys(baseLayers)[0];

function setStyle(key) {
  if (!baseLayers[key]) return;
  Object.values(baseLayers).forEach((l) => map.removeLayer(l));
  baseLayers[key].addTo(map);
  currentStyle = key;
  saveLocal("multirp.mapStyle", key);
  $("#map").className = $("#map").className.replace(/\bstyle-\S+/g, "").trim() + ` style-${key}`;
  $$("#style-seg button").forEach((b) => b.classList.toggle("on", b.dataset.style === key));
}

$("#style-seg").innerHTML = Object.entries(CFG.tiles || {})
  .map(([key, t]) => `<button data-style="${esc(key)}">${esc(t.label || key)}</button>`)
  .join("");
$("#style-seg").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-style]");
  if (b) setStyle(b.dataset.style);
});
setStyle(currentStyle);

// ---------- Places ----------

const placeLayers = {}; // category -> LayerGroup
const placeMarkers = new Map(); // place id -> marker

function poiIcon(cat) {
  const c = categories[cat] || { icon: "•", color: "#475569" };
  return L.divIcon({
    className: "",
    html: `<div class="poi-dot" style="background:${esc(c.color)}">${esc(c.icon)}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -12],
  });
}

function streamersAtPlace(placeId) {
  return roster.filter((s) => s.spot === placeId && !s.pos);
}

function placePopup(place) {
  const here = streamersAtPlace(place.id);
  const cat = categories[place.category];
  return `
    <div class="popup-title">${esc(place.name)}</div>
    <div class="popup-sub">${esc(cat?.label || place.category)} · x ${place.pos[0]}, y ${place.pos[1]}</div>
    ${here.length ? streamerRows(here) : ""}`;
}

async function loadPlaces() {
  try {
    const res = await fetch("data/locations.json", { cache: "no-cache" });
    const json = await res.json();
    categories = json.categories || {};
    places = (json.locations || []).filter((p) => Array.isArray(p.pos) && p.pos.length === 2);
  } catch (err) {
    console.warn("Could not load data/locations.json", err);
    toast("Couldn't load map places.");
  }
  for (const key of Object.keys(categories)) placeLayers[key] = L.layerGroup();
  for (const p of places) {
    if (!placeLayers[p.category]) {
      placeLayers[p.category] = L.layerGroup();
      categories[p.category] = categories[p.category] || { label: p.category, icon: "•", color: "#475569" };
    }
    const m = L.marker(toLatLng(p.pos), { icon: poiIcon(p.category), title: p.name, riseOnHover: true })
      .bindTooltip(p.name, { direction: "top", offset: [0, -12], className: "poi-label" })
      .bindPopup(() => placePopup(p), { maxWidth: 320 });
    // While placing a streamer, clicking a place pins them to it.
    m.on("click", () => {
      if (!placing) return;
      m.closePopup();
      const s = roster.find((x) => x.id === placing);
      stopPlacing();
      if (s) assignSpot(s, p.id);
    });
    m.addTo(placeLayers[p.category]);
    placeMarkers.set(p.id, m);
  }
  updatePlaceLayers();
  renderLayerToggles();
}

// A category shows when it's switched on and the map is zoomed in past its minZoom
// (busy categories like businesses only appear once you zoom in).
function updatePlaceLayers() {
  const zoom = map.getZoom();
  for (const [key, layer] of Object.entries(placeLayers)) {
    const want = layerPrefs[key] !== false && zoom >= (categories[key]?.minZoom || 0);
    if (want && !map.hasLayer(layer)) layer.addTo(map);
    else if (!want && map.hasLayer(layer)) map.removeLayer(layer);
  }
}
map.on("zoomend", updatePlaceLayers);

function renderLayerToggles() {
  const showOffline = layerPrefs.__offline !== false;
  $("#layer-toggles").innerHTML =
    Object.entries(categories)
      .map(
        ([key, c]) => `<label class="check"><input type="checkbox" data-layer="${esc(key)}" ${layerPrefs[key] !== false ? "checked" : ""}> ${esc(c.icon)} ${esc(c.label)}</label>`
      )
      .join("") +
    `<label class="check"><input type="checkbox" data-layer="__offline" ${showOffline ? "checked" : ""}> Offline streamers</label>`;
}

$("#layer-toggles").addEventListener("change", (e) => {
  const key = e.target.dataset.layer;
  if (!key) return;
  layerPrefs[key] = e.target.checked;
  saveLocal("multirp.mapLayers", layerPrefs);
  if (key === "__offline") return renderPins();
  updatePlaceLayers();
  if (e.target.checked && map.getZoom() < (categories[key]?.minZoom || 0)) toast(`Zoom in to see ${categories[key].label.toLowerCase()}.`);
});

// ---------- Streamers ----------

const pinLayer = L.layerGroup().addTo(map);
const pinFor = new Map(); // streamer id -> its pin marker

function isLive(s) {
  const info = live.get(s.login);
  return !!info?.live && TITLE_RE.test(info.title || "");
}

function streamerPos(s) {
  if (s.pos) return s.pos;
  if (s.spot) return places.find((p) => p.id === s.spot)?.pos || null;
  return null;
}

function streamerRows(list) {
  const sorted = [...list].sort((a, b) => isLive(b) - isLive(a) || (live.get(b.login)?.viewers || 0) - (live.get(a.login)?.viewers || 0));
  const watch = new Set(getWatchlist());
  const liveIds = sorted.filter(isLive).map((s) => s.id);
  return `
    <div class="popup-list">
      ${sorted
        .map((s) => {
          const info = live.get(s.login);
          const name = info?.displayName || s.name;
          const sub = isLive(s)
            ? `🔴 ${fmtViewers(info.viewers)} · ${fmtUptime(info.startedAt)}`
            : s.characters.join(", ") || "Offline";
          return `
          <div class="popup-row">
            <img class="avatar" src="${esc(info?.avatar || avatarFallback(name))}" alt="">
            <div class="info"><div><b>${esc(name)}</b></div><div class="muted" style="font-size:12px" title="${esc(info?.title || "")}">${esc(sub)}</div></div>
            ${isLive(s) ? `<a class="btn small primary" href="${esc(multistreamUrl([s.id]))}">▶</a>` : ""}
            <button class="btn small${watch.has(s.id) ? " on" : ""}" data-watch="${esc(s.id)}" title="Add to multistream selection">${watch.has(s.id) ? "✓" : "+"}</button>
          </div>`;
        })
        .join("")}
    </div>
    ${liveIds.length > 1 ? `<div class="popup-actions"><a class="btn small primary" href="${esc(multistreamUrl(liveIds))}">▶ Watch all ${liveIds.length} here</a></div>` : ""}`;
}

function pinIcon(list) {
  const lead = [...list].sort((a, b) => isLive(b) - isLive(a))[0];
  const info = live.get(lead.login);
  const name = info?.displayName || lead.name;
  const anyLive = list.some(isLive);
  const img = `<img src="${esc(info?.avatar || avatarFallback(name))}" alt="">`;
  return L.divIcon({
    className: "",
    html: `<div class="pin ${anyLive ? "live" : "offline"}">${img}${list.length > 1 ? `<span class="pin-count">${list.length}</span>` : ""}</div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -20],
  });
}

function renderPins() {
  pinLayer.clearLayers();
  pinFor.clear();
  const showOffline = layerPrefs.__offline !== false;
  const visible = roster.filter((s) => streamerPos(s) && (showOffline || isLive(s) || editing));

  if (editing) {
    // One draggable pin per streamer while editing.
    for (const s of visible) {
      const m = L.marker(toLatLng(streamerPos(s)), { icon: pinIcon([s]), draggable: true, title: s.name, zIndexOffset: 1000 });
      m.on("dragend", () => savePosition(s, toXY(m.getLatLng())));
      // While placing someone else, clicking this pin puts them at the same spot.
      m.on("click", () => {
        if (!placing || placing === s.id) return;
        const other = roster.find((x) => x.id === placing);
        stopPlacing();
        if (!other) return;
        if (s.spot && !s.pos) assignSpot(other, s.spot);
        else savePosition(other, streamerPos(s));
      });
      m.bindTooltip(s.name, { direction: "top", offset: [0, -22] });
      m.addTo(pinLayer);
    }
    return;
  }

  // Group streamers who share a spot into one pin.
  const groups = new Map();
  for (const s of visible) {
    const [x, y] = streamerPos(s);
    const key = `${Math.round(x / 15)}:${Math.round(y / 15)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  for (const list of groups.values()) {
    const anyLive = list.some(isLive);
    const m = L.marker(toLatLng(streamerPos(list[0])), {
      icon: pinIcon(list),
      zIndexOffset: anyLive ? 2000 : 1000,
      riseOnHover: true,
    });
    const spot = places.find((p) => p.id === list[0].spot);
    m.bindPopup(
      () => `<div class="popup-title">${esc(spot && !list[0].pos ? spot.name : list.length > 1 ? `${list.length} streamers` : list[0].name)}</div>${streamerRows(list)}`,
      { maxWidth: 340 }
    );
    m.bindTooltip(list.map((s) => s.name).join(", "), { direction: "top", offset: [0, -22] });
    m.addTo(pinLayer);
    for (const s of list) pinFor.set(s.id, m);
  }
}

function savePosition(s, pos) {
  const entry = { [s.platform]: s.login, pos, spot: "" };
  saveCustomStreamer(entry);
  s.pos = pos;
  s.spot = "";
  renderPins();
  renderSidebar();
}

function assignSpot(s, placeId) {
  saveCustomStreamer({ [s.platform]: s.login, pos: null, spot: placeId });
  s.pos = null;
  s.spot = placeId;
  renderPins();
  renderSidebar();
  toast(`${s.name} pinned to ${places.find((p) => p.id === placeId)?.name}.`);
}

function unplace(s) {
  saveCustomStreamer({ [s.platform]: s.login, pos: null, spot: "" });
  s.pos = null;
  s.spot = "";
  renderPins();
  renderSidebar();
}

// ---------- Sidebar ----------

function renderSidebar() {
  const q = searchQ;
  const match = (txt) => !q || txt.toLowerCase().includes(q);

  const streamers = roster
    .filter((s) => match([s.login, s.name, s.group, ...s.characters].join(" ")))
    .sort((a, b) => isLive(b) - isLive(a) || (live.get(b.login)?.viewers || 0) - (live.get(a.login)?.viewers || 0) || a.name.localeCompare(b.name));
  const liveCount = roster.filter(isLive).length;
  $("#sb-live-count").textContent = liveCount ? `${liveCount} live` : "";

  $("#streamer-list").innerHTML =
    streamers
      .map((s) => {
        const info = live.get(s.login);
        const name = info?.displayName || s.name;
        const placed = !!streamerPos(s);
        const sub = isLive(s)
          ? `🔴 ${fmtViewers(info.viewers)} · ${esc(s.characters[0] || info.title || "")}`
          : esc(s.characters.join(", ") || (placed ? "Offline" : "Not on the map"));
        const controls = editing
          ? `<button class="btn small icon${placing === s.id ? " on" : ""}" data-place="${esc(s.id)}" title="Click, then click the map">📍</button>` +
            (placed ? `<button class="btn small icon ghost" data-unplace="${esc(s.id)}" title="Remove from map">✕</button>` : "")
          : isLive(s)
          ? `<a class="btn small icon" href="${esc(multistreamUrl([s.id]))}" title="Watch">▶</a>`
          : "";
        return `
        <div class="sb-item${isLive(s) ? "" : " offline"}" data-streamer="${esc(s.id)}">
          <img class="avatar" loading="lazy" src="${esc(info?.avatar || avatarFallback(name))}" alt="">
          <div class="info"><div>${esc(name)}${placed ? "" : ' <span class="muted" title="Not placed on the map">·</span>'}</div><div class="sub">${sub}</div></div>
          ${controls}
        </div>`;
      })
      .join("") || `<div class="muted">No streamers match.</div>`;

  const filteredPlaces = places.filter((p) => match(p.name + " " + (categories[p.category]?.label || "")));
  $("#place-list").innerHTML =
    filteredPlaces
      .map((p) => {
        const c = categories[p.category] || {};
        return `<div class="sb-item" data-place-id="${esc(p.id)}">
          <div class="poi-dot" style="background:${esc(c.color || "#475569")}">${esc(c.icon || "•")}</div>
          <div class="info"><div>${esc(p.name)}</div><div class="sub">${esc(c.label || p.category)}</div></div>
        </div>`;
      })
      .join("") || `<div class="muted">No places match.</div>`;

  const liveIds = roster.filter(isLive).map((s) => s.id);
  const btn = $("#watch-live");
  btn.classList.toggle("hidden", !liveIds.length);
  btn.href = multistreamUrl(liveIds);
  btn.textContent = `▶ Watch all live (${liveIds.length})`;
  setLiveCount(liveIds.length || null);
}

function flyToStreamer(s) {
  const pos = streamerPos(s);
  if (!pos) {
    toast(editing ? "Click 📍 to put them on the map." : `${s.name} isn't on the map yet — use “Place streamers”.`);
    return;
  }
  const m = pinFor.get(s.id);
  if (m && !editing) map.once("moveend", () => m.openPopup());
  map.flyTo(toLatLng(pos), Math.max(map.getZoom(), 4.5), { duration: 0.8 });
}

function flyToPlace(p) {
  const cat = p.category;
  if (layerPrefs[cat] === false) {
    layerPrefs[cat] = true;
    saveLocal("multirp.mapLayers", layerPrefs);
    renderLayerToggles();
  }
  const zoom = Math.max(map.getZoom(), 4.5, categories[cat]?.minZoom || 0);
  map.once("moveend", () => {
    updatePlaceLayers();
    placeMarkers.get(p.id)?.openPopup();
  });
  map.flyTo(toLatLng(p.pos), zoom, { duration: 0.8 });
}

$("#streamer-list").addEventListener("click", (e) => {
  const placeBtn = e.target.closest("[data-place]");
  const unplaceBtn = e.target.closest("[data-unplace]");
  if (e.target.closest("a")) return;
  if (placeBtn) {
    placing = placing === placeBtn.dataset.place ? null : placeBtn.dataset.place;
    $("#map").classList.toggle("placing", !!placing);
    if (placing) toast(`Click the map to place ${roster.find((s) => s.id === placing)?.name}.`);
    renderSidebar();
    return;
  }
  if (unplaceBtn) {
    const s = roster.find((x) => x.id === unplaceBtn.dataset.unplace);
    if (s) unplace(s);
    return;
  }
  const item = e.target.closest("[data-streamer]");
  const s = item && roster.find((x) => x.id === item.dataset.streamer);
  if (s) {
    flyToStreamer(s);
    closeSidebarOnMobile();
  }
});

$("#place-list").addEventListener("click", (e) => {
  const item = e.target.closest("[data-place-id]");
  const p = item && places.find((x) => x.id === item.dataset.placeId);
  if (p) {
    flyToPlace(p);
    closeSidebarOnMobile();
  }
});

$("#map-search").addEventListener("input", (e) => {
  searchQ = e.target.value.trim().toLowerCase();
  renderSidebar();
});
$("#map-search").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const s = roster.find((x) => [x.login, x.name, ...x.characters].join(" ").toLowerCase().includes(searchQ) && streamerPos(x));
  const p = places.find((x) => x.name.toLowerCase().includes(searchQ));
  if (s) flyToStreamer(s);
  else if (p) flyToPlace(p);
});

// Buttons inside popups ("+" selection, copy coordinates). Leaflet reuses popup
// elements, so one document-level handler avoids stacking listeners.
document.addEventListener("click", async (ev) => {
  const watchBtn = ev.target.closest(".leaflet-popup [data-watch]");
  if (watchBtn) {
    const added = toggleWatch(watchBtn.dataset.watch);
    watchBtn.classList.toggle("on", added);
    watchBtn.textContent = added ? "✓" : "+";
    toast(added ? "Added to your multistream selection (see the Live page)." : "Removed from your selection.");
    return;
  }
  const copyBtn = ev.target.closest(".leaflet-popup [data-copy]");
  if (copyBtn && (await copyText(copyBtn.dataset.copy))) toast(`Copied ${copyBtn.dataset.copy}`);
});

// ---------- Editing ----------

$("#edit-btn").addEventListener("click", () => {
  editing = !editing;
  placing = null;
  $("#map").classList.remove("placing");
  $("#edit-btn").classList.toggle("on", editing);
  $("#edit-btn").textContent = editing ? "✓ Done placing" : "✎ Place streamers";
  $("#edit-hint").classList.toggle("hidden", !editing);
  $("#export-btn").classList.toggle("hidden", !editing);
  renderPins();
  renderSidebar();
});

$("#export-btn").addEventListener("click", () => {
  const json = {
    _help: "Starter list - edit freely. Fields: twitch (or kick), name, characters, group, spot (an id from locations.json) or pos ([x, y] in GTA coordinates). Only twitch/kick is required.",
    streamers: roster.map(streamerToJson),
  };
  const blob = new Blob([JSON.stringify(json, null, 2) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "streamers.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("Replace data/streamers.json in your repo with this file to share it.", 4500);
});

map.on("click", (e) => {
  if (!placing) return;
  const s = roster.find((x) => x.id === placing);
  stopPlacing();
  if (s) savePosition(s, toXY(e.latlng));
});

function stopPlacing() {
  placing = null;
  $("#map").classList.remove("placing");
}

// ---------- Coordinates ----------

map.on("mousemove", (e) => {
  const [x, y] = toXY(e.latlng);
  $("#coords").textContent = `x ${x}  ·  y ${y}`;
});

map.on("contextmenu", (e) => {
  const [x, y] = toXY(e.latlng);
  L.popup()
    .setLatLng(e.latlng)
    .setContent(`<div class="popup-title">x ${x}, y ${y}</div><div class="popup-actions"><button class="btn small" data-copy="[${x}, ${y}]">Copy [x, y]</button></div>`)
    .openOn(map);
});

// ---------- Mobile sidebar ----------

function closeSidebarOnMobile() {
  if (window.matchMedia("(max-width: 760px)").matches) $("#sidebar").classList.remove("open");
}
$("#sidebar-toggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));

// ---------- Live data ----------

async function refreshLive() {
  try {
    live = await fetchLive(roster.filter((s) => s.platform === "twitch").map((s) => s.login));
  } catch (err) {
    console.warn("Live status failed", err);
  }
  renderPins();
  renderSidebar();
}

async function main() {
  initHeader();
  [roster] = await Promise.all([loadRoster(), loadPlaces()]);
  renderPins();
  renderSidebar();
  await refreshLive();
  setInterval(() => document.visibilityState === "visible" && refreshLive(), Math.max(30, CFG.refreshSeconds) * 1000);
}

main();
