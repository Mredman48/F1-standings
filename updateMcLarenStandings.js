// updateMcLarenStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Output JSON
const OUT_JSON = "f1_mclaren_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Repo folders
const TEAMLOGOS_DIR = "teamlogos";
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";

// ✅ McLaren logo pulled from YOUR repo (GitHub Pages)
const MCLAREN_LOGO_PNG = `${PAGES_BASE}/${TEAMLOGOS_DIR}/2025_mclaren_color_v2.png`;

// --- Sources ---
// Drivers (who + numbers) from OpenF1
const OPENF1_BASE = "https://api.openf1.org/v1";
const OPENF1_TEAM_NAME = "McLaren";

// Standings (positions/points/wins) from Jolpica/Ergast-compatible,
// with Ergast as secondary fallback.
const ERGAST_BASES = [
  "https://api.jolpi.ca/ergast/f1",
  "https://ergast.com/api/f1",
];

// ConstructorId for McLaren in Ergast/Jolpica
const ERGAST_CONSTRUCTOR_ID = "mclaren";

// ---------- Helpers ----------

function fmtPos(pos) {
  if (pos == null || pos === "-" || pos === "") return "-";
  const n = Number(pos);
  if (!Number.isFinite(n)) return "-";
  return `P${n}`;
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

// Repo PNG driver-number images (static)
function getDriverNumberImageUrl(driverNumber) {
  if (driverNumber == null || driverNumber === "-" || driverNumber === "") return null;
  return `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`;
}

// Headshots (LOCAL ONLY; no downloading) — only return URL if file exists in repo checkout
async function getSavedHeadshotUrl({ firstName, lastName }) {
  const fileName = `${toSlug(firstName)}-${toSlug(lastName)}.png`;
  const localPath = `${HEADSHOTS_DIR}/${fileName}`;

  if (await exists(localPath)) {
    return `${PAGES_BASE}/${HEADSHOTS_DIR}/${fileName}`;
  }
  return null;
}

// ---------- Fetch helpers ----------

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    redirect: "follow",
  });
  const text = await res.text();
  return { res, text };
}

async function fetchJsonStrict(url) {
  const { res, text } = await fetchText(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}\n${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${url}\n${text.slice(0, 200)}`);
  }
}

async function fetchFromAnyErgastBase(path) {
  let lastErr = null;
  for (const base of ERGAST_BASES) {
    const url = `${base}${path}`;
    try {
      const json = await fetchJsonStrict(url);
      return { json, urlUsed: url };
    } catch (e) {
      lastErr = e;
      console.warn(`Ergast/Jolpica fetch failed, trying next base. url=${url} err=${e.message}`);
    }
  }
  throw lastErr || new Error("All Ergast/Jolpica bases failed");
}

// OpenF1 rate-limit friendly fetch (simple backoff on 429)
async function fetchOpenF1Json(path, { retries = 4 } = {}) {
  const url = `${OPENF1_BASE}${path}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const { res, text } = await fetchText(url);

    if (res.status === 429) {
      const waitMs = 1100 + attempt * 900; // > 1s between attempts
      console.warn(`OpenF1 429. Waiting ${waitMs}ms. ${text.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}\n${text.slice(0, 200)}`);

    try {
      return { json: JSON.parse(text), urlUsed: url };
    } catch {
      throw new Error(`Invalid JSON from ${url}\n${text.slice(0, 200)}`);
    }
  }

  throw new Error(`OpenF1 rate limited too long for ${url}`);
}

// ---------- Placeholders ----------

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
    team: "McLaren",
    position: "-",
    points: "-",
    wins: "-",
    originalTeam: "-",
  };
}

// ---------- Ergast extractors ----------

function getCurrentDriverStandings(mr) {
  return mr?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? [];
}

function getCurrentConstructorStandings(mr) {
  return mr?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings ?? [];
}

function getLastRaceResult(mr) {
  const race = mr?.MRData?.RaceTable?.Races?.[0];
  if (!race) return null;

  return {
    season: race.season ?? "-",
    round: race.round ?? "-",
    raceName: race.raceName ?? "-",
    date: race.date ?? "-",
    timeUtc: race.time ?? "-",
    circuit: {
      name: race?.Circuit?.circuitName ?? "-",
      locality: race?.Circuit?.Location?.locality ?? "-",
      country: race?.Circuit?.Location?.country ?? "-",
    },
  };
}

// ---------- OpenF1: get current McLaren race drivers ----------
// OpenF1 docs support meeting_key=latest and team_name filters.  [oai_citation:1‡OpenF1](https://openf1.org/docs/?utm_source=chatgpt.com)
function pickLatestMeetingRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const withMk = rows.filter((r) => r && r.meeting_key != null);
  if (withMk.length === 0) return rows;

  const maxKey = withMk.reduce((m, r) => Math.max(m, Number(r.meeting_key) || -1), -1);
  return rows.filter((r) => Number(r?.meeting_key) === maxKey);
}

async function getMcLarenDriversFromOpenF1() {
  const res = await fetchOpenF1Json(
    `/drivers?meeting_key=latest&team_name=${encodeURIComponent(OPENF1_TEAM_NAME)}`
  );

  const rows = pickLatestMeetingRows(res.json);

  // De-dupe by driver_number (OpenF1 can return multiple rows)
  const byNum = new Map();
  for (const r of rows) {
    const num = r?.driver_number;
    if (num == null) continue;
    if (!byNum.has(num)) byNum.set(num, r);
  }

  // Sort stable + take 2 race drivers
  const drivers = Array.from(byNum.values())
    .sort((a, b) => Number(a.driver_number) - Number(b.driver_number))
    .slice(0, 2)
    .map((r) => ({
      firstName: r?.first_name ?? "-",
      lastName: r?.last_name ?? "-",
      code: (r?.name_acronym ?? "-").toUpperCase(),
      driverNumber: r?.driver_number ?? "-",
      fromOpenF1: true,
    }));

  return { drivers, urlUsed: res.urlUsed };
}

// ---------- Build JSON (OpenF1 drivers + Ergast standings) ----------

async function buildJson() {
  const now = new Date();

  let openf1Drivers = [];
  let openf1UrlUsed = null;

  // Hard fallback ONLY if OpenF1 returns nothing (rare/offline)
  const FALLBACK_DRIVERS = [
    { firstName: "Lando", lastName: "Norris", code: "NOR", driverNumber: 4, fromOpenF1: false },
    { firstName: "Oscar", lastName: "Piastri", code: "PIA", driverNumber: 81, fromOpenF1: false },
  ];

  try {
    const of1 = await getMcLarenDriversFromOpenF1();
    openf1Drivers = of1.drivers;
    openf1UrlUsed = of1.urlUsed;
  } catch (e) {
    console.warn("OpenF1 drivers fetch failed; using fallback drivers.", e.message);
    openf1Drivers = [];
  }

  const driversBase = openf1Drivers.length === 2 ? openf1Drivers : FALLBACK_DRIVERS;

  // Create driver objects (numbers from OpenF1, images from repo)
  const drivers = [];
  for (const d of driversBase) {
    const headshotUrl =
      d.firstName !== "-" && d.lastName !== "-" ? await getSavedHeadshotUrl(d) : null;

    drivers.push({
      firstName: d.firstName,
      lastName: d.lastName,
      code: d.code,
      driverNumber: d.driverNumber,

      // Number PNG from your repo, based on API-provided number
      numberImageUrl: getDriverNumberImageUrl(d.driverNumber),

      position: "-",
      points: "-",
      wins: "-",
      team: "McLaren",
      placeholder: true,
      bestResult: dashBestResult(),

      headshotUrl,

      // handy debug flag
      fromOpenF1: Boolean(d.fromOpenF1),
    });
  }

  let teamStanding = dashTeamStanding();
  let lastRace = dashLastRace();
  let placeholderMode = true;

  let urlUsed = {
    openf1Drivers: openf1UrlUsed,
    driverStandings: null,
    constructorStandings: null,
    lastRace: null,
  };

  try {
    // standings
    const ds = await fetchFromAnyErgastBase("/current/driverStandings.json");
    urlUsed.driverStandings = ds.urlUsed;
    const driverStandings = getCurrentDriverStandings(ds.json);

    const cs = await fetchFromAnyErgastBase("/current/constructorStandings.json");
    urlUsed.constructorStandings = cs.urlUsed;
    const constructorStandings = getCurrentConstructorStandings(cs.json);

    const lr = await fetchFromAnyErgastBase("/current/last/results.json");
    urlUsed.lastRace = lr.urlUsed;
    const lrParsed = getLastRaceResult(lr.json);
    if (lrParsed) lastRace = lrParsed;

    // Team standing
    const ctorRow = constructorStandings.find(
      (c) => String(c?.Constructor?.constructorId || "").toLowerCase() === ERGAST_CONSTRUCTOR_ID
    );
    if (ctorRow) {
      teamStanding = {
        team: "McLaren",
        position: fmtPos(ctorRow.position),
        points: ctorRow.points ?? "-",
        wins: ctorRow.wins ?? "-",
        originalTeam: ctorRow?.Constructor?.name ?? "McLaren",
      };
    }

    // Driver standings: match by acronym (code) first, then last name fallback
    for (const d of drivers) {
      const match = driverStandings.find((row) => {
        const code = String(row?.Driver?.code || "").toUpperCase();
        const fam = String(row?.Driver?.familyName || "").toLowerCase();
        return (code && code === d.code) || fam === String(d.lastName || "").toLowerCase();
      });

      if (match) {
        d.position = fmtPos(match.position);
        d.points = match.points ?? "-";
        d.wins = match.wins ?? "-";
        d.placeholder = false;
      }
    }

    const anyDriverLive = drivers.some((d) => d.placeholder === false);
    const teamLive = teamStanding.position !== "-" && teamStanding.points !== "-";
    placeholderMode = !(anyDriverLive || teamLive);
  } catch (e) {
    console.warn("Standings fetch failed; keeping placeholders.", e.message);
    placeholderMode = true;
  }

  return {
    header: "McLaren standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      openf1: OPENF1_BASE,
      openf1Drivers:
        urlUsed.openf1Drivers ||
        `${OPENF1_BASE}/drivers?meeting_key=latest&team_name=${encodeURIComponent(OPENF1_TEAM_NAME)}`,
      logos: `LOCAL_ONLY: ${PAGES_BASE}/${TEAMLOGOS_DIR}/`,
      headshots: `LOCAL_ONLY: ${PAGES_BASE}/${HEADSHOTS_DIR}/<first>-<last>.png`,
      driverNumbers: `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-<number>.png`,
      driverStandings: urlUsed.driverStandings || "ERGAST_COMPAT_UNAVAILABLE",
      constructorStandings: urlUsed.constructorStandings || "ERGAST_COMPAT_UNAVAILABLE",
      lastRace: urlUsed.lastRace || "ERGAST_COMPAT_UNAVAILABLE",
      note:
        "Drivers/numbers come from OpenF1. Standings come from Jolpica (Ergast-compatible) with Ergast fallback.",
    },
    meta: {
      mode: placeholderMode ? "PLACEHOLDERS_LOCAL_ASSETS" : "OPENF1_DRIVERS_ERGAST_STANDINGS_LOCAL_ASSETS",
      note:
        "Drivers are fully automatic via OpenF1 (meeting_key=latest + team_name). Positions are formatted as P1, P2, etc. Number images are always pulled from your repo using the API-provided number.",
    },
    mclaren: {
      team: "McLaren",
      teamLogoPng: MCLAREN_LOGO_PNG,
      teamStanding,
    },
    lastRace,
    drivers,
  };
}

// ---------- Main ----------

async function updateMcLarenStandings() {
  const out = await buildJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateMcLarenStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});