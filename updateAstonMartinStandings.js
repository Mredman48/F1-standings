// updateAstonMartinStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// ✅ Aston Martin logo (your repo file)
const ASTONMARTIN_LOGO_PNG =
  "https://raw.githubusercontent.com/Mredman48/F1-standings/refs/heads/main/teamlogos/2025_aston-martin_color_v2.png";

// Output JSON
const OUT_JSON = "f1_astonmartin_standings.json";

// Repo folders
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

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
    team: "Aston Martin",
    position: "-",
    points: "-",
    wins: "-",
    originalTeam: "-",
  };
}

// ---------- Build JSON (same structure, dashes) ----------

async function buildDashJson() {
  const now = new Date();

  // ✅ Aston Martin drivers (edit if your lineup differs)
  const driversBase = [
    { firstName: "Fernando", lastName: "Alonso", code: "ALO", driverNumber: 14 },
    { firstName: "Lance", lastName: "Stroll", code: "STR", driverNumber: 18 },
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
      team: "Aston Martin",
      placeholder: true,
      bestResult: dashBestResult(),

      // ✅ local-only headshot URL or null
      headshotUrl,
    });
  }

  return {
    header: "Aston Martin standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      headshots: `LOCAL_ONLY: ${PAGES_BASE}/${HEADSHOTS_DIR}/<first>-<last>.png`,
      driverNumbers: `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-<number>.png`,
      driverStandings: "DASH_PLACEHOLDERS",
      constructorStandings: "DASH_PLACEHOLDERS",
      lastRace: "DASH_PLACEHOLDERS",
    },
    meta: {
      mode: "DASH_PLACEHOLDERS_LOCAL_HEADSHOTS",
      seasonUsed: "-",
      roundUsed: "-",
      note:
        "All fields are '-' placeholders for widget building. Headshots are LOCAL ONLY from /headshots in the repo (no OpenF1, no downloading). Driver number images are loaded from /driver-numbers.",
    },
    astonmartin: {
      team: "Aston Martin",
      teamLogoPng: ASTONMARTIN_LOGO_PNG,
      teamStanding: dashTeamStanding(),
    },
    lastRace: dashLastRace(),
    drivers,
  };
}

// ---------- Main ----------

async function updateAstonMartinStandings() {
  const out = await buildDashJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateAstonMartinStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});
