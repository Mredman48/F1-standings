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

// ---------------------- date helpers ----------------------
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

function monthIndexFromShort(mon) {
  const m = (mon || "").toLowerCase();
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

// ---------------------- calendar helpers ----------------------
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

// ---------------------- networking ----------------------
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

// ---------------------- F1 detailed track image extraction ----------------------
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

async function downloadWebpToPng({ mediaUrl, outName }) {
  await ensureDir(TRACKMAP_DIR);
  const inputBuf = await fetchBuffer(mediaUrl);
  const outPath = path.join(TRACKMAP_DIR, outName);
  const pngBuf = await sharp(inputBuf).png().toBuffer();
  await fs.writeFile(outPath, pngBuf);
  return makeTrackPngUrl(outName);
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

  // Fallback: scan season page for race links
  const seasonUrl = `https://www.formula1.com/en/racing/${season}.html`;
  const html = await fetchText(seasonUrl);

  const hrefs = Array.from(html.matchAll(new RegExp(`/en/racing/${season}/[a-z0-9-]+`, "g")))
    .map((m) => m[0])
    .filter(Boolean);

  const uniq = [...new Set(hrefs)];
  if (uniq.length === 0) throw new Error(`No race links found on ${seasonUrl}`);

  const best = uniq
    .map((href) => ({ href, score: scoreHref(href, gpName) }))
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.score === 0) throw new Error(`Could not match gpName="${gpName}" to a race link.`);

  const fullUrl = `https://www.formula1.com${best.href}`;
  const slug = best.href.split(`/en/racing/${season}/`)[1];
  return { slug, url: fullUrl, source: "season-page-scan" };
}

async function fetchTrackMapFromPage({ pageUrl, season, outFileBase }) {
  const html = await fetchText(pageUrl);
  const mediaUrl = extractDetailedTrackMediaUrl(html, season);
  if (!mediaUrl) {
    return {
      found: false,
      pageUrl,
      mediaUrl: null,
      pngUrl: null,
      note: "No .../track/...detailed.(webp|png) found on this page.",
    };
  }
  const outName = `${outFileBase}.png`;
  const pngUrl = await downloadWebpToPng({ mediaUrl, outName });
  return { found: true, pageUrl, mediaUrl, pngUrl, note: null };
}

// ---------------------- Testing: parse from F1 season page + use testing pages ----------------------
function extractTestingBlocksFromSeasonPage(html, season) {
  // The season page includes lines like:
  // "TESTING ... Bahrain ... PRE-SEASON TESTING 1 2026 11 - 13 Feb"
  // We'll use a looser regex that doesn't depend on UI tokens.
  const flat = html.replace(/\s+/g, " ");

  const re = new RegExp(
    `(TESTING)\\s+.*?\\b([A-Za-z][A-Za-z’'\\- ]+?)\\b\\s+(FORMULA 1 .*? PRE-SEASON TESTING\\s+([0-9])\\s+${season})\\s+([0-9]{2})\\s*-\\s*([0-9]{2})\\s+([A-Za-z]{3})`,
    "g"
  );

  const blocks = [];
  for (const m of flat.matchAll(re)) {
    const location = (m[2] || "").trim();
    const title = (m[3] || "").trim();
    const testNo = Number(m[4]);
    const startDay = Number(m[5]);
    const endDay = Number(m[6]);
    const mon = (m[7] || "").trim();

    const monthIdx = monthIndexFromShort(mon);
    const startUtc =
      monthIdx != null && Number.isFinite(startDay)
        ? new Date(Date.UTC(Number(season), monthIdx, startDay, 0, 0, 0)).toISOString()
        : null;
    const endUtc =
      monthIdx != null && Number.isFinite(endDay)
        ? new Date(Date.UTC(Number(season), monthIdx, endDay, 23, 59, 59)).toISOString()
        : null;

    // F1 testing pages use slugs:
    // /en/racing/2026/pre-season-testing-1
    // /en/racing/2026/pre-season-testing-2
    const slug = Number.isFinite(testNo) ? `pre-season-testing-${testNo}` : null;
    const pageUrl = slug ? `https://www.formula1.com/en/racing/${season}/${slug}` : null;

    blocks.push({
      type: "TESTING",
      title,
      location,
      testNumber: Number.isFinite(testNo) ? testNo : null,
      startUtc,
      endUtc,
      startDateLabel: startUtc ? shortDateInTZ(new Date(startUtc)) : null,
      endDateLabel: endUtc ? shortDateInTZ(new Date(endUtc)) : null,
      pageUrl,
    });
  }

  // de-dupe
  const uniq = [];
  const seen = new Set();
  for (const b of blocks) {
    const key = `${b.title}|${b.startUtc}|${b.endUtc}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniq.push(b);
    }
  }
  return uniq;
}

async function fetchTesting(season) {
  const seasonUrl = `https://www.formula1.com/en/racing/${season}`;
  const html = await fetchText(seasonUrl);

  const blocks = extractTestingBlocksFromSeasonPage(html, season);

  const now = new Date();
  const upcoming = blocks
    .filter((b) => b.startUtc && new Date(b.startUtc) > now)
    .sort((a, b) => new Date(a.startUtc) - new Date(b.startUtc));

  return {
    found: blocks.length > 0,
    sourceUrl: seasonUrl,
    all: blocks,
    next: upcoming[0] || null,
    note: blocks.length > 0 ? null : "No testing blocks found on F1 season page.",
  };
}

// ---------------------- Main ----------------------
async function updateNextRace() {
  const now = new Date();

  // ICS sessions (race weekend)
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

  // Pull testing blocks from F1 season page
  const testing = await fetchTesting(season);

  // Race weekend grouping
  const gpSessions = sessions.filter((s) => s.gpName === gpName).sort((a, b) => a.start - b.start);
  const weekendStart = gpSessions[0].start;
  const weekendEnd = gpSessions[gpSessions.length - 1].end;

  // --- Track maps ---
  // Always fetch the next GP's detailed track map (for your normal widget)
  const raceResolved = await resolveF1RaceSlug(season, gpName);
  const raceTrackMap = await fetchTrackMapFromPage({
    pageUrl: raceResolved.url,
    season,
    outFileBase: `f1_${season}_${raceResolved.slug}_detailed`,
  });

  // NEW: if next event is testing, fetch the testing page map too
  let testingTrackMap = null;
  if (testing?.next?.pageUrl) {
    // store as: f1_2026_pre-season-testing-1_detailed.png etc
    const slug = `pre-season-testing-${testing.next.testNumber ?? "x"}`;
    testingTrackMap = await fetchTrackMapFromPage({
      pageUrl: testing.next.pageUrl,
      season,
      outFileBase: `f1_${season}_${slug}_detailed`,
    });

    // If testing page doesn't have a map, fall back to Bahrain GP map if testing location is Bahrain.
    if (!testingTrackMap.found && (testing.next.location || "").toLowerCase().includes("bahrain")) {
      // Bahrain GP is round 4 in 2026; the page exists and usually has the same circuit detailed map.
      // We try it as a practical fallback.
      const bahrainUrl = `https://www.formula1.com/en/racing/${season}/bahrain`;
      const bahrainFallback = await fetchTrackMapFromPage({
        pageUrl: bahrainUrl,
        season,
        outFileBase: `f1_${season}_bahrain_detailed`,
      });
      if (bahrainFallback.found) testingTrackMap = bahrainFallback;
    }
  }

  // Determine nextEvent (testing vs race weekend)
  const nextTestingStart = testing?.next?.startUtc ? new Date(testing.next.startUtc) : null;

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
      location: testing.next.location,
      startUtc: testing.next.startUtc,
      endUtc: testing.next.endUtc,
      startDateLabel: testing.next.startDateLabel,
      endDateLabel: testing.next.endDateLabel,
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

    // Testing block info
    testing: {
      found: testing.found,
      sourceUrl: testing.sourceUrl,
      next: testing.next,
      all: testing.all,
      note: testing.note,
      trackMap: testingTrackMap, // <-- NEW: testing map result
    },

    // Race weekend info
    grandPrix: {
      name: gpName,
      location: nextRace.location,
      season,
    },

    trackMap: raceTrackMap, // <-- race weekend map result

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
      "testing.* comes from formula1.com season page; testing.trackMap attempts formula1.com testing page map. race trackMap comes from the next GP race page.",
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote f1_next_race.json season=${season} gp=${gpName} testingFound=${testing.found}`);
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});