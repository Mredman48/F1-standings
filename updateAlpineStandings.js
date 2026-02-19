// updateAlpineStandings.js
import fs from "node:fs/promises";

const OUT_JSON = "f1_alpine_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Repo folders
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";
const TEAMLOGOS_DIR = "teamlogos";

// CDN/Widgy cache-busting
const CACHE_BUST = true;

// Local Alpine logo on Pages
const ALPINE_LOGO_FILE = "2025_alpine_color_v2.png";

// Ergast + fallback (Ergast-compatible Jolpica)
const ERGAST_BASES = [
  "https://ergast.com/api/f1",
  "https://api.jolpi.ca/ergast/api/f1",
];

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// ✅ Pin lineup to avoid reserves
const PREFERRED_DRIVERS = [
  { firstName: "Pierre", lastName: "Gasly", code: "GAS", driverNumber: 10 },
  { firstName: "Franco", lastName: "Colapinto", code: "COL", driverNumber: 43 },
];

// Ergast constructorId for Alpine is typically "alpine"
const ERGAST_CONSTRUCTOR_ID = "alpine";

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

function getTeamLogoUrl(fileName) {
  return withCacheBust(`${PAGES_BASE}/${TEAMLOGOS_DIR}/${fileName}`);
}

function getDriverNumberImageUrl(driverNumber) {
  if (driverNumber == null || driverNumber === "-" || driverNumber === "") return null;
  return withCacheBust(`${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`);
}

function getSavedHeadshotUrl(firstName, lastName) {
  const fileName = `${toSlug(firstName)}-${toSlug(lastName)}.png`;
  return withCacheBust(`${PAGES_BASE}/${HEADSHOTS_DIR}/${fileName}`);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    redirect: "follow",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} from ${url}\n${text.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchFromAnyBase(path) {
  let lastErr = null;
  for (const base of ERGAST_BASES) {
    const url = `${base}${path}`;
    try {
      const json = await fetchJson(url);
      return { json, urlUsed: url };
    } catch (e) {
      lastErr = e;
      console.warn(`Fetch failed, trying next base. url=${url} err=${e.message}`);
    }
  }
  throw lastErr || new Error("All Ergast bases failed");
}

// ---------- dash placeholder builders ----------

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

// ---------- Build JSON (Ergast live, placeholders fallback) ----------

async function buildJson() {
  const now = new Date();

  // Start with pinned lineup placeholders
  const drivers = PREFERRED_DRIVERS.map((d) => ({
    firstName: d.firstName,
    lastName: d.lastName,
    code: d.code,
    driverNumber: d.driverNumber,

    numberImageUrl: getDriverNumberImageUrl(d.driverNumber),

    position: "-",
    points: "-",
    wins: "-",
    team: "Alpine",
    placeholder: true,
    bestResult: dashBestResult(),

    headshotUrl: getSavedHeadshotUrl(d.firstName, d.lastName),
  }));

  let teamStanding = dashTeamStanding();
  let lastRace = dashLastRace();
  let placeholderMode = true;

  let urlUsed = {
    driverStandings: null,
    constructorStandings: null,
    lastRace: null,
  };

  try {
    // Driver standings (current)
    const ds = await fetchFromAnyBase("/current/driverStandings.json");
    urlUsed.driverStandings = ds.urlUsed;
    const driverStandings = getCurrentDriverStandings(ds.json);

    // Constructor standings (current)
    const cs = await fetchFromAnyBase("/current/constructorStandings.json");
    urlUsed.constructorStandings = cs.urlUsed;
    const constructorStandings = getCurrentConstructorStandings(cs.json);

    // Last race result
    const lr = await fetchFromAnyBase("/current/last/results.json");
    urlUsed.lastRace = lr.urlUsed;
    const lrParsed = getLastRaceResult(lr.json);
    if (lrParsed) lastRace = lrParsed;

    // Team row
    const alpineCtor = constructorStandings.find(
      (c) => String(c?.Constructor?.constructorId || "").toLowerCase() === ERGAST_CONSTRUCTOR_ID
    );

    if (alpineCtor) {
      teamStanding = {
        team: "Alpine",
        position: alpineCtor.position ?? "-",
        points: alpineCtor.points ?? "-",
        wins: alpineCtor.wins ?? "-",
        originalTeam: alpineCtor?.Constructor?.name ?? "Alpine",
      };
    }

    // Driver rows (match by code or familyName)
    for (const d of drivers) {
      const match = driverStandings.find((row) => {
        const code = String(row?.Driver?.code || "").toUpperCase();
        const fam = String(row?.Driver?.familyName || "").toLowerCase();
        return code === d.code || fam === d.lastName.toLowerCase();
      });

      if (match) {
        d.position = match.position ?? "-";
        d.points = match.points ?? "-";
        d.wins = match.wins ?? "-";
        d.placeholder = false;
      }
    }

    const anyDriverLive = drivers.some((d) => d.placeholder === false);
    const teamLive = teamStanding.position !== "-" && teamStanding.points !== "-";
    placeholderMode = !(anyDriverLive || teamLive);
  } catch (e) {
    console.warn("Ergast fetch failed; keeping placeholders.", e.message);
    placeholderMode = true;
  }

  return {
    header: "Alpine standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      logos: `LOCAL_ONLY: ${PAGES_BASE}/${TEAMLOGOS_DIR}/`,
      headshots: `LOCAL_ONLY: ${PAGES_BASE}/${HEADSHOTS_DIR}/<first>-<last>.png`,
      driverNumbers: `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-<number>.png`,
      driverStandings: urlUsed.driverStandings || "ERGAST_UNAVAILABLE",
      constructorStandings: urlUsed.constructorStandings || "ERGAST_UNAVAILABLE",
      lastRace: urlUsed.lastRace || "ERGAST_UNAVAILABLE",
      note: "Uses Ergast current standings with Jolpica fallback (Ergast-compatible).",
    },
    meta: {
      mode: placeholderMode ? "PLACEHOLDERS_LOCAL_ASSETS" : "ERGAST_LIVE_LOCAL_ASSETS",
      cacheBust: CACHE_BUST,
      note:
        "Before the first race (or if data is unavailable), outputs '-' placeholders. After the first race, fills positions/points/wins from current standings. Lineup is pinned to avoid reserve/test drivers.",
    },
    alpine: {
      team: "Alpine",
      teamLogoPng: getTeamLogoUrl(ALPINE_LOGO_FILE),
      teamStanding,
    },
    lastRace,
    drivers,
  };
}

// ---------- Main ----------

async function updateAlpineStandings() {
  const out = await buildJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateAlpineStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});