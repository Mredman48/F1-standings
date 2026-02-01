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

// ---------------------- time + formatting helpers ----------------------
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

// ---------------------- networking helpers ----------------------
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

// ---------------------- session helpers (ICS) ----------------------
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

// ---------------------- F1 detailed track map (scrape from page) ----------------------
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
  const html = await fetchText(pageUrl);
  const mediaUrl = extractDetailedTrackMediaUrl(html, season);
  if (!mediaUrl) {
    return { found: false, pageUrl, mediaUrl: null, pngUrl: null, note: "No detailed track image found on page." };
  }
  const outName = `${outFileBase}.png`;
  const pngUrl = await downloadToPng({ mediaUrl, outName });
  return { found: true, pageUrl, mediaUrl, pngUrl, note: null };
}

// ---------------------- resolve correct race page (location-first) ----------------------
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
  for (const t of cTokens) if (h.includes(t)) score += 6;
  for (const t of cityTokens) if (h.includes(t)) score += 10;
  return score;
}

function scoreHrefByGpName(href, gpName) {
  const stop = new Set(["formula", "qatar", "airways", "aramco", "heineken", "pirelli"]);
  const h = href.toLowerCase();
  const gpTokens = tokensFrom(gpName).filter((t) => !stop.has(t));
  let score = 0;
  for (const t of gpTokens) if (h.includes(t)) score += 1;
  return score;
}

async function resolveF1RacePage({ season, gpName, city, country }) {
  const seasonUrl = `https://www.formula1.com/en/racing/${season}`;
  const html = await fetchText(seasonUrl);

  const hrefs = Array.from(html.matchAll(new RegExp(`/en/racing/${season}/[a-z0-9-]+`, "g")))
    .map((m) => m[0])
    .filter(Boolean);

  const uniq = [...new Set(hrefs)];
  if (uniq.length === 0) {
    return { found: false, url: null, slug: null, source: "season-scan", note: "No race links found" };
  }

  const scored = uniq
    .map((href) => {
      const sLoc = scoreHrefByLocation(href, city, country);
      const sName = scoreHrefByGpName(href, gpName);
      return { href, score: sLoc * 100 + sName };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const fullUrl = `https://www.formula1.com${best.href}`;
  const slug = best.href.split(`/en/racing/${season}/`)[1];
  return { found: true, url: fullUrl, slug, source: "season-scan-location-first", debugTop: scored.slice(0, 5) };
}

// ---------------------- testing from dedicated pages ----------------------
const TESTING_SLUGS = ["pre-season-testing-1", "pre-season-testing-2", "pre-season-testing-3"];

function parseTestingScheduleFromPage(html, season) {
  // Matches: "11 Feb Day 1 07:00 - 16:00"
  const flat = html.replace(/\s+/g, " ");
  const re = /(\d{1,2})\s+([A-Za-z]{3})\s+Day\s+(\d)\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/g;

  const days = [];
  for (const m of flat.matchAll(re)) {
    const dayOfMonth = Number(m[1]);
    const mon = m[2];
    const dayNo = Number(m[3]);
    const startHHMM = m[4];
    const endHHMM = m[5];

    const mi = monthIndex(mon);
    if (mi == null || !Number.isFinite(dayOfMonth) || !Number.isFinite(dayNo)) continue;

    const dateISO = new Date(Date.UTC(Number(season), mi, dayOfMonth, 0, 0, 0)).toISOString().slice(0, 10);

    days.push({
      dayNo,
      date: dateISO,
      startTime: startHHMM,
      endTime: endHHMM,
    });
  }

  days.sort((a, b) => a.dayNo - b.dayNo);
  return days;
}

async function fetchTesting(season) {
  const blocks = [];

  for (const slug of TESTING_SLUGS) {
    const pageUrl = `https://www.formula1.com/en/racing/${season}/${slug}`;
    try {
      const html = await fetchText(pageUrl);

      const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : slug;

      const days = parseTestingScheduleFromPage(html, season);

      const trackMap = await fetchTrackMapFromF1Page({
        pageUrl,
        season,
        outFileBase: `f1_${season}_${slug}_detailed`,
      });

      const startDate = days[0]?.date ?? null;
      const endDate = days[days.length - 1]?.date ?? null;

      blocks.push({
        kind: "TESTING",
        slug,
        title,
        pageUrl,
        days,
        startDate,
        endDate,
        trackMap,
      });
    } catch {
      // ignore missing pages
    }
  }

  const now = new Date();
  const upcoming = blocks
    .filter((b) => b.startDate)
    .map((b) => ({ ...b, start: new Date(`${b.startDate}T00:00:00Z`) }))
    .filter((b) => b.start > now)
    .sort((a, b) => a.start - b.start);

  return { found: blocks.length > 0, all: blocks, next: upcoming[0] || null };
}

// ---------------------- unified nextEvent builders ----------------------
function buildSessionsForRaceWeekend(gpSessions) {
  const sessionOrder = ["FP1", "FP2", "FP3", "Qualifying", "Sprint Qualifying", "Sprint", "Race"];

  return sessionOrder
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

function buildSessionsForTesting(testBlock) {
  // Map Day 1/2/3 -> FP1/FP2/FP3 so Widgy can keep the same bindings
  const map = { 1: "FP1", 2: "FP2", 3: "FP3" };

  return (testBlock?.days || [])
    .filter((d) => d?.dayNo && d?.date)
    .map((d) => {
      const type = map[d.dayNo] || `Day ${d.dayNo}`;
      const dateObj = new Date(`${d.date}T00:00:00Z`);
      return {
        type,
        // No authoritative UTC time for testing on the page; keep as strings + date anchor
        startUtc: `${d.date}T00:00:00.000Z`,
        endUtc: `${d.date}T23:59:59.000Z`,
        startLocalDateShort: shortDateInTZ(dateObj),
        // show the published window as text (Widgy-friendly)
        startLocalTimeShort: d.startTime,
        endLocalTimeShort: d.endTime,
        timeWindowLabel: `${d.startTime} - ${d.endTime}`,
        startLocalDateTimeShort: `${shortDateInTZ(dateObj)} ${d.startTime}`,
      };
    });
}

function computeWeekendWindowFromSessions(sessions) {
  if (!sessions || sessions.length === 0) return { startUtc: null, endUtc: null };
  const starts = sessions.map((s) => new Date(s.startUtc)).filter((d) => !isNaN(d));
  const ends = sessions.map((s) => new Date(s.endUtc)).filter((d) => !isNaN(d));
  const startUtc = starts.length ? new Date(Math.min(...starts)).toISOString() : null;
  const endUtc = ends.length ? new Date(Math.max(...ends)).toISOString() : null;
  return { startUtc, endUtc };
}

// ---------------------- main ----------------------
async function updateNextRace() {
  const now = new Date();

  // Race weekend sessions from ICS
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

  const gpName = nextRaceSession.gpName;
  const season = String(nextRaceSession.start.getUTCFullYear());

  const { city, country } = splitLocation(nextRaceSession.location);

  // Group all sessions for that GP
  const gpSessions = allSessions.filter((s) => s.gpName === gpName).sort((a, b) => a.start - b.start);
  const raceWeekendStart = gpSessions[0].start;

  // Fetch testing
  const testing = await fetchTesting(season);

  // Resolve race page for correct track map
  const racePage = await resolveF1RacePage({ season, gpName, city, country });
  const raceTrackMap = racePage.found
    ? await fetchTrackMapFromF1Page({
        pageUrl: racePage.url,
        season,
        outFileBase: `f1_${season}_${racePage.slug}_detailed`,
      })
    : { found: false, pageUrl: null, mediaUrl: null, pngUrl: null, note: racePage.note || "No race page resolved" };

  // Build unified nextEvent candidate: race weekend
  const raceSessionsOut = buildSessionsForRaceWeekend(gpSessions);
  const raceWindow = computeWeekendWindowFromSessions(raceSessionsOut);

  const raceNextEvent = {
    type: "RACE_WEEKEND",
    title: gpName,
    season,
    location: {
      raw: nextRaceSession.location || null,
      city,
      country,
    },
    trackMap: raceTrackMap,
    countdowns: {
      startsInDays: daysUntil(raceWeekendStart, now),
    },
    weekend: {
      startUtc: raceWindow.startUtc,
      endUtc: raceWindow.endUtc,
    },
    sessions: raceSessionsOut,
  };

  // Build unified nextEvent candidate: testing (if available)
  let testingNextEvent = null;
  if (testing?.next?.startDate) {
    const testStart = new Date(`${testing.next.startDate}T00:00:00Z`);
    const testSessionsOut = buildSessionsForTesting(testing.next);
    const testWindow = computeWeekendWindowFromSessions(testSessionsOut);

    testingNextEvent = {
      type: "TESTING",
      title: testing.next.title,
      season,
      location: {
        raw: "Testing",
        city: null,
        country: null,
      },
      trackMap: testing.next.trackMap || null,
      countdowns: {
        startsInDays: daysUntil(testStart, now),
      },
      weekend: {
        startUtc: testWindow.startUtc,
        endUtc: testWindow.endUtc,
      },
      sessions: testSessionsOut,
    };
  }

  // Choose which one is next based on start time
  let nextEvent = raceNextEvent;
  if (testingNextEvent) {
    const testStart = new Date(testingNextEvent.weekend.startUtc);
    if (!isNaN(testStart) && testStart < raceWeekendStart) {
      nextEvent = testingNextEvent;
    }
  }

  // Output: single nextEvent only (no separate testing section)
  const out = {
    header: "Next F1 event",
    generatedAtUtc: now.toISOString(),
    displayTimeZone: USER_TZ,
    source: { kind: "ics", url: ICS_URL },
    nextEvent
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote f1_next_race.json season=${season} nextEvent=${nextEvent.type}`);
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});