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

// --- Data sources (Ergast + fallback) ---
const ERGAST_BASES = [
  "https://ergast.com/api/f1",          // primary
  "https://api.jolpi.ca/ergast/api/f1", // fallback mirror (Ergast-compatible)
];

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

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

// ✅ P1 formatting
function fmtPos(pos) {
  if (pos == null || pos === "-" || pos === "") return "-";
  const n = Number(pos);
  if (!Number.isFinite(n)) return "-";
  return `P${n}`;
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

// ---------- Ergast fetch with fallback ----------

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    redirect: "follow",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}\n${text.slice(0, 180)}`);
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

// ---------- Data extraction (Ergast response shapes) ----------

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

// ---------- Build JSON (Ergast live w/ placeholders fallback) ----------

async function buildJson() {
  const now = new Date();

  // ✅ Haas drivers placeholders (update if lineup changes)
  const driversBase = [
    { firstName: "Esteban", lastName: "Ocon", code: "OCO", driverNumber: 31 },
    { firstName: "Oliver", lastName: "Bearman", code: "BEA", driverNumber: 87 },
  ];

  // Start with placeholders
  const drivers = driversBase.map((d) => ({
    firstName: d.firstName,
    lastName: d.lastName,
    code: d.code,
    driverNumber: d.driverNumber,

    numberImageUrl: getDriverNumberImageUrl(d.driverNumber),

    position: "-",
    points: "-",
    wins: "-",
    team: "Haas",
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
    // 1) current driver standings
    const ds = await fetchFromAnyBase("/current/driverStandings.json");
    urlUsed.driverStandings = ds.urlUsed;
    const driverStandings = getCurrentDriverStandings(ds.json);

    // 2) current constructor standings
    const cs = await fetchFromAnyBase("/current/constructorStandings.json");
    urlUsed.constructorStandings = cs.urlUsed;
    const constructorStandings = getCurrentConstructorStandings(cs.json);

    // 3) last race results (for context)
    const lr = await fetchFromAnyBase("/current/last/results.json");
    urlUsed.lastRace = lr.urlUsed;
    const lrParsed = getLastRaceResult(lr.json);
    if (lrParsed) lastRace = lrParsed;

    // Fill team standing (constructorId for Haas is typically "haas")
    const haasCtor = constructorStandings.find(
      (c) => String(c?.Constructor?.constructorId || "").toLowerCase() === "haas"
    );

    if (haasCtor) {
      teamStanding = {
        team: "Haas",
        position: fmtPos(haasCtor.position),
        points: haasCtor.points ?? "-",
        wins: haasCtor.wins ?? "-",
        originalTeam: haasCtor?.Constructor?.name ?? "Haas",
      };
    }

    // Fill driver standing rows by matching lastname/code
    for (const d of drivers) {
      const match = driverStandings.find((row) => {
        const code = String(row?.Driver?.code || "").toUpperCase();
        const fam = String(row?.Driver?.familyName || "").toLowerCase();
        return code === d.code || fam === d.lastName.toLowerCase();
      });

      if (match) {
        d.position = fmtPos(match.position);
        d.points = match.points ?? "-";
        d.wins = match.wins ?? "-";
        d.placeholder = false;

        d.bestResult = dashBestResult();
      }
    }

    // If ANY driver got real data OR team got real data, consider it live
    const anyDriverLive = drivers.some((d) => d.placeholder === false);
    const teamLive = teamStanding.position !== "-" && teamStanding.points !== "-";
    placeholderMode = !(anyDriverLive || teamLive);
  } catch (e) {
    console.warn("Standings fetch failed; keeping placeholders.", e.message);
    placeholderMode = true;
  }

  return {
    header: "Haas standings",
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
        "Before the first race (or if data is unavailable), outputs '-' placeholders. After the first race, fills positions/points/wins from current standings. Positions formatted as P1, P2, etc.",
    },
    haas: {
      team: "Haas",
      teamLogoPng: getTeamLogoUrl(HAAS_LOGO_FILE),
      teamStanding,
    },
    lastRace,
    drivers,
  };
}

// ---------- Main ----------

async function updateHaasStandings() {
  const out = await buildJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateHaasStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});