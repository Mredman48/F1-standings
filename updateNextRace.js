// updateNextRace.js
import fs from "node:fs/promises";
import path from "node:path";
import ical from "node-ical";
import sharp from "sharp";

/**
 * Sources
 */
const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";

/**
 * Local display formatting (for Widgy users)
 */
const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA";

/**
 * GitHub Pages base for your repo
 */
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

/**
 * Where track PNGs are written (commit this folder)
 */
const TRACKMAP_DIR = "trackmaps";

/**
 * UA header to reduce CDN weirdness
 */
const UA = "f1-standings-bot/1.0 (GitHub Actions)";

/**
 * Testing pages (official F1)
 */
const TESTING_SLUGS = ["pre-season-testing-1", "pre-season-testing-2", "pre-season-testing-3"];

/* -------------------- Time helpers -------------------- */

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

function monthIndex(mon3) {
  const m = (mon3 || "").toLowerCase();
  const map = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  return map[m] ?? null;
}

/* -------------------- FS helpers -------------------- */

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function makeTrackPngUrl(filename) {
  return `${PAGES_BASE}/${TRACKMAP_DIR}/${encodeURIComponent(filename)}`;
}

/* -------------------- Network helpers -------------------- */

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

/* -------------------- Track map extraction -------------------- */

function extractDetailedTrackMediaUrl(html, season) {
  const re = new RegExp(
    `https://media\\.formula1\\.com/image/upload[^"']+/common/f1/${season}/track/[^"']+detailed\\.(webp|png)`,
    "i"
  );
  const m = html.match(re);
  return m ? m[0] : null;
}

async function downloadToPng({ mediaUrl, outName }) {
  await ensureDir(TRACKMAP_DIR);
  const inputBuf = await fetchBuffer(mediaUrl);
  const outPath = path.join(TRACKMAP_DIR, outName);
  const pngBuf = await sharp(inputBuf).png().toBuffer();
  await fs.writeFile(outPath, pngBuf);
  return makeTrackPngUrl(outName);
}

async function fetchTrackMapFromF1Page({ pageUrl, season, outFileBase }) {
  try {
    const html = await fetchText(pageUrl);
    const mediaUrl = extractDetailedTrackMediaUrl(html, season);
    if (!mediaUrl) {
      return { found: false, pageUrl, mediaUrl: null, pngUrl: null, note: "No detailed track image found on page." };
    }
    const outName = `${outFileBase}.png`;
    const pngUrl = await downloadToPng({ mediaUrl, outName });
    return { found: true, pageUrl, mediaUrl, pngUrl, note: null };
  } catch (e) {
    return {
      found: false,
      pageUrl,
      mediaUrl: null,
      pngUrl: null,
      note: `Track map fetch failed: ${e?.message || String(e)}`,
    };
  }
}

/* -------------------- Race page resolution (fallback scoring) -------------------- */

function normalizeToken(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokensFrom(s) {
  return normalizeToken(s).split(" ").filter((t) => t.length > 2);
}

function scoreHrefByGpName(href, gpName) {
  const stop = new Set(["formula", "qatar", "airways", "aramco", "heineken", "pirelli", "crypto", "msc"]);
  const h = href.toLowerCase();
  const gpTokens = tokensFrom(gpName).filter((t) => !stop.has(t));
  let score = 0;
  for (const t of gpTokens) if (h.includes(t)) score += 1;
  return score;
}

async function resolveF1RacePageByName({ season, gpName }) {
  const seasonUrl = `https://www.formula1.com/en/racing/${season}`;
  const html = await fetchText(seasonUrl);

  const hrefs = Array.from(html.matchAll(new RegExp(`/en/racing/${season}/[a-z0-9-]+`, "g")))
    .map((m) => m[0])
    .filter(Boolean);

  const uniq = [...new Set(hrefs)];
  if (uniq.length === 0) return { found: false, url: null, slug: null, note: "No race links found" };

  const scored = uniq
    .map((href) => ({ href, score: scoreHrefByGpName(href, gpName) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const fullUrl = `https://www.formula1.com${best.href}`;
  const slug = best.href.split(`/en/racing/${season}/`)[1];

  return { found: true, url: fullUrl, slug, debugTop: scored.slice(0, 5) };
}

/* -------------------- Location (city/country) from F1 schedule + track media -------------------- */

function stripTags(s) {
  return (s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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

/**
 * Try to find the anchor <a href="/en/racing/{season}/{slug}"> ... </a> from the season schedule page,
 * then extract the country label.
 *
 * Note: schedule page is authoritative for country. City isn't always present.
 */
async function getCountryCityFromSeasonSchedule({ season, slug }) {
  const seasonUrl = `https://www.formula1.com/en/racing/${season}`;
  const html = await fetchText(seasonUrl);

  const aRe = new RegExp(`<a[^>]+href="/en/racing/${season}/${slug}"[^>]*>([\\s\\S]*?)</a>`, "i");
  const m = html.match(aRe);
  if (!m) return { found: false, country: null, city: null };

  const text = stripTags(m[1]);

  // Pull portion between "Flag of ..." and "FORMULA"
  const seg = text.match(/Flag of .*?\s+(.*?)\s+FORMULA/i)?.[1]?.trim() || null;
  if (!seg) return { found: false, country: null, city: null };

  // Some races include a city label at the end (e.g. "United States of America Miami")
  // We detect a few common ones; otherwise treat it as just country.
  const knownCitySuffixes = [
    "Miami",
    "Las Vegas",
    "Abu Dhabi",
    "São Paulo",
    "Sao Paulo",
    "Mexico City",
    "Barcelona-Catalunya",
  ];

  let country = seg;
  let city = null;

  for (const suffix of knownCitySuffixes) {
    if (seg.toLowerCase().endsWith(suffix.toLowerCase())) {
      city = suffix;
      country = seg.slice(0, seg.length - suffix.length).trim();
      break;
    }
  }

  return { found: true, country: country || null, city: city || null };
}

/**
 * If we have a detailed track media URL, infer the city slug:
 * ".../2026trackmelbournedetailed.webp" -> "Melbourne"
 */
function getCityFromTrackMediaUrl(mediaUrl) {
  if (!mediaUrl) return null;
  const m = mediaUrl.match(/\/(\d{4})track([a-z0-9]+)detailed\.(webp|png)/i);
  if (!m) return null;
  return titleCaseFromSlug(m[2]);
}

/* -------------------- Event builder -------------------- */

function buildSessionsForRaceWeekend(gpSessions) {
  const order = ["FP1", "FP2", "FP3", "Qualifying", "Sprint Qualifying", "Sprint", "Race"];
  return order
    .map((type) => {
      const s = gpSessions.find((x) => x.sessionType === type);
      if (!s) return null;
      return {
        type,
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

/* -------------------- Main -------------------- */

async function updateNextRace() {
  const now = new Date();

  // ---- Parse race weekend sessions from ICS
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
        summary,
        gpName: getGpName(summary),
        sessionType,
        start,
        end,
        location: ev.location || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  const nextRaceSession = allSessions.find((s) => s.sessionType === "Race" && s.start > now);
  if (!nextRaceSession) throw new Error("Could not find upcoming Race session in calendar feed.");

  const season = String(nextRaceSession.start.getUTCFullYear());
  const gpName = nextRaceSession.gpName;

  // Group all sessions for that GP
  const gpSessions = allSessions.filter((s) => s.gpName === gpName).sort((a, b) => a.start - b.start);
  const weekendStart = gpSessions[0].start;

  // Resolve race page slug/url (for schedule parsing + track media)
  const racePage = await resolveF1RacePageByName({ season, gpName });
  if (!racePage.found) throw new Error("Could not resolve F1 race page slug from season schedule.");

  // Country/city from season schedule (country usually works; city sometimes null)
  const locFromSchedule = await getCountryCityFromSeasonSchedule({ season, slug: racePage.slug });

  // Track map (detailed, sectors) from race page
  const trackMap = await fetchTrackMapFromF1Page({
    pageUrl: racePage.url,
    season,
    outFileBase: `f1_${season}_${racePage.slug}_detailed`,
  });

  // If schedule didn't give city, infer from track media URL (Melbourne, etc.)
  let city = locFromSchedule.city;
  if (!city) city = getCityFromTrackMediaUrl(trackMap.mediaUrl);

  // Country from schedule (if still missing, null)
  const country = locFromSchedule.country || null;

  // Build event
  const sessionsOut = buildSessionsForRaceWeekend(gpSessions);
  const window = computeWindowFromSessions(sessionsOut);

  const nextEvent = {
    type: "RACE_WEEKEND",
    title: gpName,
    season,
    location: {
      raw: nextRaceSession.location || null, // kept for debugging; often empty
      city: city || null,
      country,
    },
    trackMap,
    countdowns: { startsInDays: daysUntil(weekendStart, now) },
    weekend: { startUtc: window.startUtc, endUtc: window.endUtc },
    sessions: sessionsOut,
  };

  const out = {
    header: "Next F1 event",
    generatedAtUtc: now.toISOString(),
    displayTimeZone: USER_TZ,
    source: { kind: "ics", url: ICS_URL },
    nextEvent,
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");

  // Helpful console output for Actions logs
  console.log("Resolved slug:", racePage.slug);
  console.log("Schedule location:", locFromSchedule);
  console.log("Track media city:", getCityFromTrackMediaUrl(trackMap.mediaUrl));
  console.log("Final location:", nextEvent.location);
  console.log(`Wrote f1_next_race.json season=${season}`);
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});