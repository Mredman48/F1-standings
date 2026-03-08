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

async function fetchText(url, accept = "text/html,*/*") {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: accept },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }

  return res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "image/*,*/*" },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }

  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/* -------------------- generic helpers -------------------- */

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

function stripFormula1Prefix(name) {
  if (!name) return name;
  return name
    .replace(/^formula 1\s+/i, "F1 ")
    .replace(/^formule 1\s+/i, "F1 ")
    .trim();
}

function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function htmlToText(html) {
  return decodeHtmlEntities(
    String(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/* -------------------- ICS parsing -------------------- */

function getSessionType(summary) {
  const s = String(summary || "").toLowerCase().trim();

  if (/\b(practice\s*1|fp1)\b/.test(s)) return "FP1";
  if (/\b(practice\s*2|fp2)\b/.test(s)) return "FP2";
  if (/\b(practice\s*3|fp3)\b/.test(s)) return "FP3";

  // Must come before plain sprint
  if (
    /\b(sprint\s+qualifying|sprint\s+qualification|sprint\s+shootout|sq)\b/.test(s) ||
    (/\bsprint\b/.test(s) && /\b(qualifying|qualification|shootout)\b/.test(s))
  ) {
    return "Sprint Qualifying";
  }

  if (/\bqualifying\b/.test(s) && !/\bsprint\b/.test(s)) {
    return "Qualifying";
  }

  if (/\bqualification\b/.test(s) && !/\bsprint\b/.test(s)) {
    return "Qualifying";
  }

  if (/\bsprint\b/.test(s)) {
    return "Sprint";
  }

  if (
    /\b(race|grand prix)\b/.test(s) &&
    !/\bqualifying\b/.test(s) &&
    !/\bqualification\b/.test(s) &&
    !/\bsprint\b/.test(s)
  ) {
    return "Race";
  }

  return null;
}

function getGpName(summary) {
  const parts = String(summary || "").split(" - ");
  return (parts[0] || summary || "").trim();
}

/* -------------------- official race page resolution -------------------- */

function isBadSlug(slug) {
  return !slug || slug.startsWith("pre-season-testing");
}

function scoreSlug(slug, gpName, locationRaw) {
  const sTokens = tokens(slug);
  const gpTokens = new Set(tokens(gpName));
  const locTokens = new Set(tokens(locationRaw));

  let score = 0;

  for (const t of sTokens) {
    if (locTokens.has(t)) score += 20;
    if (gpTokens.has(t)) score += 6;
  }

  const gpNorm = normalize(gpName);
  if (slug === "australia" && gpNorm.includes("australian")) score += 30;
  if (slug === "great-britain" && gpNorm.includes("british")) score += 30;
  if (slug === "sao-paulo" && gpNorm.includes("brazil")) score += 25;
  if (slug === "china" && gpNorm.includes("chinese")) score += 30;
  if (slug === "japan" && gpNorm.includes("japanese")) score += 30;
  if (slug === "saudi-arabia" && gpNorm.includes("saudi")) score += 30;
  if (slug === "abu-dhabi" && gpNorm.includes("abu")) score += 30;

  return score;
}

async function resolveRacePage({ season, gpName, locationRaw }) {
  const seasonUrl = `https://www.formula1.com/en/racing/${season}`;
  const html = await fetchText(seasonUrl);

  const matches = Array.from(
    html.matchAll(new RegExp(`/en/racing/${season}/[a-z0-9-]+`, "g"))
  ).map((m) => m[0]);

  const slugs = [...new Set(matches)]
    .map((href) => href.split(`/en/racing/${season}/`)[1])
    .filter((slug) => slug && !isBadSlug(slug));

  if (slugs.length === 0) {
    throw new Error("No race slugs found on season page.");
  }

  const ranked = slugs
    .map((slug) => ({
      slug,
      score: scoreSlug(slug, gpName, locationRaw),
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) {
    throw new Error("Could not resolve official race page slug.");
  }

  return {
    slug: best.slug,
    pageUrl: `https://www.formula1.com/en/racing/${season}/${best.slug}`,
    rankedTop: ranked.slice(0, 8),
  };
}

/* -------------------- official race metadata -------------------- */

function countryFromSlug(slug) {
  const map = {
    australia: "Australia",
    china: "China",
    japan: "Japan",
    bahrain: "Bahrain",
    "saudi-arabia": "Saudi Arabia",
    miami: "United States",
    monaco: "Monaco",
    spain: "Spain",
    canada: "Canada",
    austria: "Austria",
    "great-britain": "United Kingdom",
    belgium: "Belgium",
    hungary: "Hungary",
    netherlands: "Netherlands",
    italy: "Italy",
    azerbaijan: "Azerbaijan",
    singapore: "Singapore",
    "united-states": "United States",
    mexico: "Mexico",
    "sao-paulo": "Brazil",
    "las-vegas": "United States",
    qatar: "Qatar",
    "abu-dhabi": "United Arab Emirates",
    madrid: "Spain",
    "emilia-romagna": "Italy",
  };

  return map[slug] || null;
}

function extractOfficialRaceMetaFromHtml(html, { fallbackGpName, fallbackSlug, fallbackCountry }) {
  const text = htmlToText(html);

  let officialTitle = null;
  let city = null;
  let country = fallbackCountry || null;

  const titleMatch =
    text.match(/(FORMULA 1 [A-Z0-9 .'\-À-ÿ]+ GRAND PRIX 20\d{2})/i) ||
    text.match(/([A-Z][A-Za-zÀ-ÿ0-9 .'\-]+ Grand Prix 20\d{2})/);

  if (titleMatch?.[1]) {
    officialTitle = titleMatch[1].replace(/\s+/g, " ").trim();
  }

  const localityMatch =
    html.match(/"addressLocality":"([^"]+)"/i) ||
    html.match(/"locality":"([^"]+)"/i);

  if (localityMatch?.[1]) {
    city = titleCaseWords(localityMatch[1]);
  }

  const countryMatch =
    html.match(/"addressCountry":"([^"]+)"/i) ||
    html.match(/"country":"([^"]+)"/i);

  if (countryMatch?.[1]) {
    country = titleCaseWords(countryMatch[1]);
  }

  if (!country && fallbackSlug) {
    country = countryFromSlug(fallbackSlug);
  }

  if (!officialTitle) {
    officialTitle = fallbackGpName || titleCaseFromSlug(fallbackSlug);
  }

  return { officialTitle, city, country };
}

/* -------------------- track map extraction -------------------- */

function extractDetailedTrackMediaUrl(html, season) {
  const patterns = [
    new RegExp(
      `https://media\\.formula1\\.com/image/upload[^"'\\s]+/common/f1/${season}/track/[^"'\\s]+detailed\\.(webp|png)`,
      "i"
    ),
    new RegExp(
      `https://media\\.formula1\\.com/[^"'\\s]+/common/f1/${season}/track/[^"'\\s]+detailed\\.(webp|png)`,
      "i"
    ),
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[0];
  }

  return null;
}

function getCityFromTrackMediaUrl(mediaUrl) {
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

async function fetchTrackMapFromRacePageHtml({ html, pageUrl, season, outFileBase }) {
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

  return {
    found: true,
    pageUrl,
    mediaUrl,
    pngUrl,
    note: null,
  };
}

/* -------------------- country -> ISO2 -> flag -------------------- */

function normalizeCountryName(s) {
  return (s || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\./g, "")
    .replace(/[^a-z\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function countryToIso2(countryName) {
  const c = normalizeCountryName(countryName);

  const map = {
    australia: "au",
    bahrain: "bh",
    china: "cn",
    japan: "jp",
    "saudi arabia": "sa",
    qatar: "qa",
    singapore: "sg",
    "united arab emirates": "ae",
    uae: "ae",
    canada: "ca",
    mexico: "mx",
    brazil: "br",
    argentina: "ar",
    "united states": "us",
    "united states of america": "us",
    usa: "us",
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
    azerbaijan: "az",
  };

  return map[c] || null;
}

function buildFlagUrls(iso2) {
  if (!iso2) {
    return { iso2: null, png: null, svg: null };
  }

  const code = iso2.toLowerCase();
  return {
    iso2: code,
    png: `https://flagcdn.com/w160/${code}.png`,
    svg: `https://flagcdn.com/${code}.svg`,
  };
}

/* -------------------- session collection -------------------- */

function sessionPriority(type) {
  const map = {
    FP1: 1,
    FP2: 2,
    FP3: 3,
    "Sprint Qualifying": 4,
    Sprint: 5,
    Qualifying: 6,
    Race: 7,
  };

  return map[type] || 999;
}

function dedupeSessions(sessions) {
  const map = new Map();

  for (const s of sessions) {
    const key = `${s.sessionType}|${s.start.toISOString()}`;

    if (!map.has(key)) {
      map.set(key, s);
      continue;
    }

    const prev = map.get(key);
    const prevScore =
      String(prev.summary || "").length + String(prev.description || "").length;
    const nextScore =
      String(s.summary || "").length + String(s.description || "").length;

    if (nextScore > prevScore) {
      map.set(key, s);
    }
  }

  return Array.from(map.values()).sort((a, b) => a.start - b.start);
}

function collectWeekendSessionsFromICS(allSessions, nextRaceSession) {
  const raceStart = nextRaceSession.start.getTime();

  const minStart = raceStart - 72 * 60 * 60 * 1000;
  const maxStart = raceStart + 3 * 60 * 60 * 1000;

  let candidates = allSessions.filter((s) => {
    const ts = s.start.getTime();
    return ts >= minStart && ts <= maxStart;
  });

  const sameGpName = candidates.filter(
    (s) => normalize(s.gpName) === normalize(nextRaceSession.gpName)
  );

  if (sameGpName.length > 0) {
    candidates = sameGpName;
  }

  if (nextRaceSession.location) {
    const sameLocation = candidates.filter(
      (s) => normalize(s.location || "") === normalize(nextRaceSession.location || "")
    );

    if (sameLocation.length > 0) {
      candidates = sameLocation;
    }
  }

  return dedupeSessions(candidates).sort((a, b) => {
    const timeCmp = a.start - b.start;
    if (timeCmp !== 0) return timeCmp;
    return sessionPriority(a.sessionType) - sessionPriority(b.sessionType);
  });
}

/* -------------------- output helpers -------------------- */

function displaySessionType(type) {
  if (type === "Qualifying") return "Quali";
  if (type === "Sprint Qualifying") return "Sprint Quali";
  return type;
}

function buildSessionsForRaceWeekend(gpSessions) {
  return [...gpSessions]
    .sort((a, b) => {
      const timeCmp = a.start - b.start;
      if (timeCmp !== 0) return timeCmp;
      return sessionPriority(a.sessionType) - sessionPriority(b.sessionType);
    })
    .map((s) => ({
      type: displaySessionType(s.sessionType),
      startUtc: s.start.toISOString(),
      endUtc: s.end.toISOString(),
      startLocalDateShort: shortDateInTZ(s.start),
      startLocalTimeShort: shortTimeInTZ(s.start),
      startLocalDateTimeShort: shortDateTimeInTZ(s.start),
    }));
}

function computeWindowFromSessions(sessions) {
  if (!sessions || sessions.length === 0) {
    return { startUtc: null, endUtc: null };
  }

  const starts = sessions.map((s) => new Date(s.startUtc)).filter((d) => !isNaN(d));
  const ends = sessions.map((s) => new Date(s.endUtc)).filter((d) => !isNaN(d));

  return {
    startUtc: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
    endUtc: ends.length ? new Date(Math.max(...ends)).toISOString() : null,
  };
}

/* -------------------- main -------------------- */

async function updateNextRace() {
  const now = new Date();

  const ics = await ical.async.fromURL(ICS_URL, {
    headers: { "User-Agent": UA },
  });

  const events = Object.values(ics).filter((x) => x?.type === "VEVENT");

  const allSessions = events
    .map((ev) => {
      const summary = (ev.summary || "").trim();
      const sessionType = getSessionType(summary);

      console.log(`RAW SESSION: ${summary} => ${sessionType}`);

      if (!sessionType) return null;

      const start = ev.start instanceof Date ? ev.start : new Date(ev.start);
      const end = ev.end instanceof Date ? ev.end : new Date(ev.end);

      if (isNaN(start) || isNaN(end)) return null;

      return {
        gpName: stripFormula1Prefix(getGpName(summary)),
        sessionType,
        start,
        end,
        location: ev.location || null,
        description: ev.description || null,
        summary,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  const nextRaceSession = allSessions.find(
    (s) => s.sessionType === "Race" && s.start > now
  );

  if (!nextRaceSession) {
    throw new Error("Could not find upcoming Race session in calendar feed.");
  }

  const season = String(nextRaceSession.start.getUTCFullYear());
  const gpNameShort = nextRaceSession.gpName;
  const locationRaw = nextRaceSession.location || "";

  const gpSessions = collectWeekendSessionsFromICS(allSessions, nextRaceSession);

  if (gpSessions.length === 0) {
    throw new Error("Could not collect sessions for upcoming race weekend.");
  }

  console.log("NEXT RACE WEEKEND SESSIONS FROM ICAL:");
  gpSessions.forEach((s, i) => {
    console.log(
      `${i + 1}. RAW="${s.summary}" | TYPE="${s.sessionType}" | START="${s.start.toISOString()}"`
    );
  });

  const racePage = await resolveRacePage({
    season,
    gpName: gpNameShort,
    locationRaw,
  });

  const racePageHtml = await fetchText(racePage.pageUrl);

  const trackMap = await fetchTrackMapFromRacePageHtml({
    html: racePageHtml,
    pageUrl: racePage.pageUrl,
    season,
    outFileBase: `f1_${season}_${racePage.slug}_detailed`,
  });

  const cityFromTrackMap = getCityFromTrackMediaUrl(trackMap.mediaUrl);

  const meta = extractOfficialRaceMetaFromHtml(racePageHtml, {
    fallbackGpName: gpNameShort,
    fallbackSlug: racePage.slug,
    fallbackCountry: locationRaw ? titleCaseWords(locationRaw) : null,
  });

  const officialTitle = meta.officialTitle || gpNameShort;
  const city = meta.city || cityFromTrackMap || null;
  const country =
    meta.country ||
    countryFromSlug(racePage.slug) ||
    (locationRaw ? titleCaseWords(locationRaw) : null);

  const iso2 = countryToIso2(country);
  const flag = buildFlagUrls(iso2);

  const sessionsOut = buildSessionsForRaceWeekend(gpSessions);
  const window = computeWindowFromSessions(sessionsOut);
  const weekendStart = window.startUtc ? new Date(window.startUtc) : nextRaceSession.start;

  const out = {
    header: "Next F1 event",
    generatedAtUtc: now.toISOString(),
    displayTimeZone: USER_TZ,
    source: {
      kind: "ics+formula1",
      url: ICS_URL,
      officialRacePage: racePage.pageUrl,
    },
    nextEvent: {
      type: "RACE_WEEKEND",
      title: officialTitle,
      season,
      location: {
        raw: locationRaw || null,
        city: city || null,
        country: country || null,
        flag,
      },
      racePage: {
        slug: racePage.slug,
        url: racePage.pageUrl,
      },
      trackMap,
      countdowns: {
        startsInDays: daysUntil(weekendStart, now),
      },
      weekend: {
        startUtc: window.startUtc,
        endUtc: window.endUtc,
      },
      sessions: sessionsOut,
    },
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");

  console.log("GP name from ICS:", gpNameShort);
  console.log("Resolved race page:", racePage.pageUrl);
  console.log("Collected session summaries:");
  for (const s of gpSessions) {
    console.log(
      ` - ${s.start.toISOString()} | ${s.sessionType} | ${s.summary} | ${s.location || "-"}`
    );
  }
  console.log("Official title:", officialTitle);
  console.log("City:", city);
  console.log("Country:", country, "ISO2:", iso2);
  console.log("Track map:", trackMap);
  console.log("Wrote f1_next_race.json");
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});