// updateCadillacStandings.js
import fs from "node:fs/promises";

const OUT_JSON = "f1_cadillac_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Repo folders
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";
const TEAMLOGOS_DIR = "teamlogos";

// ✅ Cadillac logo served from your GitHub Pages repo (NOT F1 / NOT external)
const CADILLAC_LOGO_PNG = `${PAGES_BASE}/${TEAMLOGOS_DIR}/2025_cadillac_color_v2.png`;

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

// ✅ driver-number images (repo-saved)
function getDriverNumberImageUrl(driverNumber) {
  if (driverNumber == null || driverNumber === "-" || driverNumber === "") return null;
  return `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`;
}

// ✅ headshots (LOCAL ONLY; no downloading)
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
    team: "Cadillac",
    position: "-",
    points: "-",
    wins: "-",
    originalTeam: "-",
  };
}

// ---------- Build JSON ----------

async function buildDashJson() {
  const now = new Date();

  // ✅ Cadillac placeholder drivers
  // Reported lineup: Bottas (#77) and Perez (#11)
  const driversBase = [
    { firstName: "Valtteri", lastName: "Bottas", code: "BOT", driverNumber: 77 },
    { firstName: "Sergio", lastName: "Perez", code: "PER", driverNumber: 11 },
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

      // placeholders
      position: "-",
      points: "-",
      wins: "-",
      team: "Cadillac",
      placeholder: true,
      bestResult: dashBestResult(),

      // ✅ local-only headshot URL or null
      headshotUrl,
    });
  }

  return {
    header: "Cadillac standings",
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
      mode: "DASH_PLACEHOLDERS_LOCAL_ASSETS",
      seasonUsed: "-",
      roundUsed: "-",
      note:
        "All fields are '-' placeholders for widget building. Headshots + team logo + driver-number images are LOCAL ONLY from the repo (no OpenF1, no external logos).",
    },
    cadillac: {
      team: "Cadillac",
      teamLogoPng: CADILLAC_LOGO_PNG,
      teamStanding: dashTeamStanding(),
    },
    lastRace: dashLastRace(),
    drivers,
  };
}

// ---------- Main ----------

async function updateCadillacStandings() {
  const out = await buildDashJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateCadillacStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});
