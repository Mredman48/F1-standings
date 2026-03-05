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

/* ---------- NEW: improved GP name parsing ---------- */

function getGpName(summary) {
  if (!summary) return null;

  return summary
    .replace(/ - (race|qualifying|practice.*|sprint.*)$/i, "")
    .trim();
}

/* ---------- NEW: robust location extraction ---------- */

function extractLocation(ev) {
  if (ev.location && ev.location.trim()) return ev.location.trim();

  if (ev.description) {
    const match = ev.description.match(/Location:\s*([A-Za-z\s]+)/i);
    if (match) return match[1].trim();
  }

  return null;
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

/* -------------------- resolve race page -------------------- */

async function resolveRacePage({ season, gpName }) {
  const seasonUrl = `https://www.formula1.com/en/racing/${season}`;
  const html = await fetchText(seasonUrl);

  const matches = Array.from(
    html.matchAll(new RegExp(`/en/racing/${season}/[a-z0-9-]+`, "g"))
  ).map((m) => m[0]);

  const uniq = [...new Set(matches)];

  const slugs = uniq.map((href) => href.split(`/en/racing/${season}/`)[1]);

  const slug = slugs.find((s) => gpName.toLowerCase().includes(s)) || slugs[0];

  return {
    slug,
    pageUrl: `https://www.formula1.com/en/racing/${season}/${slug}`,
  };
}

/* -------------------- flag helpers -------------------- */

function countryToIso2(country) {
  const map = {
    australia: "au",
    japan: "jp",
    china: "cn",
    bahrain: "bh",
    canada: "ca",
    italy: "it",
    spain: "es",
    france: "fr",
    belgium: "be",
    netherlands: "nl",
    austria: "at",
    hungary: "hu",
    brazil: "br",
    mexico: "mx",
    "united states": "us",
    singapore: "sg",
    qatar: "qa",
    "united arab emirates": "ae",
    "saudi arabia": "sa",
    monaco: "mc",
  };

  return map[(country || "").toLowerCase()] || null;
}

function buildFlagUrls(iso2) {
  if (!iso2) return { iso2: null, png: null, svg: null };

  return {
    iso2,
    png: `https://flagcdn.com/w160/${iso2}.png`,
    svg: `https://flagcdn.com/${iso2}.svg`,
  };
}

/* -------------------- main -------------------- */

async function updateNextRace() {
  const now = new Date();

  const ics = await ical.async.fromURL(ICS_URL, {
    headers: { "User-Agent": UA },
  });

  const events = Object.values(ics).filter((x) => x?.type === "VEVENT");

  const sessions = events
    .map((ev) => {
      const sessionType = getSessionType(ev.summary);

      if (!sessionType) return null;

      return {
        gpName: getGpName(ev.summary),
        sessionType,
        start: new Date(ev.start),
        end: new Date(ev.end),
        location: extractLocation(ev),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  const nextRace = sessions.find(
    (s) => s.sessionType === "Race" && s.start > now
  );

  if (!nextRace) throw new Error("No upcoming race found.");

  const gpSessions = sessions.filter((s) => s.gpName === nextRace.gpName);

  const weekendStart = gpSessions[0].start;

  const season = String(nextRace.start.getUTCFullYear());

  const racePage = await resolveRacePage({
    season,
    gpName: nextRace.gpName,
  });

  const trackMap = {
    found: false,
    pageUrl: racePage.pageUrl,
    mediaUrl: null,
    pngUrl: null,
  };

  const country = titleCaseWords(nextRace.location);

  const iso2 = countryToIso2(country);

  const flag = buildFlagUrls(iso2);

  const out = {
    header: "Next F1 event",
    generatedAtUtc: now.toISOString(),
    displayTimeZone: USER_TZ,
    source: { kind: "ics", url: ICS_URL },
    nextEvent: {
      type: "RACE_WEEKEND",
      title: nextRace.gpName,
      season,
      location: {
        raw: nextRace.location,
        city: null,
        country,
        flag,
      },
      racePage,
      trackMap,
      countdowns: {
        startsInDays: daysUntil(weekendStart, now),
      },
      weekend: {
        startUtc: weekendStart.toISOString(),
      },
    },
  };

  await fs.writeFile("f1_next_race.json", JSON.stringify(out, null, 2));

  console.log("Next race:", nextRace.gpName);
  console.log("Location:", country);
  console.log("Flag:", flag);
}

updateNextRace().catch((err) => {
  console.error(err);
  process.exit(1);
});