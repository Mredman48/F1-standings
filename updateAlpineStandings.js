// updateAlpineStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";
const OPENF1_BASE = "https://api.openf1.org/v1";

// Output JSON
const OUT_JSON = "f1_alpine_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Repo folders
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";
const TEAMLOGOS_DIR = "teamlogos";

// Local logo on Pages
const CACHE_BUST = true;
const ALPINE_LOGO_PNG = `${PAGES_BASE}/${TEAMLOGOS_DIR}/2025_alpine_color_v2.png`;

// OpenF1 team name filter
const OPENF1_TEAM_NAME = "Alpine";

// ✅ Prefer the actual race lineup (prevents Paul Aron / reserves showing up)
const PREFERRED_DRIVERS = [
  { firstName: "Pierre", lastName: "Gasly", code: "GAS", driverNumber: 10 },
  { firstName: "Franco", lastName: "Colapinto", code: "COL", driverNumber: 43 },
];

// ---------- helpers ----------

function withCacheBust(url) {
  if (!url) return url;
  return CACHE_BUST ? `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}` : url;
}

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

// ✅ Driver number images (repo-saved)
function getDriverNumberImageUrl(driverNumber) {
  if (driverNumber == null || driverNumber === "-" || driverNumber === "") return null;
  return withCacheBust(`${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`);
}

// ✅ Headshots (LOCAL ONLY; no downloading)
async function getSavedHeadshotUrl({ firstName, lastName }) {
  if (!firstName || !lastName || firstName === "-" || lastName === "-") return null;
  const fileName = `${toSlug(firstName)}-${toSlug(lastName)}.png`;
  const localPath = `${HEADSHOTS_DIR}/${fileName}`;

  if (await exists(localPath)) {
    return withCacheBust(`${PAGES_BASE}/${HEADSHOTS_DIR}/${fileName}`);
  }
  return null; // no placeholders
}

// ---------- OpenF1: drivers ----------

function pickLatestByMeetingKey(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const withKey = rows.filter((r) => r && r.meeting_key != null);
  if (withKey.length === 0) return rows;

  const maxKey = withKey.reduce((m, r) => Math.max(m, Number(r.meeting_key) || -1), -1);
  return rows.filter((r) => Number(r?.meeting_key) === maxKey);
}

async function getAlpineDriversFromOpenF1() {
  const url = `${OPENF1_BASE}/drivers?meeting_key=latest&team_name=${encodeURIComponent(
    OPENF1_TEAM_NAME
  )}`;

  const rows = await fetchJson(url);
  const latestRows = pickLatestByMeetingKey(rows);

  // Deduplicate by driver_number (OpenF1 can return multiple rows)
  const byNum = new Map();
  for (const r of latestRows) {
    const num = r?.driver_number;
    if (num == null) continue;
    if (!byNum.has(num)) byNum.set(num, r);
  }

  return Array.from(byNum.values());
}

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

async function buildDashJson() {
  const now = new Date();

  let openf1Rows = [];
  try {
    openf1Rows = await getAlpineDriversFromOpenF1();
  } catch {
    openf1Rows = [];
  }

  // Index OpenF1 by driver_number for quick lookup
  const openf1ByNum = new Map(openf1Rows.map((r) => [Number(r.driver_number), r]));

  // 1) Take preferred drivers if OpenF1 returned them
  // 2) If OpenF1 didn’t return them (offseason weirdness), still output preferred lineup
  const selected = PREFERRED_DRIVERS.map((p) => {
    const r = openf1ByNum.get(Number(p.driverNumber));
    return {
      firstName: r?.first_name || p.firstName,
      lastName: r?.last_name || p.lastName,
      code: r?.name_acronym || p.code,
      driverNumber: r?.driver_number ?? p.driverNumber,
    };
  });

  const drivers = [];
  for (const d of selected) {
    const headshotUrl = await getSavedHeadshotUrl(d);

    drivers.push({
      firstName: d.firstName,
      lastName: d.lastName,
      code: d.code,
      driverNumber: d.driverNumber,

      numberImageUrl: getDriverNumberImageUrl(d.driverNumber),

      // dash placeholders
      position: "-",
      points: "-",
      wins: "-",
      team: "Alpine",
      placeholder: true,
      bestResult: dashBestResult(),

      // local-only headshot
      headshotUrl,
    });
  }

  return {
    header: "Alpine standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      openf1: OPENF1_BASE,
      drivers: `${OPENF1_BASE}/drivers?meeting_key=latest&team_name=${encodeURIComponent(
        OPENF1_TEAM_NAME
      )}`,
      headshots: `LOCAL_ONLY: ${PAGES_BASE}/${HEADSHOTS_DIR}/<first>-<last>.png`,
      driverNumbers: `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-<number>.png`,
      logos: `LOCAL_ONLY: ${PAGES_BASE}/${TEAMLOGOS_DIR}/`,
      driverStandings: "DASH_PLACEHOLDERS",
      constructorStandings: "DASH_PLACEHOLDERS",
      lastRace: "DASH_PLACEHOLDERS",
    },
    meta: {
      mode: "DASH_PLACEHOLDERS_OPENF1_DRIVERS_LOCAL_ASSETS",
      cacheBust: CACHE_BUST,
      note:
        "Standings fields are '-' placeholders. Driver identity is pulled from OpenF1, but lineup is pinned to the race drivers to avoid reserve/test results. Headshots + logo + driver numbers are LOCAL ONLY from repo folders.",
    },
    alpine: {
      team: "Alpine",
      teamLogoPng: withCacheBust(ALPINE_LOGO_PNG),
      teamStanding: dashTeamStanding(),
    },
    lastRace: dashLastRace(),
    drivers,
  };
}

// ---------- Main ----------

async function updateAlpineStandings() {
  const out = await buildDashJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateAlpineStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});