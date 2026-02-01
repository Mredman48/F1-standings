// updateNextRace.js
import fs from "node:fs/promises";
import path from "node:path";
import ical from "node-ical";
import sharp from "sharp";

const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";

// Widgy-friendly local strings
const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA";

// Your GitHub Pages base URL
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Where we save the downloaded+converted track images (commit this folder)
const TRACKMAP_DIR = "trackmaps";
const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// ---------------------- Date/time helpers ----------------------
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

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function makeTrackPngUrl(filename) {
  return `${PAGES_BASE}/${TRACKMAP_DIR}/${encodeURIComponent(filename)}`;
}

// ---------------------- Calendar parsing helpers ----------------------
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

// ---------------------- Networking helpers ----------------------
async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "text/html,*/*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "image/*,*/*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/\bgrand prix\b/g, "")
    .replace(/\bgp\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugifyFromGpName(gpName) {
  // e.g. "Australian GP" -> "australia", "Mexico City GP" -> "mexico-city"
  const n = normalize(gpName);
  if (!n) return null;
  return n.split(" ").join("-");
}

function scoreHref(href, gpName) {
  const tokens = normalize(gpName).split(" ").filter((t) => t.length > 2);
  const h = href.toLowerCase();
  let score = 0;
  for (const t of tokens) if (h.includes(t)) score += 2;
  return score;
}

async function resolveF1RaceSlug(season, gpName) {
  // Try direct slug from gpName first
  const candidate = slugifyFromGpName(gpName);
  if (candidate) {
    const url = `https://www.formula1.com/en/racing/${season}/${candidate}`;
    try {
      await fetchText(url);
      return { slug: candidate, url, source: "slugified" };
    } catch {
      // fall through
    }
  }

  // Fallback: scrape season page for race links and pick best match
  const seasonUrl = `https://www.formula1.com/en/racing/${season}.html`;
  const html = await fetchText(seasonUrl);

  const hrefs = Array.from(
    html.matchAll(new RegExp(`/en/racing/${season}/[a-z0-9-]+`, "g"))
  )
    .map((m) => m[0])
    .filter(Boolean);

  const uniq = [...new Set(hrefs)];
  if (uniq.length === 0) throw new Error(`No race links found on ${seasonUrl}`);

  const best = uniq
    .map((href) => ({ href, score: scoreHref(href, gpName) }))
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.score === 0) {
    throw new Error(`Could not match gpName="${gpName}" to a race link on formula1.com`);
  }

  const fullUrl = `https://www.formula1.com${best.href}`;
  const slug = best.href.split(`/en/racing/${season}/`)[1];

  return { slug, url: fullUrl, source: "season-page-scan" };
}

function extractDetailedTrackMediaUrl(html, season) {
  // Look for: https://media.formula1.com/image/upload/.../common/f1/2026/track/...detailed.webp
  const re = new RegExp(
    `https://media\\.formula1\\.com/image/upload[^"']+/common/f1/${season}/track/[^"']+detailed\\.(webp|png)`,
    "i"
  );
  const m = html.match(re);
  return m ? m[0] : null;
}

async function fetchF1DetailedTrackPng({ season, gpName }) {
  const resolved = await resolveF1RaceSlug(season, gpName);
  const html = await fetchText(resolved.url);

  const mediaUrl = extractDetailedTrackMediaUrl(html, season);
  if (!mediaUrl) {
    return {
      found: false,
      source: "formula1.com race page",
      racePageUrl: resolved.url,
      note: "Could not find a '...track/...detailed.webp' image on the race page.",
      mediaUrl: null,
      pngUrl: null,
    };
  }

  // Download (webp/png) and ensure PNG output
  await ensureDir(TRACKMAP_DIR);

  const inputBuf = await fetchBuffer(mediaUrl);
  const outputName = `f1_${season}_${resolved.slug}_detailed.png`;
  const outputPath = path.join(TRACKMAP_DIR, outputName);

  // Convert to PNG (if already png, sharp just rewrites as png)
  const pngBuf = await sharp(inputBuf).png().toBuffer();
  await fs.writeFile(outputPath, pngBuf);

  return {
    found: true,
    source: "media.formula1.com (scraped from race page)",
    racePageUrl: resolved.url,
    mediaUrl,
    pngUrl: makeTrackPngUrl(outputName),
  };
}

// ---------------------- Main ----------------------
async function updateNextRace() {
  const now = new Date();

  const data = await ical.async.fromURL(ICS_URL, {
    headers: { "User-Agent": UA },
  });

  const events = Object.values(data).filter((x) => x?.type === "VEVENT");

  const sessions = events
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

  const nextRace = sessions.find((s) => s.sessionType === "Race" && s.start > now);
  if (!nextRace) throw new Error("Could not find upcoming Race session in calendar feed.");

  const gpName = nextRace.gpName;
  const season = String(nextRace.start.getUTCFullYear());

  const gpSessions = sessions
    .filter((s) => s.gpName === gpName)
    .sort((a, b) => a.start - b.start);

  const weekendStart = gpSessions[0].start;
  const weekendEnd = gpSessions[gpSessions.length - 1].end;

  // ✅ F1 official detailed map (PNG saved + served via GitHub Pages)
  const trackMap = await fetchF1DetailedTrackPng({ season, gpName });

  const sessionOrder = ["FP1", "FP2", "FP3", "Qualifying", "Sprint Qualifying", "Sprint", "Race"];
  const sessionsOut = sessionOrder
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

  const out = {
    header: "Next F1 race weekend",
    generatedAtUtc: now.toISOString(),
    displayTimeZone: USER_TZ,
    source: { kind: "ics", url: ICS_URL },

    grandPrix: {
      name: gpName,
      location: nextRace.location,
      season,
    },

    trackMap, // Widgy image -> trackMap.pngUrl

    countdowns: {
      weekendStartsInDays: daysUntil(weekendStart, now),
      raceStartsInDays: daysUntil(nextRace.start, now),
    },

    weekend: {
      startUtc: weekendStart.toISOString(),
      endUtc: weekendEnd.toISOString(),
      startLocalDateShort: shortDateInTZ(weekendStart),
      startLocalTimeShort: shortTimeInTZ(weekendStart),
    },

    race: {
      startUtc: nextRace.start.toISOString(),
      endUtc: nextRace.end.toISOString(),
      startLocalDateShort: shortDateInTZ(nextRace.start),
      startLocalTimeShort: shortTimeInTZ(nextRace.start),
    },

    sessions: sessionsOut,

    notes:
      "trackMap.pngUrl is a GitHub Pages PNG created from the official F1 detailed track image (scraped from the race page).",
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote f1_next_race.json for ${gpName}`);
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});