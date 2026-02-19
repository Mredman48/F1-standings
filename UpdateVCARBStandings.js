// UpdateVCARBStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";
const OPENF1_BASE = "https://api.openf1.org/v1";

// Output JSON
const OUT_JSON = "f1_vcarb_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Repo folders
const TEAMLOGOS_DIR = "teamlogos";
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";

// ✅ VCARB logo pulled from YOUR repo (GitHub Pages) — confirm filename
const VCARB_LOGO_PNG = `${PAGES_BASE}/${TEAMLOGOS_DIR}/2025_vcarb_color_v2.png`;

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
  return null;
}

function normalizeOpenF1TeamName(name) {
  const n = String(name || "").trim();
  if (!n) return null;
  if (
    n === "RB" ||
    n === "RB F1 Team" ||
    n === "Visa Cash App RB" ||
    n === "Visa Cash App RB F1 Team" ||
    n === "VCARB"
  ) {
    return "VCARB";
  }
  return n;
}

function pickLatestByMeetingKey(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const withKey = rows.filter((r) => r && r.meeting_key != null);
  if (withKey.length === 0) return rows;

  const maxKey = withKey.reduce((m, r) => Math.max(m, Number(r.meeting_key) || -1), -1);
  return rows.filter((r) => Number(r?.meeting_key) === maxKey);
}

async function getVcarbDriversFromOpenF1() {
  const url = `${OPENF1_BASE}/drivers?meeting_key=latest`;
  const rows = await fetchJson(url);
  const latestRows = pickLatestByMeetingKey(rows);

  const vcarb = latestRows.filter((r) => normalizeOpenF1TeamName(r?.team_name) === "VCARB");

  // Deduplicate by driver_number
  const map = new Map();
  for (const r of vcarb) {
    const num = r?.driver_number;
    if (num == null) continue;
    if (!map.has(num)) map.set(num, r);
  }

  return Array.from(map.values())
    .sort((a, b) => Number(a.driver_number) - Number(b.driver_number))
    .slice(0, 2)
    .map((r) => ({
      firstName: r?.first_name || "-",
      lastName: r?.last_name || "-",
      code: r?.name_acronym || "-",
      driverNumber: r?.driver_number ?? "-",
    }));
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

// ---------- Build JSON ----------

async function buildDashJson() {
  const now = new Date();

  // Placeholder you want to ALWAYS use when OpenF1 doesn't give 2 drivers
  const ARVID = { firstName: "Arvid", lastName: "Lindblad", code: "LIN", driverNumber: 41 };

  // 1) Try OpenF1
  let openf1Drivers = [];
  try {
    openf1Drivers = await getVcarbDriversFromOpenF1();
  } catch {
    openf1Drivers = [];
  }

  // 2) Apply your fallback rule:
  // - 2 drivers from OpenF1 -> use them
  // - 1 driver from OpenF1 -> keep it + add Arvid
  // - 0 drivers -> Arvid + dash seat
  let driversBase = [];
  if (openf1Drivers.length >= 2) {
    driversBase = openf1Drivers.slice(0, 2);
  } else if (openf1Drivers.length === 1) {
    driversBase = [openf1Drivers[0], ARVID];
  } else {
    driversBase = [ARVID];
  }

  const drivers = [];

  for (const d of driversBase) {
    const headshotUrl =
      d.firstName !== "-" && d.lastName !== "-" ? await getSavedHeadshotUrl(d) : null;

    drivers.push({
      firstName: d.firstName,
      lastName: d.lastName,
      code: d.code,
      driverNumber: d.driverNumber,

      numberImageUrl: getDriverNumberImageUrl(d.driverNumber),

      position: "-",
      points: "-",
      wins: "-",
      team: "VCARB",
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
      team: "VCARB",
      placeholder: true,
      bestResult: dashBestResult(),
      headshotUrl: null,
    });
  }

  return {
    header: "VCARB standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      logos: `LOCAL_ONLY: ${PAGES_BASE}/${TEAMLOGOS_DIR}/`,
      headshots: `LOCAL_ONLY: ${PAGES_BASE}/${HEADSHOTS_DIR}/<first>-<last>.png`,
      driverNumbers: `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-<number>.png`,
      openf1Drivers: `${OPENF1_BASE}/drivers?meeting_key=latest`,
      driverStandings: "DASH_PLACEHOLDERS",
      constructorStandings: "DASH_PLACEHOLDERS",
      lastRace: "DASH_PLACEHOLDERS",
    },
    meta: {
      mode: "DASH_PLACEHOLDERS_LOCAL_ASSETS_OPENF1_DRIVERS",
      seasonUsed: "-",
      roundUsed: "-",
      note:
        "All fields are '-' placeholders for widget building. Team logo + headshots + driver number images are LOCAL ONLY from your repo. Drivers are pulled from OpenF1 (meeting_key=latest) when available; if OpenF1 returns <2 drivers, Arvid Lindblad (#41) is used as the fallback seat.",
    },
    vcarb: {
      team: "VCARB",
      teamLogoPng: VCARB_LOGO_PNG,
      teamStanding: dashTeamStanding(),
    },
    lastRace: dashLastRace(),
    drivers,
  };
}

// ---------- Main ----------

async function updateVcarbStandings() {
  const out = await buildDashJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateVcarbStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});