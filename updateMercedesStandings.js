// updateMercedesStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Output JSON
const OUT_JSON = "f1_mercedes_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Repo folders
const TEAMLOGOS_DIR = "teamlogos";
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";

// ✅ Mercedes logo pulled from YOUR repo (GitHub Pages)
const MERCEDES_LOGO_PNG = `${PAGES_BASE}/${TEAMLOGOS_DIR}/2025_mercedes_color_v2.png`;

// ---------- Helpers ----------

function toSlug(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
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
  return `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`;
}

// ✅ Headshots (LOCAL ONLY; no downloading)
async function getSavedHeadshotUrl({ firstName, lastName }) {
  const fileName = `${toSlug(firstName)}-${toSlug(lastName)}.png`;
  const localPath = `${HEADSHOTS_DIR}/${fileName}`;

  if (await exists(localPath)) {
    return `${PAGES_BASE}/${HEADSHOTS_DIR}/${fileName}`;
  }
  return null; // no placeholders
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
    team: "Mercedes",
    position: "-",
    points: "-",
    wins: "-",
    originalTeam: "-",
  };
}

// ---------- Build JSON ----------

async function buildDashJson() {
  const now = new Date();

  // ✅ Mercedes drivers (edit if needed)
  const driversBase = [
    { firstName: "George", lastName: "Russell", code: "RUS", driverNumber: 63 },
    { firstName: "Andrea", lastName: "Kimi Antonelli", code: "ANT", driverNumber: 12 },
  ];

  const drivers = [];

  for (const d of driversBase) {
    const headshotUrl = await getSavedHeadshotUrl(d);

    drivers.push({
      firstName: d.firstName,
      lastName: d.lastName,
      code: d.code,
      driverNumber: d.driverNumber,

      // ✅ repo driver-number images
      numberImageUrl: getDriverNumberImageUrl(d.driverNumber),

      // dash placeholders
      position: "-",
      points: "-",
      wins: "-",
      team: "Mercedes",
      placeholder: true,
      bestResult: dashBestResult(),

      // ✅ local-only headshot URL or null
      headshotUrl,
    });
  }

  return {
    header: "Mercedes standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      logos: `LOCAL_ONLY: ${PAGES_BASE}/${TEAMLOGOS_DIR}/`,
      headshots: `LOCAL_ONLY: ${PAGES_BASE}/${HEADSHOTS_DIR}/<first>-<last>.png`,
      driverNumbers: `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-<number>.png`,
      driverStandings: "DASH_PLACEHOLDERS",
      constructorStandings: "DASH_PLACEHOLDERS",
      lastRace: "DASH_PLACEHOLDERS",
    },
    meta: {
      mode: "DASH_PLACEHOLDERS_LOCAL_HEADSHOTS_LOCAL_LOGO",
      seasonUsed: "-",
      roundUsed: "-",
      note:
        "All fields are '-' placeholders for widget building. Team logo + headshots + driver number images are LOCAL ONLY from your repo (no OpenF1, no downloading).",
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

// ---------- Main ----------

async function updateMercedesStandings() {
  const out = await buildDashJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateMercedesStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});
