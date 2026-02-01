// updateNextRace.js
import fs from "node:fs/promises";
import path from "node:path";
import ical from "node-ical";
import sharp from "sharp";

/**
 * Inputs
 */
const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";

/**
 * Display formatting (Widgy-friendly)
 */
const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA";

/**
 * GitHub Pages base for your repo
 * (must match your repo + Pages settings)
 */
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

/**
 * Where track PNGs are written (commit this folder)
 */
const TRACKMAP_DIR = "trackmaps";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

/**
 * Testing pages (official F1)
 * - 2026 has at least pre-season-testing-1 (Bahrain Test 1)  [oai_citation:4‡Formula 1® - The Official F1® Website](https://www.formula1.com/en/racing/2026/pre-season-testing-1?utm_source=chatgpt.com)
 * - pre-season-testing-2 often exists (Bahrain Test 2)
 * - Barcelona private test may not have a page; fallback to season schedule range parsing  [oai_citation:5‡Formula 1® - The Official F1® Website](https://www.formula1.com/en/latest/article/formula-1-confirms-2026-pre-season-testing-dates-and-issues-calendar-update.5VKfdqe7JcdsCJcEnQE0xw?utm_source=chatgpt.com)
 */
const TESTING_SLUGS = [
  "pre-season-testing-1",
  "pre-season-testing-2",
  "pre-season-testing-3",
];

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
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
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

/* -------------------- ICS session parsing -------------------- */

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

/* -------------------- F1 detailed track image -------------------- */

function extractDetailedTrackMediaUrl(html, season) {
  // Example:
  // https://media.formula1.com/image/upload/.../common/f1/2026/track/2026trackmelbournedetailed.webp
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
  // Keep this weak to avoid sponsor words dominating
  const stop = new Set(["formula", "qatar", "airways", "aramco", "heineken", "pirelli", "crypto", "msc"]);
  const h = href.toLowerCase();
  const gpTokens = tokensFrom(gpName).filter((t) => !stop.has(t));
  let score = 0;
  for (const t of gpTokens) if (h.includes(t)) score += 1;
  return score;
}

async function resolveF1RacePage({ season, gpName, city, country }) {
  const seasonUrl = `https://www.formula1.com/en/racing/${season}`;
  const html = await fetchText(seasonUrl); // season grid contains sponsor-heavy names  [oai_citation:6‡Formula 1® - The Official F1® Website](https://www.formula1.com/en/racing/2026?utm_source=chatgpt.com)

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

  return {
    found: true,
    url: fullUrl,
    slug,
    source: "season-scan-location-first",
    debugTop: scored.slice(0, 5),
  };
}

/* -------------------- Testing parsing -------------------- */

function parseTestingDayRows(html, season) {
  // The testing page schedule has rows like: "11 Feb Day 1 07:00 - 16:00"  [oai_citation:7‡Formula 1® - The Official F1® Website](https://www.formula1.com/en/racing/2026/pre-season-testing-1?utm_source=chatgpt.com)
  // Dash can be hyphen / en-dash / em-dash
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

    const dateISO = new Date(Date.UTC(Number(season), mi, dayOfMonth, 0, 0, 0))
      .toISOString()
      .slice(0, 10);

    days.push({ dayNo, date: dateISO, startTime: startHHMM, endTime: endHHMM });
  }

  days.sort((a, b) => a.dayNo - b.dayNo);
  return days;
}

function parseTestingDateRangeFromSeasonGrid(html, season, testNumber) {
  // Season page contains entries like:
  // "FORMULA 1 ARAMCO PRE-SEASON TESTING 1 2026 11 - 13 Feb"  [oai_citation:8‡Formula 1® - The Official F1® Website](https://www.formula1.com/en/racing/2026?utm_source=chatgpt.com)
  const flat = html.replace(/\s+/g, " ");
  const dash = "[-–—]";

  const re = new RegExp(
    `PRE-SEASON TESTING\\s+${testNumber}\\s+${season}\\s+(\\d{1,2})\\s*${dash}\\s*(\\d{1,2})\\s+([A-Za-z]{3})`,
    "i"
  );

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
  // Convert range start into sequential days; aim for 3+ days
  const start = new Date(`${range.startDate}T00:00:00Z`);
  const startMs = start.getTime();

  // Estimate length from end-start inclusive
  const end = new Date(`${range.endDate}T00:00:00Z`);
  const daysCount = Math.max(1, Math.round((end.getTime() - startMs) / 86400000) + 1);

  const out = [];
  for (let i = 0; i < daysCount; i++) {
    const d = new Date(startMs + i * 86400000).toISOString().slice(0, 10);
    out.push({ dayNo: i + 1, date: d, startTime: null, endTime: null });
  }
  return out;
}

async function fetchTestingBlocks(season) {
  const blocks = [];

  // 1) Try dedicated testing pages
  for (const slug of TESTING_SLUGS) {
    const pageUrl = `https://www.formula1.com/en/racing/${season}/${slug}`;
    try {
      const html = await fetchText(pageUrl);

      const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : slug;

      let days = parseTestingDayRows(html, season);

      const testNoMatch = slug.match(/testing-(\d)$/);
      const testNumber = testNoMatch ? Number(testNoMatch[1]) : null;

      // If schedule rows fail, fallback to season grid date range for that testing block
      if ((!days || days.length === 0) && testNumber) {
        const seasonHtml = await fetchText(`https://www.formula1.com/en/racing/${season}`);
        const range = parseTestingDateRangeFromSeasonGrid(seasonHtml, season, testNumber);
        if (range) days = synthesizeTestingDaysFromRange(range);
      }

      const trackMap = await fetchTrackMapFromF1Page({
        pageUrl,
        season,
        outFileBase: `f1_${season}_${slug}_detailed`,
      });

      const startDate = days?.[0]?.date ?? null;
      const endDate = days?.[days.length - 1]?.date ?? null;

      blocks.push({
        kind: "TESTING",
        slug,
        title,
        pageUrl,
        startDate,
        endDate,
        days: days || [],
        trackMap,
      });
    } catch {
      // page doesn't exist; ignore
    }
  }

  // 2) If no blocks found from pages, fall back to season grid for testing date ranges (minimal, but reliable)
  if (blocks.length === 0) {
    const seasonHtml = await fetchText(`https://www.formula1.com/en/racing/${season}`); //  [oai_citation:9‡Formula 1® - The Official F1® Website](https://www.formula1.com/en/racing/2026?utm_source=chatgpt.com)
    for (const n of [1, 2, 3]) {
      const range = parseTestingDateRangeFromSeasonGrid(seasonHtml, season, n);
      if (!range) continue;

      const days = synthesizeTestingDaysFromRange(range);
      blocks.push({
        kind: "TESTING",
        slug: `pre-season-testing-${n}`,
        title: `Pre-season testing ${n}`,
        pageUrl: null,
        startDate: range.startDate,
        endDate: range.endDate,
        days,
        trackMap: { found: false, pageUrl: null, mediaUrl: null, pngUrl: null, note: "No testing page; no map." },
      });
    }
  }

  // choose next upcoming testing by startDate
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
  };
}

/* -------------------- Unified nextEvent builders -------------------- */

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
  // Label "like a weekend":
  // Day 1..3 => FP1/FP2/FP3
  // Day 4 => Qualifying
  // Day 5 => Race
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
        // anchor UTC day window for countdown math & consistent structure
        startUtc: `${d.date}T00:00:00.000Z`,
        endUtc: `${d.date}T23:59:59.000Z`,
        startLocalDateShort: shortDateInTZ(dateObj),
        // show the official time window (string) when available
        startLocalTimeShort: hasTimes ? d.startTime : null,
        endLocalTimeShort: hasTimes ? d.endTime : null,
        timeWindowLabel: hasTimes ? `${d.startTime} - ${d.endTime}` : null,
        startLocalDateTimeShort: hasTimes
          ? `${shortDateInTZ(dateObj)} ${d.startTime}`
          : `${shortDateInTZ(dateObj)}`,
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

  // --- Parse race weekend sessions from ICS ---
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

  // Race weekend grouping
  const gpSessions = allSessions.filter((s) => s.gpName === gpName).sort((a, b) => a.start - b.start);
  const raceWeekendStart = gpSessions[0].start;

  const { city, country } = splitLocation(nextRaceSession.location);

  // Resolve correct race page (location-first prevents sponsor words from choosing Qatar, etc.)  [oai_citation:10‡Formula 1® - The Official F1® Website](https://www.formula1.com/en/racing/2026?utm_source=chatgpt.com)
  const racePage = await resolveF1RacePage({ season, gpName, city, country });

  // Race track map (detailed)
  const raceTrackMap = racePage.found
    ? await fetchTrackMapFromF1Page({
        pageUrl: racePage.url,
        season,
        outFileBase: `f1_${season}_${racePage.slug}_detailed`,
      })
    : { found: false, pageUrl: null, mediaUrl: null, pngUrl: null, note: racePage.note || "No race page resolved" };

  // Build RACE_WEEKEND candidate event
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
    countdowns: {
      startsInDays: daysUntil(raceWeekendStart, now),
    },
    weekend: {
      startUtc: raceWindow.startUtc,
      endUtc: raceWindow.endUtc,
    },
    sessions: raceSessionsOut,
  };

  // --- Testing candidate event(s) ---
  const testing = await fetchTestingBlocks(season);

  let testingEvent = null;
  if (testing?.next?.startDate) {
    const testStart = new Date(`${testing.next.startDate}T00:00:00Z`);
    const testSessionsOut = buildSessionsForTesting(testing.next);
    const testWindow = computeWindowFromSessions(testSessionsOut);

    // If testing map not found, try a pragmatic fallback based on common venues:
    // - Bahrain testing => Bahrain GP page usually shares the same circuit map
    // - Barcelona private test => Barcelona-Catalunya page map
    let testTrackMap = testing.next.trackMap;
    const titleLower = (testing.next.title || "").toLowerCase();

    if (!testTrackMap?.found) {
      if (titleLower.includes("bahrain")) {
        const bahrainFallback = await fetchTrackMapFromF1Page({
          pageUrl: `https://www.formula1.com/en/racing/${season}/bahrain`,
          season,
          outFileBase: `f1_${season}_bahrain_detailed`,
        });
        if (bahrainFallback.found) testTrackMap = bahrainFallback;
      } else if (titleLower.includes("barcelona") || titleLower.includes("catalunya")) {
        const barcaFallback = await fetchTrackMapFromF1Page({
          pageUrl: `https://www.formula1.com/en/racing/${season}/barcelona-catalunya`,
          season,
          outFileBase: `f1_${season}_barcelona-catalunya_detailed`,
        });
        if (barcaFallback.found) testTrackMap = barcaFallback;
      }
    }

    testingEvent = {
      type: "TESTING",
      title: testing.next.title,
      season,
      location: {
        raw: "Testing",
        city: null,
        country: null,
      },
      trackMap: testTrackMap || null,
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

  // --- Choose which event is next (single unified nextEvent) ---
  let nextEvent = raceEvent;

  if (testingEvent?.weekend?.startUtc) {
    const testStart = new Date(testingEvent.weekend.startUtc);
    if (!isNaN(testStart) && testStart < raceWeekendStart) {
      nextEvent = testingEvent;
    }
  }

  // Final output: ONE nextEvent only
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