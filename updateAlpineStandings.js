// updateAlpineStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";
const OPENF1_BASE = "https://api.openf1.org/v1";

// Output JSON
const OUT_JSON = "f1_alpine_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Local repo folders (served by Pages)
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";
const TEAMLOGOS_DIR = "teamlogos";

// ✅ LOCAL team logo (from your repo / Pages, not raw GitHub)
const ALPINE_LOGO_PNG = `${PAGES_BASE}/${TEAMLOGOS_DIR}/2025_alpine_color_v2.png`;

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

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    redirect: "follow",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}\n${text.slice(0, 200)}`);
  return JSON.parse(text);
}

// ✅ Driver number images (LOCAL)
function getDriverNumberImageUrl(driverNumber) {
  if (driverNumber == null || driverNumber === "-" || driverNumber === "") return null;
  return `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`;
}

// ✅ Headshots (LOCAL ONLY; no downloading)
async function getSavedHeadshotUrl({ firstName, lastName }) {
  const fileName = `${toSlug(firstName)}-${toSlug(lastName)}.png`;
  const localPath = `${HEADSHOTS_DIR}/${fileName}`;
  if (await exists(localPath)) return `${PAGES_BASE}/${HEADSHOTS_DIR}/${fileName}`;
  return null;
}

// ---------- OpenF1: get current drivers for a team (best-effort) ----------

function pickLatestByMeetingKey(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  // Keep only the newest meeting_key entry per driver_number
  const bestByNumber = new Map();
  for (const r of rows) {
    const num = Number(r?.driver_number);
    if (!Number.isFinite(num)) continue;

    const cur = bestByNumber.get(num);
    const curKey = Number(cur?.meeting_key ?? -1);
    const newKey = Number(r?.meeting_key ?? -1);

    if (!cur || newKey > curKey) bestByNumber.set(num, r);
  }
  return [...bestByNumber.values()];
}

async function getOpenF1TeamDrivers(teamName) {
  // OpenF1 often supports filtering by team_name; if it returns nothing, we fallback.
  const url = `${OPENF1_BASE}/drivers?team_name=${encodeURIComponent(teamName)}`;

  try {
    const rows = await fetchJson(url);
    const latest = pickLatestByMeetingKey(rows);

    // Normalize into your expected driver objects
    const drivers = latest
      .map((d) => {
        const firstName = d?.first_name || "";
        const lastName = d?.last_name || "";
        const code = d?.name_acronym || d?.country_code || "-";
        const driverNumber = Number(d?.driver_number);

        if (!firstName || !lastName || !Number.isFinite(driverNumber)) return null;

        return {
          firstName,
          lastName,
          code,
          driverNumber,
        };
      })
      .filter(Boolean);

    // Return top 2 (stable order by driver number)
    drivers.sort((a, b) => a.driverNumber - b.driverNumber);
    return drivers.slice(0, 2);
  } catch {
    return [];
  }
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
    team: "Alpine",
    position: "-",
    points: "-",
    wins: "-",
    originalTeam: "-",
  };
}

// ---------- Build JSON ----------

async function buildAlpineJson() {
  const now = new Date();

  // 1) Try to pull current Alpine drivers from OpenF1
  const openF1Drivers = await getOpenF1TeamDrivers("Alpine");

  // 2) Fallback list (only used if OpenF1 returns nothing)
  const fallbackDrivers = [
    // Update these if you want a specific offseason lineup
    { firstName: "Pierre", lastName: "Gasly", code: "GAS", driverNumber: 10 },
    { firstName: "Jack", lastName: "Doohan", code: "DOO", driverNumber: 7 },
  ];

  const driversBase = openF1Drivers.length === 2 ? openF1Drivers : fallbackDrivers;

  const drivers = [];
  for (const d of driversBase) {
    const headshotUrl = await getSavedHeadshotUrl(d);

    drivers.push({
      firstName: d.firstName,
      lastName: d.lastName,
      code: d.code,
      driverNumber: d.driverNumber,

      // ✅ local driver-number images
      numberImageUrl: getDriverNumberImageUrl(d.driverNumber),

      // dash placeholders (will be replaced once you switch to live standings later)
      position: "-",
      points: "-",
      wins: "-",
      team: "Alpine",
      placeholder: true,
      bestResult: dashBestResult(),

      // ✅ local-only headshot URL or null
      headshotUrl,
    });
  }

  // Always guarantee 2 drivers
  while (drivers.length < 2) {
    drivers.push({
      firstName: "-",
      lastName: "-",
      code: "-",
      driverNumber: "-",
      numberImageUrl: null,
      position: "-",
      points: "-",
      wins: "-",
      team: "Alpine",
      placeholder: true,
      bestResult: dashBestResult(),
      headshotUrl: null,
    });
  }

  return {
    header: "Alpine standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      openf1Drivers: `${OPENF1_BASE}/drivers?team_name=Alpine`,
      logos: `LOCAL_ONLY: ${PAGES_BASE}/${TEAMLOGOS_DIR}/`,
      headshots: `LOCAL_ONLY: ${PAGES_BASE}/${HEADSHOTS_DIR}/<first>-<last>.png`,
      driverNumbers: `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-<number>.png`,
      driverStandings: "DASH_PLACEHOLDERS",
      constructorStandings: "DASH_PLACEHOLDERS",
      lastRace: "DASH_PLACEHOLDERS",
    },
    meta: {
      mode: "DASH_PLACEHOLDERS_OPENF1_DRIVER_IDENTITY_LOCAL_ASSETS",
      seasonUsed: "-",
      roundUsed: "-",
      note:
        "Driver identity (name/code/number) is pulled from OpenF1 when available; headshots + logo + driver-number images are LOCAL ONLY from the repo. Standings fields remain '-' placeholders until you switch to live data.",
    },
    alpine: {
      team: "Alpine",
      teamLogoPng: ALPINE_LOGO_PNG,
      teamStanding: dashTeamStanding(),
    },
    lastRace: dashLastRace(),
    drivers,
  };
}

// ---------- Main ----------

async function updateAlpineStandings() {
  const out = await buildAlpineJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateAlpineStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});