// updateRedBullStandings.js
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";
const OPENF1_BASE = "https://api.openf1.org/v1";

// ✅ Your exact logo URL (raw GitHub)
const REDBULL_LOGO_PNG =
  "https://raw.githubusercontent.com/Mredman48/F1-standings/refs/heads/main/teamlogos/2025_red-bull_color_v2.png";

// Output JSON
const OUT_JSON = "f1_redbull_standings.json";

// Where we store downloaded headshots
const HEADSHOTS_DIR = "headshots";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// ✅ Driver number images folder + helper
const DRIVER_NUMBER_FOLDER = "driver-numbers";
function getDriverNumberImageUrl(driverNumber) {
  if (driverNumber == null || driverNumber === "-" || driverNumber === "") return null;
  return `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`;
}

// ---------- Helpers ----------

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

function toSlug(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Pick the most recent driver row if multiple returned
function pickLatestByMeetingKey(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.reduce((best, cur) => {
    const a = Number(best?.meeting_key ?? -1);
    const b = Number(cur?.meeting_key ?? -1);
    return b > a ? cur : best;
  }, rows[0]);
}

// ---------- OpenF1 headshot pipeline (download -> PNG -> repo) ----------

async function getOpenF1HeadshotUrlByDriverNumber(driverNumber) {
  // Works even offseason (OpenF1 returns historical rows); we pick the latest.
  const url = `${OPENF1_BASE}/drivers?driver_number=${encodeURIComponent(driverNumber)}`;
  try {
    const rows = await fetchJson(url);
    const latest = pickLatestByMeetingKey(rows);
    return latest?.headshot_url || null;
  } catch {
    return null;
  }
}

/**
 * Downloads a headshot, converts to PNG, writes to /headshots/<slug>.png
 * Returns Pages URL if we have a file, else null.
 *
 * No placeholders: if no OpenF1 headshot and no prior saved file, return null.
 * If OpenF1 fails but we already have a file, keep returning the existing Pages URL.
 */
async function getOrUpdateHeadshotPng({ firstName, lastName, driverNumber }, width = 900) {
  const slug = `${toSlug(firstName)}-${toSlug(lastName)}`;
  const fileName = `${slug}.png`;
  const localPath = path.join(HEADSHOTS_DIR, fileName);
  const pagesUrl = `${PAGES_BASE}/${HEADSHOTS_DIR}/${fileName}`;

  const openf1Url = await getOpenF1HeadshotUrlByDriverNumber(driverNumber);

  if (!openf1Url) {
    if (await exists(localPath)) return pagesUrl;
    return null;
  }

  await ensureDir(HEADSHOTS_DIR);

  const buf = await fetchBinary(openf1Url);

  const png = await sharp(buf)
    .resize({ width, withoutEnlargement: true })
    .png()
    .toBuffer();

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
    team: "Red Bull",
    position: "-",
    points: "-",
    wins: "-",
    originalTeam: "-",
  };
}

// ---------- Build JSON (same structure, dashes) ----------

async function buildDashJson() {
  const now = new Date();

  const driversBase = [
    { firstName: "Max", lastName: "Verstappen", code: "VER", driverNumber: 1 },
    { firstName: "Isack", lastName: "Hadjar", code: "HAD", driverNumber: 99 },
  ];

  const drivers = [];
  for (const d of driversBase) {
    const headshotUrl = await getOrUpdateHeadshotPng(d, 900);

    drivers.push({
      firstName: d.firstName,
      lastName: d.lastName,
      code: d.code,
      driverNumber: d.driverNumber,

      // ✅ NEW FIELD (your uploaded number images)
      numberImageUrl: getDriverNumberImageUrl(d.driverNumber),

      position: "-",
      points: "-",
      wins: "-",
      team: "Red Bull",
      placeholder: true,
      bestResult: dashBestResult(),

      headshotUrl,
    });
  }

  return {
    header: "Red Bull standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      openf1: OPENF1_BASE,
      driverStandings: "DASH_PLACEHOLDERS",
      constructorStandings: "DASH_PLACEHOLDERS",
      lastRace: "DASH_PLACEHOLDERS",
      driverNumbers: `${PAGES_BASE}/driver-numbers/driver-number-<number>.png`,
    },
    meta: {
      mode: "DASH_PLACEHOLDERS_REAL_HEADSHOTS",
      seasonUsed: "-",
      roundUsed: "-",
      note:
        "All fields are '-' placeholders for widget building. Headshots are pulled from OpenF1 when available, downloaded, converted to PNG, and stored in /headshots. Driver number images are pulled from your repo folder driver-numbers.",
    },
    redbull: {
      team: "Red Bull",
      teamLogoPng: REDBULL_LOGO_PNG,
      teamStanding: dashTeamStanding(),
    },
    lastRace: dashLastRace(),
    drivers,
  };
}

// ---------- Main ----------

async function updateRedBullStandings() {
  const out = await buildDashJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateRedBullStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});