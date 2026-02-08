// updateAlpineStandings.js
import fs from "node:fs/promises";
import path from "node:path";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";
const OPENF1_BASE = "https://api.openf1.org/v1";

const OUT_JSON = "f1_alpine_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Repo folders
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";
const TEAMLOGOS_DIR = "teamlogos";

// ✅ LOCAL Alpine logo (repo Pages)
const ALPINE_LOGO_PNG = `${PAGES_BASE}/${TEAMLOGOS_DIR}/2025_alpine_color_v2.png`;

// Widgy cache bust toggle
const CACHE_BUST = true;

// OpenF1 team name
const OPENF1_TEAM_NAME = "Alpine";

/* ---------------- Helpers ---------------- */

function withCacheBust(url) {
  if (!url) return url;
  return CACHE_BUST ? `${url}?v=${Date.now()}` : url;
}

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
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}\n${text.slice(0, 200)}`);

  return JSON.parse(text);
}

async function fetchBinary(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/* ---------------- Local Asset URLs ---------------- */

function getDriverNumberImageUrl(driverNumber) {
  if (!driverNumber || driverNumber === "-") return null;
  return withCacheBust(
    `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`
  );
}

/* ---------------- OpenF1 Alpine Drivers ---------------- */

async function getAlpineDriversFromOpenF1() {
  const url = `${OPENF1_BASE}/drivers?meeting_key=latest&team_name=${encodeURIComponent(
    OPENF1_TEAM_NAME
  )}`;

  const rows = await fetchJson(url);

  // Deduplicate by driver_number
  const map = new Map();
  for (const r of rows) {
    const num = r?.driver_number;
    if (!num) continue;
    if (!map.has(num)) map.set(num, r);
  }

  // Return exactly 2 drivers
  return Array.from(map.values()).slice(0, 2);
}

/* ---------------- Headshot Saver (NO sharp) ---------------- */

async function saveHeadshot({ firstName, lastName, headshotUrl }) {
  if (!headshotUrl) return null;

  const fileName = `${toSlug(firstName)}-${toSlug(lastName)}.png`;
  const localPath = path.join(HEADSHOTS_DIR, fileName);

  await ensureDir(HEADSHOTS_DIR);

  // Download and save directly
  const buf = await fetchBinary(headshotUrl);
  await fs.writeFile(localPath, buf);

  return withCacheBust(`${PAGES_BASE}/${HEADSHOTS_DIR}/${fileName}`);
}

/* ---------------- Dash Placeholders ---------------- */

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

/* ---------------- Build JSON ---------------- */

async function buildJson() {
  const now = new Date();

  let openf1Drivers = [];
  try {
    openf1Drivers = await getAlpineDriversFromOpenF1();
  } catch {
    openf1Drivers = [];
  }

  const drivers = [];

  for (const r of openf1Drivers) {
    const firstName = r?.first_name || "-";
    const lastName = r?.last_name || "-";
    const code = r?.name_acronym || "-";
    const driverNumber = r?.driver_number || "-";

    // Save headshot locally if provided
    let headshotUrl = null;
    if (firstName !== "-" && lastName !== "-" && r?.headshot_url) {
      headshotUrl = await saveHeadshot({
        firstName,
        lastName,
        headshotUrl: r.headshot_url,
      });
    }

    drivers.push({
      firstName,
      lastName,
      code,
      driverNumber,

      numberImageUrl: getDriverNumberImageUrl(driverNumber),

      position: "-",
      points: "-",
      wins: "-",
      team: "Alpine",
      placeholder: true,
      bestResult: dashBestResult(),

      headshotUrl,
    });
  }

  // Pad to exactly 2 drivers
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
      openf1: OPENF1_BASE,
      drivers: `${OPENF1_BASE}/drivers?meeting_key=latest&team_name=Alpine`,
      logos: `LOCAL_ONLY: ${PAGES_BASE}/${TEAMLOGOS_DIR}/`,
      headshots: `Saved locally into /headshots`,
      driverNumbers: `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-<number>.png`,
    },
    meta: {
      mode: "DASH_PLACEHOLDERS_OPENF1_DRIVERS",
      note:
        "Drivers pulled from OpenF1, headshots saved locally, all standings fields remain dash placeholders until season data is available.",
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

/* ---------------- Main ---------------- */

async function updateAlpineStandings() {
  const out = await buildJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateAlpineStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});