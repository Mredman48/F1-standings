// updateMercedesStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Output JSON
const OUT_JSON = "f1_mercedes_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// ✅ Mercedes logo URL (unchanged)
const MERCEDES_LOGO_PNG =
  "https://raw.githubusercontent.com/Mredman48/F1-standings/refs/heads/main/teamlogos/2025_mercedes_color_v2.png";

// Repo folders
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBERS_DIR = "driver-numbers";

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

// ---------- Repo-saved headshots (NO INTERNET) ----------
// Looks for: headshots/<first>-<last>.png
// Returns Pages URL if file exists, else null.
async function getSavedHeadshotUrl({ firstName, lastName }) {
  const fileName = `${toSlug(firstName)}-${toSlug(lastName)}.png`;
  const localPath = `${HEADSHOTS_DIR}/${fileName}`;

  if (await exists(localPath)) {
    return `${PAGES_BASE}/${HEADSHOTS_DIR}/${fileName}`;
  }
  return null; // no placeholders
}

// ---------- Driver Number PNG URL ----------

function getDriverNumberImageUrl(driverNumber) {
  if (driverNumber == null || driverNumber === "-" || driverNumber === "") return null;
  return `${PAGES_BASE}/${DRIVER_NUMBERS_DIR}/driver-number-${driverNumber}.png`;
}

// ---------- Dash Placeholder Builders ----------

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

async function buildMercedesJson() {
  const now = new Date();

  // Mercedes driver lineup
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

      // ✅ Driver number image from your repo folder
      driverNumberImage: getDriverNumberImageUrl(d.driverNumber),

      // Dash placeholders
      position: "-",
      points: "-",
      wins: "-",
      team: "Mercedes",
      placeholder: true,
      bestResult: dashBestResult(),

      // ✅ Repo-saved headshot URL or null
      headshotUrl,
    });
  }

  return {
    header: "Mercedes standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      headshots: `LOCAL_ONLY: ${PAGES_BASE}/${HEADSHOTS_DIR}/<first>-<last>.png`,
      driverNumbers: `${PAGES_BASE}/${DRIVER_NUMBERS_DIR}/driver-number-<number>.png`,
      driverStandings: "DASH_PLACEHOLDERS",
      constructorStandings: "DASH_PLACEHOLDERS",
      lastRace: "DASH_PLACEHOLDERS",
    },
    meta: {
      mode: "DASH_PLACEHOLDERS_LOCAL_HEADSHOTS",
      seasonUsed: "-",
      roundUsed: "-",
      note:
        "All stats are '-' placeholders for widget building. Headshots are LOCAL ONLY from /headshots in the repo. No OpenF1, no downloading, no placeholder images.",
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
  const out = await buildMercedesJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateMercedesStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});
