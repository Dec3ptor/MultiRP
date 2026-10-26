# MultiRP

A static website for following a GTA V roleplay server (set up for NoPixel), built to run on GitHub Pages with no build step and no server.

- **Live** (`index.html`): who from your streamer list is live on the server right now, with viewers, uptime and stream titles. Tick streams and press **Watch together**.
- **Multistream** (`multistream.html`): up to 16 Twitch (or Kick) streams at once.
  - Grid and Focus layouts (one big stream, the rest small). Changing layout never reloads a player.
  - Sound on one stream at a time (Shift+click 🔊 to mix several), per-stream volume, and drag a stream's name onto another to swap them.
  - Tabbed Twitch chat panel you can resize.
  - The URL holds the whole setup, so **Share** gives a link that opens the same streams in the same layout.
  - Shortcuts: `1`–`9` sound, `Shift`+`1`–`9` make big, `G` layout, `C` chat, `F` fullscreen.
- **Map** (`map.html`): interactive GTA V map (Atlas and Satellite) with police, hospitals, banks, businesses and landmarks, plus pins for streamers (red ring = live). Click a pin to watch everyone there.
  - **Place streamers** mode: click 📍 next to a streamer, then click a place or anywhere on the map; drag pins to move them. **Export** downloads an updated `streamers.json`.
  - Right-click (long-press on mobile) shows GTA coordinates, for adding your own places.
  - The URL keeps the map position (`map.html#x,y,zoom`), so you can link to a spot.

## Publish it on GitHub Pages

1. Merge this branch into `main`.
2. In the repo on GitHub open **Settings → Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`, then **Save**.
3. After a minute the site is at `https://dec3ptor.github.io/MultiRP/`.

Twitch only plays embeds on HTTPS sites, and GitHub Pages is HTTPS, so nothing else is needed.

## Make it yours

| File | What to change |
| --- | --- |
| `config.js` | Site name, server name, the title filter that decides who counts as "on the server", refresh rate, map tile URLs. |
| `data/streamers.json` | Your streamer list. Only `twitch` (or `kick`) is required; `name`, `characters`, `group`, and a map `spot` (a place id) or `pos` (`[x, y]`) are optional. |
| `data/locations.json` | Map places and their categories (icon, colour, and an optional `minZoom` that hides a busy category until you zoom in). |

The included streamer list is a small starter set. Character names come from earlier NoPixel seasons, so check and update them. Streamers you add on the Live page, and pins you place on the map, are saved only in your browser until you put them in `data/streamers.json`.

### Live status

Live status comes from [api.ivr.fi](https://api.ivr.fi), a free public Twitch API that needs no key. A stream counts as "on the server" when it's live **and** its title matches `titleFilter` in `config.js` (untick **Server titles only** on the Live page to see everyone who is live).

**Optional: find every stream on the server, not just your list.** Register an app at <https://dev.twitch.tv/console/apps> with the OAuth Redirect URL set to your site (for example `https://dec3ptor.github.io/MultiRP/`), put its Client ID in `config.js` as `twitchClientId`, then press **Connect Twitch** on the Live page. The site then searches the GTA V category for matching titles and lists them under "Also live on the server". The login token stays in your browser.

### Map tiles

The map images load from the public [meesvrh/gtav-map-tiles](https://github.com/meesvrh/gtav-map-tiles) repository, pinned to one commit so they can't change underneath you. To host them yourself instead, copy that repo's `tiles/` folder into this repo and change the two `url` values in `config.js` to `tiles/atlas/{z}/{x}/{y}.jpg` and `tiles/satellite/{z}/{x}/{y}.jpg`. That adds roughly 2,700 image files to the repo.

## Preview locally

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Twitch players work on `localhost` too.

## Credits

- Map: [Leaflet](https://leafletjs.com) 1.9.4 (BSD-2-Clause, in `vendor/leaflet/`). Map imagery © Rockstar Games.
- Not affiliated with NoPixel, Rockstar Games, Twitch or Kick.
