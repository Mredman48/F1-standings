// updateNextRace.js
import fs from "node:fs/promises";
import path from "node:path";
import ical from "node-ical";
import sharp from "sharp";

const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";

const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA";

const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const TRACKMAP_DIR = "trackmaps";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// ---------------------- helpers ----------------------
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
    hour12: false, // 24h
  });
}

function shortDateTimeInTZ(dateObj, timeZone = USER_TZ) {
  return `${shortDateInTZ(dateObj, timeZone)} ${shortTimeInTZ(dateObj, timeZone)}`;
}

function monthIndex(mon3) {
  const m = (mon3 || "").toLowerCase();
  const map = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  return map[m] ?? null;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function makeTrackPngUrl(filename) {
  return `${PAGES_BASE}/${TRACKMAP_DIR}/${encodeURIComponent(filename)}`;
}

function splitLocation(location) {
  if (!location || typeof location !== "string") return { city: null, country: null };
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { city: null, country: null };
  if (parts.length === 1) return { city: parts[0] || null, country: null };
  return { city: parts[0] || null, country: parts[parts.length - 1] || null };
}

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

// ---------------------- F1 detailed map scraping ----------------------
function extractDetailedTrackMediaUrl(html, season) {
  // Looks for: .../common/f1/2026/track/...detailed.webp
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
  const html = await fetchText(pageUrl);
  const mediaUrl = extractDetailedTrackMediaUrl(html, season);
  if (!mediaUrl) {
    return {
      found: false,
      pageUrl,
      mediaUrl: null,
      pngUrl: null,
      note: "No detailed track image found on page.",
    };
  }
  const outName = `${outFileBase}.png`;
  const pngUrl = await downloadToPng({ mediaUrl, outName });
  return { found: true, pageUrl, mediaUrl, pngUrl, note: null };
}

// ---------------------- Race page resolution (location-first to avoid “Qatar” sponsor issue) ----------------------
function normalizeToken(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokensFrom(s) {
  return normalizeToken(s).split(" ").filter((t) => t.length > 2);
}

function scoreHrefByLocation(href, city, country) {
  const h = href.toLowerCase();
  const cTokens = tokensFrom(country);
  const cityTokens = tokensFrom(city);

  let score = 0;
  for (const t of cTokens) if (h.includes(t)) score += 6;     // country is strong
  for (const t of cityTokens) if (h.includes(t)) score += 10; // city is strongest

  return score;
}

function scoreHrefByGpName(href, gpName) {
  // very low weight to avoid sponsor words dominating
  const h = href.toLowerCase();
  const gpTokens = tokensFrom(gpName)
    .filter((t) => !["formula", "qatar", "airways", "heineken", "pirelli", "aramco"].includes(t));

  let score = 0;
  for (const t of gpTokens) if (h.includes(t)) score += 1;
  return score;
}

async function resolveF1RacePage({ season, gpName, city, country }) {
  // F1 race pages are listed on /en/racing/{season}
  const seasonUrl = `https://www.formula1.com/en/racing/${season}`;
  const html = await fetchText(seasonUrl);

  const hrefs = Array.from(html.matchAll(new RegExp(`/en/racing/${season}/[a-z0-9-]+`, "g")))
    .map((m) => m[0])
    .filter(Boolean);

  const uniq = [...new Set(hrefs)];

  if (uniq.length === 0) {
    // fallback: best-effort direct Australia page if we can
    return { found: false, url: null, slug: null, source: "season-scan", note: "No race links found" };
  }

  const scored = uniq.map((href) => {
    const s1 = scoreHrefByLocation(href, city, country);
    const s2 = scoreHrefByGpName(href, gpName);
    return { href, score: s1 * 100 + s2 }; // location dominates
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  const fullUrl = `https://www.formula1.com${best.href}`;
  const slug = best.href.split(`/en/racing/${season}/`)[1];

  return { found: true, url: fullUrl, slug, source: "season-scan-location-first", debugTop: scored.slice(0, 5) };
}

// ---------------------- Testing (use dedicated testing pages) ----------------------
const TESTING_SLUGS = [
  "pre-season-testing-1", // Bahrain Test 1 (page exists)  [oai_citation:1‡Formula 1® - The Official F1® Website](https://www.formula1.com/en/racing/2026/pre-season-testing-1?utm_source=chatgpt.com)
  "pre-season-testing-2", // Bahrain Test 2 (page exists in 2026)
  "pre-season-testing-3", // if they publish it again
];

function parseTestingScheduleFromPage(html, season) {
  // Matches lines like: "11 Feb Day 1 07:00 - 16:00"
  const flat = html.replace(/\s+/g, " ");

  const re = /(\d{1,2})\s+([A-Za-z]{3})\s+Day\s+(\d)\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/g;
  const sessions = [];

  for (const m of flat.matchAll(re)) {
    const day = Number(m[1]);
    const mon = m[2];
    const dayNo = Number(m[3]);
    const startHHMM = m[4];
    const endHHMM = m[5];

    const mi = monthIndex(mon);
    if (mi == null || !Number.isFinite(day)) continue;

    // Times on the page are “Track time” / “My time” toggles; we treat them as local track time unknown tz.
    // For your widget, date range + countdown is most important.
    // We still store “display strings” rather than pretend UTC is precise.
    sessions.push({
      label: `Day ${dayNo}`,
      date: new Date(Date.UTC(Number(season), mi, day, 0, 0, 0)).toISOString().slice(0, 10),
      startTime: startHHMM,
      endTime: endHHMM,
    });
  }

  if (sessions.length === 0) return { found: false, sessions: [] };

  // Derive start/end dates from the schedule
  const first = sessions[0];
  const last = sessions[sessions.length - 1];

  return {
    found: true,
    sessions,
    startDate: first.date,
    endDate: last.date,
  };
}

async function fetchTesting(season) {
  const blocks = [];

  for (const slug of TESTING_SLUGS) {
    const pageUrl = `https://www.formula1.com/en/racing/${season}/${slug}`;
    try {
      const html = await fetchText(pageUrl);
      const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : slug;

      const sched = parseTestingScheduleFromPage(html, season);

      // Track map for testing
      const trackMap = await fetchTrackMapFromF1Page({
        pageUrl,
        season,
        outFileBase: `f1_${season}_${slug}_detailed`,
      });

      blocks.push({
        type: "TESTING",
        slug,
        title,
        pageUrl,
        schedule: sched.found ? sched.sessions : [],
        startDate: sched.found ? sched.startDate : null,
        endDate: sched.found ? sched.endDate : null,
        trackMap,
      });
    } catch {
      // page doesn't exist for this slug; ignore
    }
  }

  // Determine next testing block by startDate
  const now = new Date();
  const upcoming = blocks
    .filter((b) => b.startDate)
    .map((b) => ({ ...b, start: new Date(`${b.startDate}T00:00:00Z`) }))
    .filter((b) => b.start > now)
    .sort((a, b) => a.start - b.start);

  return {
    found: blocks.length > 0,
    all: blocks,
    next: upcoming[0] || null,
    note: blocks.length ? null : "No testing pages found for this season.",
  };
}

// ---------------------- main ----------------------
async function updateNextRace() {
  const now = new Date();

  // Race weekend sessions from ICS
  const ics = await ical.async.fromURL(ICS_URL, { headers: { "User-Agent": UA } });
  const events = Object.values(ics).filter((x) => x?.type === "VEVENT");

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

  // Group all sessions for that GP
  const gpSessions = sessions.filter((s) => s.gpName === gpName).sort((a, b) => a.start - b.start);
  const weekendStart = gpSessions[0].start;
  const weekendEnd = gpSessions[gpSessions.length - 1].end;

  // Extract location tokens (this prevents “Qatar” sponsor matching)
  const { city, country } = splitLocation(nextRace.location);

  // Fetch testing from dedicated pages
  const testing = await fetchTesting(season);

  // Resolve correct F1 race page using location-first scoring
  const racePage = await resolveF1RacePage({ season, gpName, city, country });

  // Download correct race detailed map (Australia should resolve to /australia if location includes Australia)
  const raceTrackMap = racePage.found
    ? await fetchTrackMapFromF1Page({
        pageUrl: racePage.url,
        season,
        outFileBase: `f1_${season}_${racePage.slug}_detailed`,
      })
    : { found: false, pageUrl: null, mediaUrl: null, pngUrl: null, note: racePage.note || "No race page resolved" };

  // Decide nextEvent
  const nextTestingStart = testing?.next?.startDate ? new Date(`${testing.next.startDate}T00:00:00Z`) : null;

  let nextEvent = {
    type: "RACE_WEEKEND",
    name: gpName,
    startUtc: weekendStart.toISOString(),
    startLocalDateShort: shortDateInTZ(weekendStart),
    startLocalTimeShort: shortTimeInTZ(weekendStart),
    startsInDays: daysUntil(weekendStart, now),
  };

  if (nextTestingStart && nextTestingStart < weekendStart) {
    nextEvent = {
      type: "TESTING",
      name: testing.next.title,
      slug: testing.next.slug,
      startDate: testing.next.startDate,
      endDate: testing.next.endDate,
      startsInDays: daysUntil(nextTestingStart, now),
    };
  }

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
    header: "Next F1 event",
    generatedAtUtc: now.toISOString(),
    displayTimeZone: USER_TZ,
    source: { kind: "ics", url: ICS_URL },

    nextEvent,

    testing: {
      found: testing.found,
      next: testing.next,
      all: testing.all,
      note: testing.note,
    },

    grandPrix: {
      name: gpName,
      location: nextRace.location,
      city,
      country,
      season,
      f1RacePageUrl: racePage.found ? racePage.url : null,
      f1RacePageSource: racePage.source,
      racePageDebugTop: racePage.debugTop || null,
    },

    trackMap: raceTrackMap,

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
      "Testing comes from dedicated formula1.com testing pages (more reliable than scraping the season grid). Race page is resolved using location-first matching to avoid sponsor words like 'Qatar Airways' causing a wrong slug.",
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote f1_next_race.json season=${season} gp=${gpName} testingFound=${testing.found}`);
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});