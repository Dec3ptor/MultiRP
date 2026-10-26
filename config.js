// Site settings. This is the only file most people need to edit.
window.MULTIRP_CONFIG = {
  siteName: "MultiRP",
  serverName: "NoPixel",

  // A live stream counts as "on the server" when its title matches this
  // (case-insensitive regular expression).
  titleFilter: "no\\s?pixel|\\bnp\\s?(v|4\\.0|4|5)?\\b",

  // Twitch category to search when discovering streams (Grand Theft Auto V).
  twitchGameId: "32982",

  // Optional. Paste the Client ID of a Twitch application you register at
  // https://dev.twitch.tv/console/apps to unlock "Connect Twitch", which finds
  // every live stream on the server, not just the ones in data/streamers.json.
  // In the Twitch app, set the OAuth Redirect URL to your site's index page,
  // e.g. https://<you>.github.io/MultiRP/
  twitchClientId: "",

  // How often the live list refreshes, in seconds.
  refreshSeconds: 120,

  // Map tiles. {z}/{x}/{y} are filled in by the map. To self-host, copy the
  // tiles into this repo (see README) and change these to "tiles/atlas/{z}/{x}/{y}.jpg".
  tiles: {
    atlas: {
      label: "Atlas",
      url: "https://raw.githubusercontent.com/meesvrh/gtav-map-tiles/d507184b92af2e042721ad6d52c85a23da1ae3b1/tiles/atlas/{z}/{x}/{y}.jpg",
    },
    satellite: {
      label: "Satellite",
      url: "https://raw.githubusercontent.com/meesvrh/gtav-map-tiles/d507184b92af2e042721ad6d52c85a23da1ae3b1/tiles/satellite/{z}/{x}/{y}.jpg",
    },
  },
  defaultTiles: "atlas",
};
