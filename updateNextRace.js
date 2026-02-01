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

function splitLocation(location) {
  if (!location || typeof location !== "string") return { city: null, country: null };
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { city: null, country: null };
  if (parts.length === 1) return { city: parts[0] || null, country: null };
  return { city: parts[0] || null, country: parts[parts.length - 1] || null };
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

/* -------------------- Race page resolution (location-first) -------------------- */

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
  const stop = new Set(["formula", "qatar", "airways", "aramco", "heineken", "pirelli", "crypto", "msc"]);
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
  if (uniq.length === 0) return { found: false, url: null, slug: null, source: "season-scan", note: "No race links found" };

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

/* -------------------- Testing parsing -------------------- */

function parseTestingDayRows(html, season) {
  // Matches: "11 Feb Day 1 07:00 - 16:00" (dash can be - / – / —)
  const flat = html.replace(/\s+/g, " ");
  const dash = "[-–—]";
  const re = new RegExp(
    `(\\d{1,2})\\s+([A-Za-z]{3})\\s+Day\\s+(\\d)\\s+(\\d{2}:\\d{2})\\s*${dash}\\s*(\\d{2}:\\d{2})`,
    "g"
  );

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
    days.push({ dayNo, date: dateISO, startTime: startHHMM, endTime: endHHMM });
  }

  days.sort((a, b) => a.dayNo - b.dayNo);
  return days;
}

function parseTestingDateRangeFromSeasonGrid(html, season, testNumber) {
  // Finds: "PRE-SEASON TESTING {n} {season} 11 - 13 Feb"
  const flat = html.replace(/\s+/g, " ");
  const dash = "[-–—]";
  const re = new RegExp(`PRE-SEASON TESTING\\s+${testNumber}\\s+${season}\\s+(\\d{1,2})\\s*${dash}\\s*(\\d{1,2})\\s+([A-Za-z]{3})`, "i");
  const m = flat.match(re);
  if (!m) return null;

  const startDay = Number(m[1]);
  const endDay = Number(m[2]);
  const mon = m[3];

  const mi = monthIndex(mon);
  if (mi == null || !Number.isFinite(startDay) || !Number.isFinite(endDay)) return null;

  const startDate = new Date(Date.UTC(Number(season), mi, startDay, 0, 0, 0)).toISOString().slice(0, 10);
  const endDate = new Date(Date.UTC(Number(season), mi, endDay, 0, 0, 0)).toISOString().slice(0, 10);
  return { startDate, endDate };
}

function synthesizeTestingDaysFromRange(range) {
  const start = new Date(`${range.startDate}T00:00:00Z`);
  const end = new Date(`${range.endDate}T00:00:00Z`);
  const daysCount = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);

  const out = [];
  for (let i = 0; i < daysCount; i++) {
    const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    out.push({ dayNo: i + 1, date: d, startTime: null, endTime: null });
  }
  return out;
}

async function fetchTestingBlocks(season) {
  const blocks = [];

  // Grab season grid once (for robust fallback)
  let seasonHtml = null;
  async function getSeasonHtml() {
    if (!seasonHtml) seasonHtml = await fetchText(`https://www.formula1.com/en/racing/${season}`);
    return seasonHtml;
  }

  for (const slug of TESTING_SLUGS) {
    const pageUrl = `https://www.formula1.com/en/racing/${season}/${slug}`;
    const mm = slug.match(/testing-(\d)$/);
    const testNumber = mm ? Number(mm[1]) : null;

    try {
      const html = await fetchText(pageUrl);

      const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : slug;

      // 1) Try schedule rows
      let days = parseTestingDayRows(html, season);

      // 2) Fallback to season grid range
      if ((!days || days.length === 0) && testNumber) {
        const grid = await getSeasonHtml();
        const range = parseTestingDateRangeFromSeasonGrid(grid, season, testNumber);
        if (range) days = synthesizeTestingDaysFromRange(range);
      }

      // 3) If still no days, skip (can't compute startDate)
      if (!days || days.length === 0) continue;

      const trackMap = await fetchTrackMapFromF1Page({
        pageUrl,
        season,
        outFileBase: `f1_${season}_${slug}_detailed`,
      });

      blocks.push({
        kind: "TESTING",
        slug,
        title,
        pageUrl,
        startDate: days[0].date,
        endDate: days[days.length - 1].date,
        days,
        trackMap,
      });
    } catch {
      // If testing page doesn't exist, still try season grid fallback
      if (testNumber) {
        const grid = await getSeasonHtml();
        const range = parseTestingDateRangeFromSeasonGrid(grid, season, testNumber);
        if (!range) continue;

        const days = synthesizeTestingDaysFromRange(range);
        blocks.push({
          kind: "TESTING",
          slug,
          title: `Pre-season testing ${testNumber}`,
          pageUrl: null,
          startDate: days[0].date,
          endDate: days[days.length - 1].date,
          days,
          trackMap: { found: false, pageUrl: null, mediaUrl: null, pngUrl: null, note: "No testing page; no map." },
        });
      }
    }
  }

  const now = new Date();
  const upcoming = blocks
    .map((b) => ({ ...b, start: new Date(`${b.startDate}T00:00:00Z`) }))
    .filter((b) => b.start > now)
    .sort((a, b) => a.start - b.start);

  return { found: blocks.length > 0, all: blocks, next: upcoming[0] || null };
}

/* -------------------- Unified event builders -------------------- */

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

function buildSessionsForTesting(testBlock) {
  // Make testing look like a weekend:
  // Day 1..3 -> FP1/FP2/FP3
  // Day 4 -> Qualifying
  // Day 5 -> Race
  const labelByDay = ["FP1", "FP2", "FP3", "Qualifying", "Race"];

  return (testBlock?.days || [])
    .filter((d) => d?.dayNo && d?.date)
    .map((d) => {
      const idx = Math.max(1, Math.min(d.dayNo, labelByDay.length)) - 1;
      const type = labelByDay[idx] || `Day ${d.dayNo}`;

      const dateObj = new Date(`${d.date}T00:00:00Z`);
      const hasTimes = !!(d.startTime && d.endTime);

      return {
        type,
        // anchored UTC window for consistent structure + countdown math
        startUtc: `${d.date}T00:00:00.000Z`,
        endUtc: `${d.date}T23:59:59.000Z`,
        startLocalDateShort: shortDateInTZ(dateObj),
        startLocalTimeShort: hasTimes ? d.startTime : null,
        endLocalTimeShort: hasTimes ? d.endTime : null,
        timeWindowLabel: hasTimes ? `${d.startTime} - ${d.endTime}` : null,
        startLocalDateTimeShort: hasTimes ? `${shortDateInTZ(dateObj)} ${d.startTime}` : `${shortDateInTZ(dateObj)}`,
      };
    });
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

  // ---- Race weekend sessions from ICS
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
  const raceWeekendStart = gpSessions[0].start;

  const { city, country } = splitLocation(nextRaceSession.location);

  // Resolve correct race page for map (location-first avoids sponsor word mismatches)
  const racePage = await resolveF1RacePage({ season, gpName, city, country });

  const raceTrackMap = racePage.found
    ? await fetchTrackMapFromF1Page({
        pageUrl: racePage.url,
        season,
        outFileBase: `f1_${season}_${racePage.slug}_detailed`,
      })
    : { found: false, pageUrl: null, mediaUrl: null, pngUrl: null, note: racePage.note || "No race page resolved" };

  // Build race event candidate
  const raceSessionsOut = buildSessionsForRaceWeekend(gpSessions);
  const raceWindow = computeWindowFromSessions(raceSessionsOut);

  const raceEvent = {
    type: "RACE_WEEKEND",
    title: gpName,
    season,
    location: {
      raw: nextRaceSession.location || null,
      city,
      country,
    },
    trackMap: raceTrackMap,
    countdowns: { startsInDays: daysUntil(raceWeekendStart, now) },
    weekend: { startUtc: raceWindow.startUtc, endUtc: raceWindow.endUtc },
    sessions: raceSessionsOut,
  };

  // Testing candidate
  const testing = await fetchTestingBlocks(season);

  let testingEvent = null;
  if (testing?.next?.startDate) {
    const testStart = new Date(`${testing.next.startDate}T00:00:00Z`);
    const testSessionsOut = buildSessionsForTesting(testing.next);
    const testWindow = computeWindowFromSessions(testSessionsOut);

    testingEvent = {
      type: "TESTING",
      title: testing.next.title,
      season,
      location: { raw: "Testing", city: null, country: null },
      trackMap: testing.next.trackMap || null,
      countdowns: { startsInDays: daysUntil(testStart, now) },
      weekend: { startUtc: testWindow.startUtc, endUtc: testWindow.endUtc },
      sessions: testSessionsOut,
    };
  }

  // Choose nextEvent (single unified event)
  let nextEvent = raceEvent;
  if (testingEvent?.weekend?.startUtc) {
    const testStart = new Date(testingEvent.weekend.startUtc);
    if (!isNaN(testStart) && testStart < raceWeekendStart) nextEvent = testingEvent;
  }

  // Debug (helps you confirm in Actions logs)
  console.log("Testing next:", testing?.next?.title, testing?.next?.startDate, testing?.next?.endDate);
  console.log("Race weekend start:", raceWeekendStart.toISOString());
  console.log("Chosen nextEvent:", nextEvent.type, nextEvent.title);

  // Output: only nextEvent (Widgy bindings never change)
  const out = {
    header: "Next F1 event",
    generatedAtUtc: now.toISOString(),
    displayTimeZone: USER_TZ,
    source: { kind: "ics", url: ICS_URL },
    nextEvent,
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote f1_next_race.json season=${season} nextEvent=${nextEvent.type}`);
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});