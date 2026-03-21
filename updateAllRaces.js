import fs from "node:fs/promises";
import path from "node:path";
import ical from "node-ical";
import sharp from "sharp";

const ICS_URL = "https://better-f1-calendar.vercel.app/api/calendar.ics";

const USER_TZ = "America/Edmonton";
const LOCALE = "en-CA";

const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const TRACKMAP_DIR = "trackmaps";
const MAPS_DIR = "maps";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";
const OUTPUT_FILE = "f1_upcoming_races.json";

/* -------------------- canceled races to omit -------------------- */

const OMIT_RACE_SLUGS = new Set([
  "bahrain",
  "saudi-arabia",
]);

const OMIT_TEXT_PATTERNS = [
  /\bbahrain\b/i,
  /\bsaudi\b/i,
  /\bjeddah\b/i,
  /\bsaudi arabia\b/i,
];

function shouldOmitRaceByText(text) {
  const s = String(text || "");
  return OMIT_TEXT_PATTERNS.some((re) => re.test(s));
}

/* -------------------- explicit slug overrides -------------------- */

const RACE_SLUG_OVERRIDES = {
  "australian grand prix": "australia",
  "chinese grand prix": "china",
  "japanese grand prix": "japan",
  "bahrain grand prix": "bahrain",
  "saudi arabian grand prix": "saudi-arabia",
  "miami grand prix": "miami",
  "monaco grand prix": "monaco",
  "spanish grand prix": "spain",
  "canadian grand prix": "canada",
  "austrian grand prix": "austria",
  "british grand prix": "great-britain",
  "belgian grand prix": "belgium",
  "hungarian grand prix": "hungary",
  "dutch grand prix": "netherlands",
  "italian grand prix": "italy",
  "azerbaijan grand prix": "azerbaijan",
  "singapore grand prix": "singapore",
  "united states grand prix": "united-states",
  "mexico city grand prix": "mexico",
  "mexican grand prix": "mexico",
  "sao paulo grand prix": "sao-paulo",
  "las vegas grand prix": "las-vegas",
  "qatar grand prix": "qatar",
  "abu dhabi grand prix": "abu-dhabi",
  "emilia romagna grand prix": "emilia-romagna",
  "madrid grand prix": "madrid",
};

const LOCATION_SLUG_OVERRIDES = {
  melbourne: "australia",
  shanghai: "china",
  suzuka: "japan",
  bahrain: "bahrain",
  jeddah: "saudi-arabia",
  miami: "miami",
  montecarlo: "monaco",
  monaco: "monaco",
  barcelona: "spain",
  montreal: "canada",
  spielberg: "austria",
  silverstone: "great-britain",
  spa: "belgium",
  budapest: "hungary",
  zandvoort: "netherlands",
  monza: "italy",
  baku: "azerbaijan",
  singapore: "singapore",
  austin: "united-states",
  mexicocity: "mexico",
  interlagos: "sao-paulo",
  saopaulo: "sao-paulo",
  lasvegas: "las-vegas",
  lusail: "qatar",
  yasmarina: "abu-dhabi",
  imola: "emilia-romagna",
  madrid: "madrid",
};

/* -------------------- custom map assets -------------------- */

const MAP_FILE_BY_SLUG = {
  australia: "melbourne.png",
  china: "shanghai.png",
  japan: "suzuka.png",
  bahrain: "bahrain.png",
  "saudi-arabia": "jeddah.png",
  miami: "miami.png",
  monaco: "monaco.png",
  spain: "barcelona.png",
  canada: "montreal.png",
  austria: "spielberg.png",
  "great-britain": "silverstone.png",
  belgium: "spa.png",
  hungary: "hungaroring.png",
  netherlands: "zandvoort.png",
  italy: "monza.png",
  azerbaijan: "baku.png",
  singapore: "singapore.png",
  "united-states": "austin.png",
  mexico: "mexico-city.png",
  "sao-paulo": "interlagos.png",
  "las-vegas": "las-vegas.png",
  qatar: "lusail.png",
  "abu-dhabi": "yas-marina.png",
  "emilia-romagna": "imola.png",
  madrid: "madrid.png",
};

function makeTrackPngUrl(filename) {
  return `${PAGES_BASE}/${TRACKMAP_DIR}/${encodeURIComponent(filename)}`;
}

function makeMapPngUrl(filename) {
  return `${PAGES_BASE}/${MAPS_DIR}/${encodeURIComponent(filename)}`;
}

function resolveCustomMapAsset(slug) {
  const filename = MAP_FILE_BY_SLUG[slug] || null;

  if (!filename) {
    return {
      found: false,
      filename: null,
      pngUrl: null,
      note: `No custom map file configured for slug "${slug}".`,
    };
  }

  return {
    found: true,
    filename,
    pngUrl: makeMapPngUrl(filename),
    note: null,
  };
}

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

function compactNormalized(s) {
  return normalize(s).replace(/\s+/g, "");
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

  const gpNorm = normalize(gpName);
  const locNormCompact = compactNormalized(locationRaw);

  if (RACE_SLUG_OVERRIDES[gpNorm]) {
    const slug = RACE_SLUG_OVERRIDES[gpNorm];
    if (slugs.includes(slug)) {
      return {
        slug,
        pageUrl: `https://www.formula1.com/en/racing/${season}/${slug}`,
        rankedTop: [{ slug, score: 999 }],
      };
    }
  }

  if (LOCATION_SLUG_OVERRIDES[locNormCompact]) {
    const slug = LOCATION_SLUG_OVERRIDES[locNormCompact];
    if (slugs.includes(slug)) {
      return {
        slug,
        pageUrl: `https://www.formula1.com/en/racing/${season}/${slug}`,
        rankedTop: [{ slug, score: 998 }],
      };
    }
  }

  const gpTokens = tokens(gpName);
  for (const token of gpTokens) {
    const direct = slugs.find((slug) => slug === token);
    if (direct) {
      return {
        slug: direct,
        pageUrl: `https://www.formula1.com/en/racing/${season}/${direct}`,
        rankedTop: [{ slug: direct, score: 997 }],
      };
    }
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

/* -------------------- official track map extraction -------------------- */

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

function collectWeekendSessionsFromICS(allSessions, raceSession) {
  const raceStart = raceSession.start.getTime();

  const minStart = raceStart - 72 * 60 * 60 * 1000;
  const maxStart = raceStart + 3 * 60 * 60 * 1000;

  let candidates = allSessions.filter((s) => {
    const ts = s.start.getTime();
    return ts >= minStart && ts <= maxStart;
  });

  const sameGpName = candidates.filter(
    (s) => normalize(s.gpName) === normalize(raceSession.gpName)
  );

  if (sameGpName.length > 0) {
    candidates = sameGpName;
  }

  if (raceSession.location) {
    const sameLocation = candidates.filter(
      (s) => normalize(s.location || "") === normalize(raceSession.location || "")
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

function weekendIdentityKey(raceSession) {
  const season = String(raceSession.start.getUTCFullYear());
  const gp = normalize(raceSession.gpName);
  const location = normalize(raceSession.location || "");
  const day = raceSession.start.toISOString().slice(0, 10);
  return `${season}|${gp}|${location}|${day}`;
}

/* -------------------- build one weekend -------------------- */

async function buildRaceWeekendEvent(allSessions, raceSession, now) {
  const season = String(raceSession.start.getUTCFullYear());
  const gpNameShort = raceSession.gpName;
  const locationRaw = raceSession.location || "";

  const racePage = await resolveRacePage({
    season,
    gpName: gpNameShort,
    locationRaw,
  });

  console.log(
    `[resolveRacePage] gp="${gpNameShort}" location="${locationRaw}" -> slug="${racePage.slug}"`
  );

  if (OMIT_RACE_SLUGS.has(racePage.slug)) {
    console.log(`Skipping omitted race by slug: ${racePage.slug}`);
    return null;
  }

  const gpSessions = collectWeekendSessionsFromICS(allSessions, raceSession);

  if (gpSessions.length === 0) {
    console.log(`Skipping ${gpNameShort}: no sessions collected`);
    return null;
  }

  const racePageHtml = await fetchText(racePage.pageUrl);

  const trackMap = await fetchTrackMapFromRacePageHtml({
    html: racePageHtml,
    pageUrl: racePage.pageUrl,
    season,
    outFileBase: `f1_${season}_${racePage.slug}_detailed`,
  });

  const customMap = resolveCustomMapAsset(racePage.slug);
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
  const weekendStart = window.startUtc ? new Date(window.startUtc) : raceSession.start;

  return {
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
    map: customMap,
    countdowns: {
      startsInDays: daysUntil(weekendStart, now),
    },
    weekend: {
      startUtc: window.startUtc,
      endUtc: window.endUtc,
    },
    sessions: sessionsOut,
  };
}

/* -------------------- main -------------------- */

async function updateAllRaces() {
  const now = new Date();

  const ics = await ical.async.fromURL(ICS_URL, {
    headers: { "User-Agent": UA },
  });

  const events = Object.values(ics).filter((x) => x?.type === "VEVENT");

  const allSessions = events
    .map((ev) => {
      const summary = (ev.summary || "").trim();
      const sessionType = getSessionType(summary);

      if (!sessionType) return null;

      const start = ev.start instanceof Date ? ev.start : new Date(ev.start);
      const end = ev.end instanceof Date ? ev.end : new Date(ev.end);

      if (isNaN(start) || isNaN(end)) return null;

      const gpName = stripFormula1Prefix(getGpName(summary));
      const location = ev.location || null;
      const description = ev.description || null;

      if (
        shouldOmitRaceByText(summary) ||
        shouldOmitRaceByText(gpName) ||
        shouldOmitRaceByText(location) ||
        shouldOmitRaceByText(description)
      ) {
        console.log(`Skipping omitted ICS item: ${summary}`);
        return null;
      }

      return {
        gpName,
        sessionType,
        start,
        end,
        location,
        description,
        summary,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  const upcomingRaceSessions = allSessions.filter(
    (s) => s.sessionType === "Race" && s.start > now
  );

  const uniqueRaceSessions = [];
  const seenWeekends = new Set();

  for (const raceSession of upcomingRaceSessions) {
    const key = weekendIdentityKey(raceSession);
    if (seenWeekends.has(key)) continue;
    seenWeekends.add(key);
    uniqueRaceSessions.push(raceSession);
  }

  if (uniqueRaceSessions.length === 0) {
    throw new Error("Could not find any upcoming Race sessions in calendar feed.");
  }

  const raceWeekends = [];

  for (const raceSession of uniqueRaceSessions) {
    try {
      console.log(`Building weekend: ${raceSession.gpName}`);
      const weekend = await buildRaceWeekendEvent(allSessions, raceSession, now);

      if (weekend) {
        raceWeekends.push(weekend);
      }
    } catch (err) {
      console.error(`Failed building ${raceSession.gpName}:`, err.message);
    }
  }

  if (raceWeekends.length === 0) {
    throw new Error("No valid upcoming race weekends could be built.");
  }

  const seenSlugs = new Set();
  const dedupedRaceWeekends = [];

  for (const weekend of raceWeekends) {
    const slug = weekend?.racePage?.slug;
    if (!slug) continue;

    if (seenSlugs.has(slug)) {
      console.warn(`Dropping duplicate resolved slug: ${slug} for "${weekend.title}"`);
      continue;
    }

    seenSlugs.add(slug);
    dedupedRaceWeekends.push(weekend);
  }

  const out = {
    header: "Upcoming F1 events",
    generatedAtUtc: now.toISOString(),
    displayTimeZone: USER_TZ,
    source: {
      kind: "ics+formula1",
      url: ICS_URL,
    },
    upcomingEvents: dedupedRaceWeekends,
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");

  console.log(`Wrote ${OUTPUT_FILE}`);
  console.log(`Built ${dedupedRaceWeekends.length} upcoming race weekends`);
}

updateAllRaces().catch((err) => {
  console.error(err);
  process.exit(1);
});
