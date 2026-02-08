// updateCadillacStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";
const OPENF1_BASE = "https://api.openf1.org/v1";

// Output JSON
const OUT_JSON = "f1_cadillac_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Local repo folders (served by Pages)
const TEAMLOGOS_DIR = "teamlogos";
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";

// ✅ Cadillac logo (LOCAL repo file via Pages)
const CADILLAC_LOGO_FILE = "2025_cadillac_color_v2.png";
const CADILLAC_LOGO_PNG = `${PAGES_BASE}/${TEAMLOGOS_DIR}/${CADILLAC_LOGO_FILE}`;

// If OpenF1 starts listing Cadillac drivers, we’ll use them.
const OPENF1_TEAM_NAME = "Cadillac";

// --- helpers ---

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

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    redirect: "follow",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}\n${text.slice(0, 200)}`);
  return JSON.parse(text);
}

// ✅ Driver number images (LOCAL repo via Pages)
function getDriverNumberImageUrl(driverNumber) {
  if (driverNumber == null || driverNumber === "-" || driverNumber === "") return null;
  return `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`;
}

// ✅ Headshots (LOCAL ONLY; no downloading)
async function getSavedHeadshotUrl(firstName, lastName) {
  const fileName = `${toSlug(firstName)}-${toSlug(lastName)}.png`;
  const localPath = `${HEADSHOTS_DIR}/${fileName}`;
  if (await exists(localPath)) {
    return `${PAGES_BASE}/${HEADSHOTS_DIR}/${fileName}`;
  }
  return null; // no placeholders
}

// --- dash placeholder builders ---

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
  return { team: "Cadillac", position: "-", points: "-", wins: "-", originalTeam: "-" };
}

// --- OpenF1 driver lookup (if Cadillac exists there) ---
// Docs allow session_key=latest; we also try meeting_key=latest as a fallback.
async function fetchCadillacDriversFromOpenF1() {
  const urlsToTry = [
    `${OPENF1_BASE}/drivers?session_key=latest&team_name=${encodeURIComponent(OPENF1_TEAM_NAME)}`,
    `${OPENF1_BASE}/drivers?meeting_key=latest&team_name=${encodeURIComponent(OPENF1_TEAM_NAME)}`,
  ];

  for (const url of urlsToTry) {
    try {
      const rows = await fetchJson(url);
      if (!Array.isArray(rows) || rows.length === 0) continue;

      // De-dupe by driver_number, keep the “latest” row if multiple show up
      const byNum = new Map();
      for (const r of rows) {
        const num = r?.driver_number;
        if (num == null) continue;
        const prev = byNum.get(num);
        const prevMk = Number(prev?.meeting_key ?? -1);
        const curMk = Number(r?.meeting_key ?? -1);
        if (!prev || curMk > prevMk) byNum.set(num, r);
      }

      const drivers = Array.from(byNum.values())
        .sort((a, b) => Number(a.driver_number) - Number(b.driver_number))
        .slice(0, 2);

      if (drivers.length) return { drivers, sourceUrl: url };
    } catch {
      // try next url
    }
  }

  return { drivers: [], sourceUrl: null };
}

// --- main JSON build ---

async function buildCadillacJson() {
  const now = new Date();

  // Your chosen placeholders until OpenF1 returns Cadillac drivers
  const fallbackDrivers = [
    { firstName: "Valtteri", lastName: "Bottas", code: "BOT", driverNumber: 77 },
    { firstName: "Sergio", lastName: "Perez", code: "PER", driverNumber: 11 },
  ];

  const { drivers: openf1Drivers, sourceUrl } = await fetchCadillacDriversFromOpenF1();

  const driversBase =
    openf1Drivers.length >= 2
      ? openf1Drivers.map((r) => ({
          firstName: r?.first_name || "-",
          lastName: r?.last_name || "-",
          code: r?.name_acronym || "-",
          driverNumber: r?.driver_number ?? "-",
          fromOpenF1: true,
        }))
      : fallbackDrivers.map((d) => ({ ...d, fromOpenF1: false }));

  const drivers = [];
  for (const d of driversBase) {
    const headshotUrl =
      d.firstName !== "-" && d.lastName !== "-" ? await getSavedHeadshotUrl(d.firstName, d.lastName) : null;

    drivers.push({
      firstName: d.firstName,
      lastName: d.lastName,
      code: d.code,
      driverNumber: d.driverNumber,

      // ✅ LOCAL driver-number images
      numberImageUrl: getDriverNumberImageUrl(d.driverNumber),

      // dash placeholders
      position: "-",
      points: "-",
      wins: "-",
      team: "Cadillac",
      placeholder: true,
      bestResult: dashBestResult(),

      // ✅ LOCAL headshot (or null)
      headshotUrl,

      // optional: lets you see whether OpenF1 supplied this driver
      fromOpenF1: Boolean(d.fromOpenF1),
    });
  }

  return {
    header: "Cadillac standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      openf1: OPENF1_BASE,
      openf1CadillacDrivers: sourceUrl || "NO_CADILLAC_DRIVERS_RETURNED_YET",
      logos: `LOCAL_ONLY: ${PAGES_BASE}/${TEAMLOGOS_DIR}/`,
      headshots: `LOCAL_ONLY: ${PAGES_BASE}/${HEADSHOTS_DIR}/<first>-<last>.png`,
      driverNumbers: `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-<number>.png`,
      driverStandings: "DASH_PLACEHOLDERS",
      constructorStandings: "DASH_PLACEHOLDERS",
      lastRace: "DASH_PLACEHOLDERS",
    },
    meta: {
      mode: openf1Drivers.length >= 2 ? "DASH_PLACEHOLDERS_OPENF1_DRIVERS_LOCAL_ASSETS" : "DASH_PLACEHOLDERS_FALLBACK_DRIVERS_LOCAL_ASSETS",
      seasonUsed: "-",
      roundUsed: "-",
      note:
        "All fields are '-' placeholders for widget building. Team logo + headshots + driver-number images are LOCAL ONLY from the repo. If OpenF1 returns Cadillac drivers (team_name=Cadillac on latest session/meeting), this file will automatically swap to those drivers while keeping local headshots + number images.",
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

// --- run ---

async function updateCadillacStandings() {
  const out = await buildCadillacJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateCadillacStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});