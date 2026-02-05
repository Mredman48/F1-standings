// updateMercedesStandings.js
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";
const OPENF1_BASE = "https://api.openf1.org/v1";

// ✅ Mercedes logo (your repo)
const MERCEDES_LOGO_PNG =
  "https://raw.githubusercontent.com/Mredman48/F1-standings/refs/heads/main/teamlogos/2025_mercedes_color_v2.png";

// Output JSON
const OUT_JSON = "f1_mercedes_standings.json";

// Where headshots are saved
const HEADSHOTS_DIR = "headshots";

// GitHub Pages base
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// ---------------- Helpers ----------------

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
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    redirect: "follow",
  });

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

// Pick latest OpenF1 row
function pickLatestByMeetingKey(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  return rows.reduce((best, cur) => {
    const a = Number(best?.meeting_key ?? -1);
    const b = Number(cur?.meeting_key ?? -1);
    return b > a ? cur : best;
  }, rows[0]);
}

// ---------------- Headshot Download ----------------

async function getOpenF1HeadshotUrl(driverNumber) {
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
 * Downloads driver headshot → converts PNG → stores in /headshots
 * Returns Pages URL OR null if none exists.
 */
async function getOrUpdateHeadshot({ firstName, lastName, driverNumber }, width = 900) {
  const slug = `${toSlug(firstName)}-${toSlug(lastName)}`;
  const fileName = `${slug}.png`;

  const localPath = path.join(HEADSHOTS_DIR, fileName);
  const pagesUrl = `${PAGES_BASE}/${HEADSHOTS_DIR}/${fileName}`;

  const openf1Url = await getOpenF1HeadshotUrl(driverNumber);

  // If OpenF1 has nothing, reuse old saved file if present
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

// ---------------- Dash Builders ----------------

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
    team: "Mercedes",
    position: "-",
    points: "-",
    wins: "-",
    originalTeam: "-",
  };
}

// ---------------- Main JSON Builder ----------------

async function buildMercedesJson() {
  const now = new Date();

  // ✅ Mercedes driver lineup (edit anytime)
  const driversBase = [
    {
      firstName: "George",
      lastName: "Russell",
      code: "RUS",
      driverNumber: 63,
    },
    {
      firstName: "Andrea",
      lastName: "Kimi Antonelli",
      code: "ANT",
      driverNumber: 12,
    },
  ];

  const drivers = [];

  for (const d of driversBase) {
    const headshotUrl = await getOrUpdateHeadshot(d, 900);

    drivers.push({
      firstName: d.firstName,
      lastName: d.lastName,
      code: d.code,
      driverNumber: d.driverNumber,

      // Dash placeholders
      position: "-",
      points: "-",
      wins: "-",
      team: "Mercedes",
      placeholder: true,
      bestResult: dashBestResult(),

      // Real headshot URL or null
      headshotUrl,
    });
  }

  return {
    header: "Mercedes standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      openf1: OPENF1_BASE,
      driverStandings: "DASH_PLACEHOLDERS",
      constructorStandings: "DASH_PLACEHOLDERS",
      lastRace: "DASH_PLACEHOLDERS",
    },
    meta: {
      mode: "DASH_PLACEHOLDERS_REAL_HEADSHOTS",
      seasonUsed: "-",
      roundUsed: "-",
      note:
        "All datapoints are '-' placeholders for widget building. Headshots are pulled from OpenF1, downloaded, converted to PNG, and stored in /headshots.",
    },
    mercedes: {
      team: "Mercedes",
      teamLogoPng: MERCEDES_LOGO_PNG,
      teamStanding: dashTeamStanding(),
    },
    lastRace: dashLastRace(),
    drivers,
  };
}

// ---------------- Run Script ----------------

async function updateMercedesStandings() {
  const out = await buildMercedesJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");

  console.log(`Wrote ${OUT_JSON}`);
}

updateMercedesStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});