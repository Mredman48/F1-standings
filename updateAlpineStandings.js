// updateAlpineStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";
const OPENF1_BASE = "https://api.openf1.org/v1";

// Output JSON
const OUT_JSON = "f1_alpine_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Repo folders (served via GitHub Pages)
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";
const TEAMLOGOS_DIR = "teamlogos";

// ✅ LOCAL logo (GitHub Pages, from your repo)
const ALPINE_LOGO_PNG = `${PAGES_BASE}/${TEAMLOGOS_DIR}/2025_alpine_color_v2.png`;

// ---------- helpers ----------

function toSlug(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
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

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function getDriverNumberImageUrl(driverNumber) {
  if (driverNumber == null || driverNumber === "-" || driverNumber === "") return null;
  return `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`;
}

// ✅ LOCAL ONLY headshots (no downloading)
async function getSavedHeadshotUrl({ firstName, lastName }) {
  const fileName = `${toSlug(firstName)}-${toSlug(lastName)}.png`;
  const localPath = `${HEADSHOTS_DIR}/${fileName}`;
  if (await exists(localPath)) return `${PAGES_BASE}/${HEADSHOTS_DIR}/${fileName}`;
  return null;
}

// Pick the most recent driver row if multiple returned
function pickLatestByMeetingKey(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.reduce((best, cur) => {
    const a = Number(best?.meeting_key ?? -1);
    const b = Number(cur?.meeting_key ?? -1);
    return b > a ? cur : best;
  }, rows[0]);
}

// Try to get driver profile from OpenF1 by number (gives us name/code reliably)
async function getOpenF1DriverByNumber(driverNumber) {
  const url = `${OPENF1_BASE}/drivers?driver_number=${encodeURIComponent(driverNumber)}`;
  try {
    const rows = await fetchJson(url);
    return pickLatestByMeetingKey(rows);
  } catch {
    return null;
  }
}

// ---------- dash placeholders ----------

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
  return { team: "Alpine", position: "-", points: "-", wins: "-", originalTeam: "-" };
}

// ---------- main ----------

async function buildDashJson() {
  const now = new Date();

  // ✅ Put your Alpine driver numbers here (placeholders)
  // Update these to your correct lineup whenever you want.
  const driversBase = [
    { driverNumber: 10, fallback: { firstName: "Pierre", lastName: "Gasly", code: "GAS" } },
    { driverNumber: 7, fallback: { firstName: "Jack", lastName: "Doohan", code: "DOO" } },
  ];

  const drivers = [];

  for (const item of driversBase) {
    const n = item.driverNumber;

    // Pull identity from OpenF1 if available, otherwise fallback names/codes
    const of1 = await getOpenF1DriverByNumber(n);

    const firstName = of1?.first_name || item.fallback.firstName;
    const lastName = of1?.last_name || item.fallback.lastName;
    const code = of1?.name_acronym || item.fallback.code;

    const headshotUrl = await getSavedHeadshotUrl({ firstName, lastName });

    drivers.push({
      firstName,
      lastName,
      code,
      driverNumber: n,
      numberImageUrl: getDriverNumberImageUrl(n),

      position: "-",
      points: "-",
      wins: "-",
      team: "Alpine",
      placeholder: true,
      bestResult: dashBestResult(),

      // ✅ local-only headshot (or null)
      headshotUrl,
    });
  }

  return {
    header: "Alpine standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      openf1: OPENF1_BASE,
      logos: `LOCAL_ONLY: ${PAGES_BASE}/${TEAMLOGOS_DIR}/`,
      headshots: `LOCAL_ONLY: ${PAGES_BASE}/${HEADSHOTS_DIR}/<first>-<last>.png`,
      driverNumbers: `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-<number>.png`,
      driverStandings: "DASH_PLACEHOLDERS",
      constructorStandings: "DASH_PLACEHOLDERS",
      lastRace: "DASH_PLACEHOLDERS",
    },
    meta: {
      mode: "DASH_PLACEHOLDERS_OPENF1_IDENTITIES_LOCAL_ASSETS",
      seasonUsed: "-",
      roundUsed: "-",
      note:
        "All stats are '-' placeholders. Driver identity (name/code) is fetched from OpenF1 by driver number when available. Headshots + logos + driver-number images are LOCAL ONLY from the repo (no downloads, no sharp).",
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

async function updateAlpineStandings() {
  const out = await buildDashJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateAlpineStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});