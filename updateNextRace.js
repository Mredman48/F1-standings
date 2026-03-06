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

function stripFormula1Prefix(name) {
  if (!name) return name;
  return name
    .replace(/^formula 1\s+/i, "F1 ")
    .replace(/^formule 1\s+/i, "F1 ")
    .trim();
}

/* -------------------- track map extraction -------------------- */

function extractDetailedTrackMediaUrl(html, season) {
  const re = new RegExp(
    `https://media\\.formula1\\.com/image/upload[^"']+/common/f1/${season}/track/[^"']+detailed\\.(webp|png)`,
    "i"
  );
  const m = html.match(re);
  return m ? m[0] : null;
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
  return { found: true, pageUrl, mediaUrl, pngUrl, note: null };
}

/* -------------------- official F1 page helpers -------------------- */

function extractF1RacePageUrlFromDescription(description, season) {
  const text = String(description || "");
  const re = new RegExp(`https://www\\.formula1\\.com/en/racing/${season}/[a-z0-9-]+`, "i");
  const m = text.match(re);
  return m ? m[0] : null;
}

function slugFromRacePageUrl(url, season) {
  if (!url) return null;
  const m = url.match(new RegExp(`/en/racing/${season}/([a-z0-9-]+)`, "i"));
  return m ? m[1] : null;
}

function countryFromSlug(slug) {
  const map = {
    australia: "Australia",
    china: "China",
    japan: "Japan",
    bahrain: "Bahrain",
    saudi-arabia: "Saudi Arabia",
    miami: "United States",
    emilia-romagna: "Italy",
    monaco: "Monaco",
    spain: "Spain",
    canada: "Canada",
    austria: "Austria",
    great-britain: "United Kingdom",
    belgium: "Belgium",
    hungary: "Hungary",
    netherlands: "Netherlands",
    italy: "Italy",
    azerbaijan: "Azerbaijan",
    singapore: "Singapore",
    united-states: "United States",
    mexico: "Mexico",
    sao-paulo: "Brazil",
    las-vegas: "United States",
    qatar: "Qatar",
    abu-dhabi: "United Arab Emirates",
    madrid: "Spain",
  };
  return map[slug] || null;
}

function extractOfficialRaceMetaFromHtml(html, { fallbackGpName, fallbackSlug, fallbackCountry, fallbackCity }) {
  const out = {
    officialTitle: null,
    city: fallbackCity || null,
    country: fallbackCountry || null,
  };

  // JSON-LD / embedded metadata patterns
  const titlePatterns = [
    /"name":"([^"]*Grand Prix[^"]*\d{4})"/i,
    /"headline":"([^"]*Grand Prix[^"]*\d{4})"/i,
    /<title>\s*([^<]*Grand Prix[^<]*)<\/title>/i,
  ];

  for (const re of titlePatterns) {
    const m = html.match(re);
    if (m?.[1]) {
      out.officialTitle = m[1]
        .replace(/\s*\|\s*Formula 1.*$/i, "")
        .replace(/\s*-\s*Formula 1.*$/i, "")
        .trim();
      break;
    }
  }

  const cityPatterns = [
    /"addressLocality":"([^"]+)"/i,
    /"locality":"([^"]+)"/i,
  ];
  for (const re of cityPatterns) {
    const m = html.match(re);
    if (m?.[1]) {
      out.city = titleCaseWords(m[1]);
      break;
    }
  }

  const countryPatterns = [
    /"addressCountry":"([^"]+)"/i,
    /"country":"([^"]+)"/i,
  ];
  for (const re of countryPatterns) {
    const m = html.match(re);
    if (m?.[1]) {
      out.country = titleCaseWords(m[1]);
      break;
    }
  }

  if (!out.country && fallbackSlug) {
    out.country = countryFromSlug(fallbackSlug);
  }

  if (!out.officialTitle) {
    if (out.country && fallbackGpName) {
      // Turn "F1 Australian GP" into "Australian Grand Prix"
      const cleaned = fallbackGpName
        .replace(/^F1\s+/i, "")
        .replace(/\s+GP$/i, " Grand Prix")
        .trim();
      out.officialTitle = cleaned;
    } else {
      out.officialTitle = fallbackGpName || null;
    }
  }

  return out;
}

/* -------------------- resolve correct race page (NO testing) -------------------- */

function isBadSlug(slug) {
  if (!slug) return true;
  return slug.startsWith("pre-season-testing");
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

  return score;
}

async function resolveRacePage({ season, gpName, locationRaw }) {
  const seasonUrl = `https://www.formula1.com/en/racing/${season}`;
  const html = await fetchText(seasonUrl);

  const matches = Array.from(
    html.matchAll(new RegExp(`/en/racing/${season}/[a-z0-9-]+`, "g"))
  ).map((m) => m[0]);

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
        gpName: stripFormula1Prefix(getGpName(summary)),
        sessionType,
        start,
        end,
        location: ev.location || null,
        description: ev.description || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  const nextRaceSession = allSessions.find((s) => s.sessionType === "Race" && s.start > now);
  if (!nextRaceSession) throw new Error("Could not find upcoming Race session in calendar feed.");

  const season = String(nextRaceSession.start.getUTCFullYear());
  const gpNameShort = nextRaceSession.gpName;
  const locationRaw = nextRaceSession.location || "";

  const gpSessions = allSessions
    .filter((s) => s.gpName === gpNameShort)
    .sort((a, b) => a.start - b.start);

  const weekendStart = gpSessions[0].start;

  // 1) Prefer official F1 event page from ICS description
  const racePageUrlFromDescription = extractF1RacePageUrlFromDescription(
    nextRaceSession.description,
    season
  );

  let racePage;
  if (racePageUrlFromDescription) {
    racePage = {
      slug: slugFromRacePageUrl(racePageUrlFromDescription, season),
      pageUrl: racePageUrlFromDescription,
      rankedTop: [],
    };
  } else {
    racePage = await resolveRacePage({ season, gpName: gpNameShort, locationRaw });
  }

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
    fallbackCity: cityFromTrackMap,
  });

  const officialTitle = meta.officialTitle || gpNameShort;
  const city = meta.city || cityFromTrackMap || null;
  const country = meta.country || (locationRaw ? titleCaseWords(locationRaw) : null);

  const iso2 = countryToIso2(country);
  const flag = buildFlagUrls(iso2);

  const sessionsOut = buildSessionsForRaceWeekend(gpSessions);
  const window = computeWindowFromSessions(sessionsOut);

  const out = {
    header: "Next F1 event",
    generatedAtUtc: now.toISOString(),
    displayTimeZone: USER_TZ,
    source: { kind: "ics+formula1", url: ICS_URL },
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
      countdowns: { startsInDays: daysUntil(weekendStart, now) },
      weekend: { startUtc: window.startUtc, endUtc: window.endUtc },
      sessions: sessionsOut,
    },
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2), "utf8");

  console.log("Short GP name from ICS:", gpNameShort);
  console.log("Official title:", officialTitle);
  console.log("Race page url:", racePage.pageUrl);
  console.log("Location raw:", locationRaw);
  console.log("Country:", country, "ISO2:", iso2);
  console.log("City:", city);
  console.log("Flag:", flag);
  console.log("Track map:", trackMap);
  console.log("Wrote f1_next_race.json");
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});