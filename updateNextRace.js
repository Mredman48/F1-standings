// updateNextRace.js
import fs from "node:fs/promises";
import path from "node:path";
import ical from "node-ical";
import sharp from "sharp";

const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";

// These are only used for the pre-formatted local strings we include in sessions.
// Widgy can also convert from startUtc itself, but this keeps your JSON widget-ready.
const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA";

// Your GitHub Pages base for this repo
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Where track PNGs are written (commit this folder)
const TRACKMAP_DIR = "trackmaps";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

/* -------------------- time helpers -------------------- */

function daysUntil(date, now = new Date()) {
  const ms = date.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function shortDateInTZ(dateObj, timeZone = USER_TZ) {
  return dateObj.toLocaleDateString(LOCALE, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "2-digit",
  });
}

function shortTimeInTZ(dateObj, timeZone = USER_TZ) {
  return dateObj.toLocaleTimeString(LOCALE, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function shortDateTimeInTZ(dateObj, timeZone = USER_TZ) {
  return `${shortDateInTZ(dateObj, timeZone)} ${shortTimeInTZ(dateObj, timeZone)}`;
}

/* -------------------- fs helpers -------------------- */

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function makeTrackPngUrl(filename) {
  return `${PAGES_BASE}/${TRACKMAP_DIR}/${encodeURIComponent(filename)}`;
}

/* -------------------- network helpers -------------------- */

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "image/*,*/*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/* -------------------- ICS parsing -------------------- */

function getSessionType(summary) {
  const s = (summary || "").toLowerCase();
  if (s.includes("practice 1") || s.includes("fp1")) return "FP1";
  if (s.includes("practice 2") || s.includes("fp2")) return "FP2";
  if (s.includes("practice 3") || s.includes("fp3")) return "FP3";
  if (s.includes("sprint qualifying")) return "Sprint Qualifying";
  if (s.includes("sprint")) return "Sprint";
  if (s.includes("qualifying") || s.includes("quali")) return "Qualifying";
  if (s.includes("race")) return "Race";
  return null;
}

function getGpName(summary) {
  const parts = (summary || "").split(" - ");
  return (parts[0] || summary || "").trim();
}

/* -------------------- string helpers -------------------- */

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(s) {
  return normalize(s).split(" ").filter(Boolean);
}

function titleCaseWords(s) {
  if (!s) return null;
  return String(s)
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function titleCaseFromSlug(slug) {
  if (!slug) return null;
  return slug
    .replace(/[-_]+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/* -------------------- track map extraction -------------------- */

function extractDetailedTrackMediaUrl(html, season) {
  // Matches:
  // https://media.formula1.com/image/upload/.../common/f1/2026/track/2026trackmelbournedetailed.webp
  const re = new RegExp(
    `https://media\\.formula1\\.com/image/upload[^"']+/common/f1/${season}/track/[^"']+detailed\\.(webp|png)`,
    "i"
  );
  const m = html.match(re);
  return m ? m[0] : null;
}

function getCityFromTrackMediaUrl(mediaUrl) {
  // ".../2026trackmelbournedetailed.webp" -> "Melbourne"
  if (!mediaUrl) return null;
  const m = mediaUrl.match(/\/(\d{4})track([a-z0-9]+)detailed\.(webp|png)/i);
  if (!m) return null;
  return titleCaseFromSlug(m[2]);
}

async function downloadToPng({ mediaUrl, outName }) {
  await ensureDir(TRACKMAP_DIR);
  const inputBuf = await fetchBuffer(mediaUrl);
  const outPath = path.join(TRACKMAP_DIR, outName);
  const pngBuf = await sharp(inputBuf).png().toBuffer();
  await fs.writeFile(outPath, pngBuf);
  return makeTrackPngUrl(outName);
}

async function fetchTrackMapFromF1RacePage({ pageUrl, season, outFileBase }) {
  const html = await fetchText(pageUrl);
  const mediaUrl = extractDetailedTrackMediaUrl(html, season);
  if (!mediaUrl) {
    return {
      found: false,
      pageUrl,
      mediaUrl: null,
      pngUrl: null,
      note: "No detailed track image found on race page.",
    };
  }
  const outName = `${outFileBase}.png`;
  const pngUrl = await downloadToPng({ mediaUrl, outName });
  return { found: true, pageUrl, mediaUrl, pngUrl, note: null };
}

/* -------------------- resolve correct race page (NO testing) -------------------- */

function isBadSlug(slug) {
  if (!slug) return true;
  return slug.startsWith("pre-season-testing");
}

function scoreSlug(slug, gpName, locationRaw) {
  // score based on overlap with GP name and location (Australia, etc.)
  const sTokens = tokens(slug);
  const gpTokens = new Set(tokens(gpName));
  const locTokens = new Set(tokens(locationRaw));

  let score = 0;

  // slug tokens matching location is strong
  for (const t of sTokens) {
    if (locTokens.has(t)) score += 20;
    if (gpTokens.has(t)) score += 6;
  }

  // small boost if gpName contains the country adjective (australian -> australia)
  const gpNorm = normalize(gpName);
  if (slug === "australia" && gpNorm.includes("australian")) score += 30;

  return score;
}

async function resolveRacePage({ season, gpName, locationRaw }) {
  const seasonUrl = `https://www.formula1.com/en/racing/${season}`;
  const html = await fetchText(seasonUrl);

  // pull all /en/racing/{season}/{slug}
  const matches = Array.from(html.matchAll(new RegExp(`/en/racing/${season}/[a-z0-9-]+`, "g"))).map((m) => m[0]);
  const uniq = [...new Set(matches)];

  const slugs = uniq
    .map((href) => href.split(`/en/racing/${season}/`)[1])
    .filter((slug) => slug && !isBadSlug(slug));

  if (slugs.length === 0) throw new Error("No race slugs found on season page.");

  const ranked = slugs
    .map((slug) => ({
      slug,
      score: scoreSlug(slug, gpName, locationRaw),
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const pageUrl = `https://www.formula1.com/en/racing/${season}/${best.slug}`;
  return { slug: best.slug, pageUrl, rankedTop: ranked.slice(0, 8) };
}

/* -------------------- country -> ISO2 -> flag URL -------------------- */

function normalizeCountryName(s) {
  return (s || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\./g, "")
    .replace(/[^a-z\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Minimal mapping; add as needed when you hit an unmapped country string.
function countryToIso2(countryName) {
  const c = normalizeCountryName(countryName);

  const map = {
    // Oceania / Asia / Middle East
    australia: "au",
    bahrain: "bh",
    china: "cn",
    japan: "jp",
    "saudi arabia": "sa",
    qatar: "qa",
    singapore: "sg",
    "united arab emirates": "ae",
    uae: "ae",

    // Americas
    canada: "ca",
    mexico: "mx",
    brazil: "br",
    argentina: "ar",
    "united states": "us",
    "united states of america": "us",
    usa: "us",

    // Europe
    "united kingdom": "gb",
    "great britain": "gb",
    britain: "gb",
    monaco: "mc",
    italy: "it",
    spain: "es",
    france: "fr",
    belgium: "be",
    netherlands: "nl",
    austria: "at",
    hungary: "hu",
    germany: "de",
    portugal: "pt",
    sweden: "se",
    finland: "fi",
    denmark: "dk",
    norway: "no",
    poland: "pl",
    turkey: "tr",
    switzerland: "ch",
  };

  return map[c] || null;
}

function buildFlagUrls(iso2) {
  if (!iso2) return { iso2: null, png: null, svg: null };
  const code = iso2.toLowerCase();
  return {
    iso2: code,
    png: `https://flagcdn.com/w160/${code}.png`,
    svg: `https://flagcdn.com/${code}.svg`,
  };
}

/* -------------------- sessions + windows -------------------- */

function buildSessionsForRaceWeekend(gpSessions) {
  const order = ["FP1", "FP2", "FP3", "Qualifying", "Sprint Qualifying", "Sprint", "Race"];

  function displayType(type) {
    if (type === "Qualifying") return "Quali";
    if (type === "Sprint Qualifying") return "Sprint Quali";
    return type;
  }

  return order
    .map((type) => {
      const s = gpSessions.find((x) => x.sessionType === type);
      if (!s) return null;

      return {
        type: displayType(type),
        startUtc: s.start.toISOString(),
        endUtc: s.end.toISOString(),
        startLocalDateShort: shortDateInTZ(s.start),
        startLocalTimeShort: shortTimeInTZ(s.start),
        startLocalDateTimeShort: shortDateTimeInTZ(s.start),
      };
    })
    .filter(Boolean);
}

function computeWindowFromSessions(sessions) {
  if (!sessions || sessions.length === 0) return { startUtc: null, endUtc: null };
  const starts = sessions.map((s) => new Date(s.startUtc)).filter((d) => !isNaN(d));
  const ends = sessions.map((s) => new Date(s.endUtc)).filter((d) => !isNaN(d));
  const startUtc = starts.length ? new Date(Math.min(...starts)).toISOString() : null;
  const endUtc = ends.length ? new Date(Math.max(...ends)).toISOString() : null;
  return { startUtc, endUtc };
}

/* -------------------- main -------------------- */

async function updateNextRace() {
  const now = new Date();

  // ICS -> sessions
  const ics = await ical.async.fromURL(ICS_URL, { headers: { "User-Agent": UA } });
  const events = Object.values(ics).filter((x) => x?.type === "VEVENT");

  const allSessions = events
    .map((ev) => {
      const summary = (ev.summary || "").trim();
      const sessionType = getSessionType(summary);
      if (!sessionType) return null;

      const start = ev.start instanceof Date ? ev.start : new Date(ev.start);
      const end = ev.end instanceof Date ? ev.end : new Date(ev.end);

      return {
        gpName: getGpName(summary),
        sessionType,
        start,
        end,
        location: ev.location || null, // often just a country like "Australia"
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  const nextRaceSession = allSessions.find((s) => s.sessionType === "Race" && s.start > now);
  if (!nextRaceSession) throw new Error("Could not find upcoming Race session in calendar feed.");

  const season = String(nextRaceSession.start.getUTCFullYear());
  const gpName = nextRaceSession.gpName;
  const locationRaw = nextRaceSession.location || "";

  // group sessions for this GP
  const gpSessions = allSessions.filter((s) => s.gpName === gpName).sort((a, b) => a.start - b.start);
  const weekendStart = gpSessions[0].start;

  // resolve correct race page slug (and avoid testing slugs)
  const racePage = await resolveRacePage({ season, gpName, locationRaw });

  // track map from the official race page
  const trackMap = await fetchTrackMapFromF1RacePage({
    pageUrl: racePage.pageUrl,
    season,
    outFileBase: `f1_${season}_${racePage.slug}_detailed`,
  });

  // city from the detailed track image filename (melbourne, etc.)
  const city = getCityFromTrackMediaUrl(trackMap.mediaUrl);

  // country from ICS raw (your feed commonly returns "Australia")
  const country = locationRaw ? titleCaseWords(locationRaw) : null;

  // flag URLs from country ISO2
  const iso2 = countryToIso2(country);
  const flag = buildFlagUrls(iso2);

  const sessionsOut = buildSessionsForRaceWeekend(gpSessions);
  const window = computeWindowFromSessions(sessionsOut);

  const out = {
    header: "Next F1 event",
    generatedAtUtc: now.toISOString(),
    displayTimeZone: USER_TZ,
    source: { kind: "ics", url: ICS_URL },
    nextEvent: {
      type: "RACE_WEEKEND",
      title: gpName,
      season,
      location: {
        raw: locationRaw || null,
        city: city || null,
        country: country || null,
        flag, // { iso2, png, svg }
      },
      racePage: {
        slug: racePage.slug,
        url: racePage.pageUrl,
      },
      trackMap,
      countdowns: { startsInDays: daysUntil(weekendStart, now) },
      weekend: { startUtc: window.startUtc, endUtc: window.endUtc },
      sessions: sessionsOut,
    },
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");

  // Helpful logs for Actions debugging
  console.log("Resolved race slug:", racePage.slug);
  console.log("Race page url:", racePage.pageUrl);
  console.log("Ranked slugs (top):", racePage.rankedTop);
  console.log("Location raw:", locationRaw);
  console.log("Country:", country, "ISO2:", iso2);
  console.log("City inferred:", city);
  console.log("Flag:", flag);
  console.log("Track map:", trackMap);
  console.log("Wrote f1_next_race.json");
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});