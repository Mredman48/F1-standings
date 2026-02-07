// updateMcLarenStandings.js
import fs from "node:fs/promises";
import path from "node:path";

const OUT_JSON = "f1_mclaren_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// ✅ Team logo (LOCAL in your repo)
const TEAMLOGOS_DIR = "teamlogos";
const MCLAREN_LOGO_FILE = "2025_mclaren_color_v2.png";
const MCLAREN_LOGO_PNG = `${PAGES_BASE}/${TEAMLOGOS_DIR}/${MCLAREN_LOGO_FILE}`;

// ✅ Driver number images folder
const DRIVER_NUMBER_FOLDER = "driver-numbers";
function getDriverNumberImageUrl(driverNumber) {
  if (driverNumber == null || driverNumber === "-" || driverNumber === "") return null;
  return `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`;
}

// ✅ Headshots are already saved here
const HEADSHOTS_DIR = "headshots";
function headshotPagesUrl(fileName) {
  return `${PAGES_BASE}/${HEADSHOTS_DIR}/${fileName}`;
}

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * ✅ Uses already-saved headshots in /headshots
 * Returns Pages URL if file exists, else null (no placeholders).
 */
async function getSavedHeadshotUrl(fileName) {
  const localPath = path.join(HEADSHOTS_DIR, fileName);
  if (await exists(localPath)) return headshotPagesUrl(fileName);
  return null;
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
    team: "McLaren",
    position: "-",
    points: "-",
    wins: "-",
    originalTeam: "-",
  };
}

// ---------- Build JSON ----------

async function buildDashJson() {
  const now = new Date();

  // ✅ IMPORTANT:
  // Set headshotFile values to EXACT filenames that exist in /headshots
  // Example: "lando-norris.png" must exist at /headshots/lando-norris.png
  const driversBase = [
    {
      firstName: "Lando",
      lastName: "Norris",
      code: "NOR",
      driverNumber: 4,
      headshotFile: "lando-norris.png",
    },
    {
      firstName: "Oscar",
      lastName: "Piastri",
      code: "PIA",
      driverNumber: 81,
      headshotFile: "oscar-piastri.png",
    },
  ];

  const drivers = [];
  for (const d of driversBase) {
    const headshotUrl = await getSavedHeadshotUrl(d.headshotFile);

    drivers.push({
      firstName: d.firstName,
      lastName: d.lastName,
      code: d.code,
      driverNumber: d.driverNumber,

      // ✅ your uploaded number images
      numberImageUrl: getDriverNumberImageUrl(d.driverNumber),

      // placeholders
      position: "-",
      points: "-",
      wins: "-",
      team: "McLaren",
      placeholder: true,
      bestResult: dashBestResult(),

      // ✅ saved repo file only
      headshotUrl,
    });
  }

  return {
    header: "McLaren standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      teamLogo: MCLAREN_LOGO_PNG,
      headshots: `${PAGES_BASE}/${HEADSHOTS_DIR}/<file>.png (saved in repo)`,
      driverNumbers: `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-<number>.png`,
      driverStandings: "DASH_PLACEHOLDERS",
      constructorStandings: "DASH_PLACEHOLDERS",
      lastRace: "DASH_PLACEHOLDERS",
    },
    meta: {
      mode: "DASH_PLACEHOLDERS_SAVED_HEADSHOTS",
      seasonUsed: "-",
      roundUsed: "-",
      note:
        "All fields are '-' placeholders for widget building. Headshots are NOT downloaded; they are read from existing /headshots files in the repo. Driver number images are read from /driver-numbers.",
    },
    mclaren: {
      team: "McLaren",
      teamLogoPng: MCLAREN_LOGO_PNG,
      teamStanding: dashTeamStanding(),
    },
    lastRace: dashLastRace(),
    drivers,
  };
}

// ---------- Main ----------

async function updateMcLarenStandings() {
  const out = await buildDashJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateMcLarenStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});