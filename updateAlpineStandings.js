// updateAlpineStandings.js
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";
const OPENF1_BASE = "https://api.openf1.org/v1";

// Output JSON
const OUT_JSON = "f1_alpine_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Repo folders
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";
const TEAMLOGOS_DIR = "teamlogos";

// ✅ LOCAL repo logo (Pages), not raw GitHub and not formula1.com
const ALPINE_LOGO_PNG = `${PAGES_BASE}/${TEAMLOGOS_DIR}/2025_alpine_color_v2.png`;

// If Widgy/GitHub CDN is stubborn
const CACHE_BUST = true;

// OpenF1 team name (must match OpenF1 driver.team_name values)
const OPENF1_TEAM_NAME = "Alpine";

// ---------- helpers ----------

function withCacheBust(url) {
  if (!url) return url;
  return CACHE_BUST ? `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}` : url;
}

function toSlug(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    redirect: "follow",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}\n${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function fetchBinary(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

// ✅ Driver number images (repo-saved)
function getDriverNumberImageUrl(driverNumber) {
  if (driverNumber == null || driverNumber === "-" || driverNumber === "") return null;
  return withCacheBust(`${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`);
}

// ---------- OpenF1: get Alpine drivers (latest) ----------

function pickLatestByMeetingKey(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  // If meeting_key isn’t present for some reason, just return as-is.
  const withKey = rows.filter((r) => r && r.meeting_key != null);
  if (withKey.length === 0) return rows;

  const maxKey = withKey.reduce((m, r) => Math.max(m, Number(r.meeting_key) || -1), -1);
  return rows.filter((r) => Number(r?.meeting_key) === maxKey);
}

/**
 * Pull Alpine drivers from OpenF1:
 * - meeting_key=latest keeps it current
 * - team_name filters to Alpine
 * Then return 2 unique drivers.
 */
async function getAlpineDriversFromOpenF1() {
  const url = `${OPENF1_BASE}/drivers?meeting_key=latest&team_name=${encodeURIComponent(
    OPENF1_TEAM_NAME
  )}`;

  const rows = await fetchJson(url);
  const latestRows = pickLatestByMeetingKey(rows);

  // Deduplicate by driver_number
  const map = new Map();
  for (const r of latestRows) {
    const num = r?.driver_number;
    if (num == null) continue;
    if (!map.has(num)) map.set(num, r);
  }

  // Sort by driver_number and take first 2
  const drivers = Array.from(map.values())
    .sort((a, b) => Number(a.driver_number) - Number(b.driver_number))
    .slice(0, 2);

  return drivers;
}

// ---------- Headshots: download from OpenF1 headshot_url and store in /headshots ----------

async function getOrUpdateHeadshotFromOpenF1({ firstName, lastName, headshotUrl }, width = 900) {
  if (!firstName || !lastName) return null;

  const fileName = `${toSlug(firstName)}-${toSlug(lastName)}.png`;
  const localPath = path.join(HEADSHOTS_DIR, fileName);
  const pagesUrl = withCacheBust(`${PAGES_BASE}/${HEADSHOTS_DIR}/${fileName}`);

  // If OpenF1 didn’t provide one, keep existing if present, else null
  if (!headshotUrl) {
    if (await exists(localPath)) return pagesUrl;
    return null;
  }

  await ensureDir(HEADSHOTS_DIR);

  const buf = await fetchBinary(headshotUrl);
  const png = await sharp(buf).resize({ width, withoutEnlargement: true }).png().toBuffer();

  await fs.writeFile(localPath, png);
  return pagesUrl;
}

// ---------- Dash placeholder builders ----------

function dashBestResult() {
  return { position: "-", raceName: "-", round: "-", date: "-", circuit: "-" };
}

function dashLastRace() {
  return {
    season: "-",
    round: "-",
    raceName: "-",
    date: "-",
    timeUtc: "-",
    circuit: { name: "-", locality: "-", country: "-" },
  };
}

function dashTeamStanding() {
  return {
    team: "Alpine",
    position: "-",
    points: "-",
    wins: "-",
    originalTeam: "-",
  };
}

// ---------- Build JSON (dash placeholders + OpenF1 drivers) ----------

async function buildDashJson() {
  const now = new Date();

  // Pull drivers from OpenF1 (team filter)
  let openf1Drivers = [];
  try {
    openf1Drivers = await getAlpineDriversFromOpenF1();
  } catch (e) {
    // If OpenF1 is down, output empty placeholders (no hardcoded drivers)
    openf1Drivers = [];
  }

  const drivers = [];

  for (const r of openf1Drivers) {
    const firstName = r?.first_name || "-";
    const lastName = r?.last_name || "-";
    const code = r?.name_acronym || "-";
    const driverNumber = r?.driver_number ?? "-";

    // Download/update headshot into repo
    const headshotSavedUrl =
      firstName !== "-" && lastName !== "-"
        ? await getOrUpdateHeadshotFromOpenF1({
            firstName,
            lastName,
            headshotUrl: r?.headshot_url || null,
          })
        : null;

    drivers.push({
      firstName,
      lastName,
      code,
      driverNumber,

      // repo driver-number images
      numberImageUrl: getDriverNumberImageUrl(driverNumber),

      // dash placeholders
      position: "-",
      points: "-",
      wins: "-",
      team: "Alpine",
      placeholder: true,
      bestResult: dashBestResult(),

      // saved Pages URL (or null)
      headshotUrl: headshotSavedUrl,
    });
  }

  // Ensure exactly 2 drivers in output (pad with dashes if OpenF1 returned <2)
  while (drivers.length < 2) {
    drivers.push({
      firstName: "-",
      lastName: "-",
      code: "-",
      driverNumber: "-",
      numberImageUrl: null,
      position: "-",
      points: "-",
      wins: "-",
      team: "Alpine",
      placeholder: true,
      bestResult: dashBestResult(),
      headshotUrl: null,
    });
  }

  return {
    header: "Alpine standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      openf1: OPENF1_BASE,
      drivers: `${OPENF1_BASE}/drivers?meeting_key=latest&team_name=${encodeURIComponent(
        OPENF1_TEAM_NAME
      )}`,
      headshots: "OpenF1 headshot_url downloaded -> /headshots",
      driverNumbers: `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-<number>.png`,
      teamLogo: `LOCAL_ONLY: ${PAGES_BASE}/${TEAMLOGOS_DIR}/2025_alpine_color_v2.png`,
      driverStandings: "DASH_PLACEHOLDERS",
      constructorStandings: "DASH_PLACEHOLDERS",
      lastRace: "DASH_PLACEHOLDERS",
    },
    meta: {
      mode: "DASH_PLACEHOLDERS_OPENF1_DRIVERS_SAVED_HEADSHOTS",
      cacheBust: CACHE_BUST,
      note:
        "All standings fields are '-' placeholders for widget building. Drivers are pulled from OpenF1 (meeting_key=latest + team_name), and headshots are downloaded/converted to PNG and saved in /headshots. Team logo and driver-number images are loaded from repo folders.",
    },
    alpine: {
      team: "Alpine",
      teamLogoPng: withCacheBust(ALPINE_LOGO_PNG),
      teamStanding: dashTeamStanding(),
    },
    lastRace: dashLastRace(),
    drivers,
  };
}

// ---------- Main ----------

async function updateAlpineStandings() {
  const out = await buildDashJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateAlpineStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});
