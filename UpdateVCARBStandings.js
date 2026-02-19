// updateVCARBStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Output JSON (keep naming consistent with your other endpoints style)
const OUT_JSON = "vcarb_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Repo folders
const TEAMLOGOS_DIR = "teamlogos";
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";

// ✅ VCARB/Racing Bulls logo pulled from YOUR repo (GitHub Pages)
// Update filename if yours differs:
const VCARB_LOGO_PNG = `${PAGES_BASE}/${TEAMLOGOS_DIR}/2025_vcarb_color_v1.png`;

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
    team: "VCARB",
    position: "-",
    points: "-",
    wins: "-",
    originalTeam: "-",
  };
}

// ---------- Core: enforce exactly two placeholder drivers if empty ----------
function ensurePlaceholders(drivers) {
  // If we already have >= 2 drivers, leave it alone.
  if (Array.isArray(drivers) && drivers.length >= 2) return drivers;

  // Always return exactly two placeholders (Liam Lawson + Arvid Lindblad)
  // NOTE: You specified Arvid's number is 41.
  return [
    {
      firstName: "Liam",
      lastName: "Lawson",
      code: "LAW",
      driverNumber: 30,
      numberImageUrl: getDriverNumberImageUrl(30),
      position: "-",
      points: "-",
      wins: "-",
      team: "Racing Bulls", // also known as VCARB
      placeholder: true,
      bestResult: dashBestResult(),
      headshotUrl: null,
    },
    {
      firstName: "Arvid",
      lastName: "Lindblad",
      code: "LIN",
      driverNumber: 41,
      numberImageUrl: getDriverNumberImageUrl(41),
      position: "-",
      points: "-",
      wins: "-",
      team: "Racing Bulls",
      placeholder: true,
      bestResult: dashBestResult(),
      headshotUrl: null,
    },
  ];
}

// ---------- Build JSON ----------

async function buildDashJson() {
  const now = new Date();

  // ✅ If you later wire live data, replace this list with fetched results.
  // For now, this is a base list (placeholders) that can be overridden by live results.
  // These are placeholders until your live source is stable.
  const driversBase = []; // intentionally empty by default

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
      team: d.team || "Racing Bulls",
      placeholder: true,
      bestResult: dashBestResult(),

      // ✅ local-only headshot URL or null
      headshotUrl,
    });
  }

  const finalDrivers = ensurePlaceholders(drivers);

  // Attempt local headshots for placeholders too (optional, still local-only)
  for (const dr of finalDrivers) {
    if (!dr.headshotUrl) {
      dr.headshotUrl = await getSavedHeadshotUrl({
        firstName: dr.firstName,
        lastName: dr.lastName,
      });
    }
  }

  return {
    header: "VCARB standings",
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
      teamAliases: ["VCARB", "Racing Bulls"],
      note:
        "All fields are '-' placeholders for widget building. Team logo + headshots + driver number images are LOCAL ONLY from your repo. If no drivers are available, placeholders are Liam Lawson (#30) and Arvid Lindblad (#41).",
    },
    vcarb: {
      team: "VCARB",
      teamAliases: ["Racing Bulls"],
      teamLogoPng: VCARB_LOGO_PNG,
      teamStanding: dashTeamStanding(),
    },
    lastRace: dashLastRace(),
    drivers: finalDrivers,
  };
}

// ---------- Main ----------

async function updateVCARBStandings() {
  const out = await buildDashJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateVCARBStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});