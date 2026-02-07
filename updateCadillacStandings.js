// updateCadillacStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Output JSON
const OUT_JSON = "f1_cadillac_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Repo folders (LOCAL ONLY)
const TEAMLOGOS_DIR = "teamlogos";
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";

// ✅ Cadillac logo file in your repo (upload this to /teamlogos)
const CADILLAC_LOGO_FILE = "2025_cadillac_color_v2.png";

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

function pagesUrl(path) {
  return `${PAGES_BASE}/${String(path).replace(/^\/+/, "")}`;
}

function getDriverNumberImageUrl(driverNumber) {
  if (driverNumber == null || driverNumber === "-" || driverNumber === "") return null;
  return pagesUrl(`${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`);
}

async function getSavedHeadshotUrl({ firstName, lastName }) {
  const fileName = `${toSlug(firstName)}-${toSlug(lastName)}.png`;
  const localPath = `${HEADSHOTS_DIR}/${fileName}`;

  if (await exists(localPath)) return pagesUrl(localPath);
  return null; // no placeholders
}

// ---------- Dash placeholders ----------

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

async function buildCadillacJson() {
  const now = new Date();

  // ✅ Placeholder drivers (edit anytime; these are LOCAL ONLY assets)
  // Keep driverNumber "-" if you don't have a number image yet.
  const driversBase = [
    { firstName: "-", lastName: "-", code: "-", driverNumber: "-" },
    { firstName: "-", lastName: "-", code: "-", driverNumber: "-" },
  ];

  const drivers = [];
  for (const d of driversBase) {
    const headshotUrl =
      d.firstName !== "-" && d.lastName !== "-" ? await getSavedHeadshotUrl(d) : null;

    drivers.push({
      firstName: d.firstName,
      lastName: d.lastName,
      code: d.code,
      driverNumber: d.driverNumber,

      // ✅ number images from repo (or null)
      numberImageUrl: getDriverNumberImageUrl(d.driverNumber),

      // dash placeholders
      position: "-",
      points: "-",
      wins: "-",
      team: "Cadillac",
      placeholder: true,
      bestResult: dashBestResult(),

      // ✅ local-only headshot or null
      headshotUrl,
    });
  }

  return {
    header: "Cadillac standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      teamLogo: `LOCAL_ONLY: ${PAGES_BASE}/${TEAMLOGOS_DIR}/${CADILLAC_LOGO_FILE}`,
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
        "Cadillac is a placeholder team. Logos/headshots/driver numbers are LOCAL ONLY from your repo (no OpenF1, no external image URLs).",
    },
    cadillac: {
      team: "Cadillac",
      teamLogoPng: pagesUrl(`${TEAMLOGOS_DIR}/${CADILLAC_LOGO_FILE}`),
      teamStanding: dashTeamStanding(),
    },
    lastRace: dashLastRace(),
    drivers,
  };
}

// ---------- Main ----------

async function updateCadillacStandings() {
  const out = await buildCadillacJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateCadillacStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});
