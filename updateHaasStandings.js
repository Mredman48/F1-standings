// updateHaasStandings.js
import fs from "node:fs/promises";

const OUT_JSON = "f1_haas_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Repo folders
const TEAMLOGOS_DIR = "teamlogos";
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";

// Turn on if Widgy/GitHub CDN is stubborn
const CACHE_BUST = true;

// ✅ Haas logo (LOCAL repo file)
const HAAS_LOGO_FILE = "2025_haas_color_v2.png";

// ---------- Helpers ----------

function toSlug(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function withCacheBust(url) {
  if (!url) return url;
  return CACHE_BUST ? `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}` : url;
}

// ✅ Logos from repo (GitHub Pages)
function getTeamLogoUrl(fileName) {
  return withCacheBust(`${PAGES_BASE}/${TEAMLOGOS_DIR}/${fileName}`);
}

// ✅ Driver number images from repo (GitHub Pages)
function getDriverNumberImageUrl(driverNumber) {
  if (driverNumber == null || driverNumber === "-" || driverNumber === "") return null;
  return withCacheBust(
    `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`
  );
}

// ✅ Headshots from repo (GitHub Pages) — NO CHECKS
function getSavedHeadshotUrl(firstName, lastName) {
  const fileName = `${toSlug(firstName)}-${toSlug(lastName)}.png`;
  return withCacheBust(`${PAGES_BASE}/${HEADSHOTS_DIR}/${fileName}`);
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
    team: "Haas",
    position: "-",
    points: "-",
    wins: "-",
    originalTeam: "-",
  };
}

// ---------- Build JSON (placeholders, local assets) ----------

async function buildDashJson() {
  const now = new Date();

  // ✅ Haas drivers (edit if your lineup differs)
  const driversBase = [
    { firstName: "Esteban", lastName: "Ocon", code: "OCO", driverNumber: 31 },
    { firstName: "Oliver", lastName: "Bearman", code: "BEA", driverNumber: 87 },
  ];

  const drivers = driversBase.map((d) => ({
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
    team: "Haas",
    placeholder: true,
    bestResult: dashBestResult(),

    // ✅ repo headshots (no downloading)
    headshotUrl: getSavedHeadshotUrl(d.firstName, d.lastName),
  }));

  return {
    header: "Haas standings",
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
      cacheBust: CACHE_BUST,
      note:
        "All stats are '-' placeholders for widget building. Team logo, driver headshots, and driver-number images are pulled from repo-hosted GitHub Pages URLs (no OpenF1, no downloading).",
    },
    haas: {
      team: "Haas",
      teamLogoPng: getTeamLogoUrl(HAAS_LOGO_FILE),
      teamStanding: dashTeamStanding(),
    },
    lastRace: dashLastRace(),
    drivers,
  };
}

// ---------- Main ----------

async function updateHaasStandings() {
  const out = await buildDashJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateHaasStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});
