// updateAudiStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Output JSON
const OUT_JSON = "f1_audi_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Repo folders
const TEAMLOGOS_DIR = "teamlogos";
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";

// Cache-bust for stubborn CDNs/Widgy
const CACHE_BUST = true;

// ✅ Audi logo pulled from YOUR repo (GitHub Pages)
const AUDI_LOGO_FILE = "audi_logo_colored.png";

// Ergast + fallback (Ergast-compatible Jolpica)
const ERGAST_BASES = [
  "https://ergast.com/api/f1",
  "https://api.jolpi.ca/ergast/api/f1",
];

// OPTIONAL: if Ergast ever exposes "audi" as a constructorId, this will match it
const ERGAST_CONSTRUCTOR_ID_HINT = "audi";

// ---------- Helpers ----------

function withCacheBust(url) {
  if (!url) return url;
  return CACHE_BUST ? `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}` : url;
}

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

function getTeamLogoUrl(fileName) {
  return withCacheBust(`${PAGES_BASE}/${TEAMLOGOS_DIR}/${fileName}`);
}

function getDriverNumberImageUrl(driverNumber) {
  if (driverNumber == null || driverNumber === "-" || driverNumber === "") return null;
  return withCacheBust(
    `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`
  );
}

// Headshots (repo URL; assumes file exists or Widgy can handle 404)
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

// ---------- Placeholder builders ----------

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

function dashTeamStanding(teamLabel = "Audi") {
  return {
    team: teamLabel,
    position: "-",
    points: "-",
    wins: "-",
    originalTeam: "-",
    constructorId: "-",
  };
}

// ---------- Ergast response extractors ----------

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

  // ✅ Your pinned "Audi" drivers (as a widget concept)
  const driversBase = [
    { firstName: "Nico", lastName: "Hulkenberg", code: "HUL", driverNumber: 27 },
    { firstName: "Gabriel", lastName: "Bortoleto", code: "BOR", driverNumber: 5 },
  ];

  // Start as placeholders
  const drivers = driversBase.map((d) => ({
    firstName: d.firstName,
    lastName: d.lastName,
    code: d.code,
    driverNumber: d.driverNumber,

    numberImageUrl: getDriverNumberImageUrl(d.driverNumber),

    position: "-",
    points: "-",
    wins: "-",
    team: "Audi",
    placeholder: true,
    bestResult: dashBestResult(),

    headshotUrl: getSavedHeadshotUrl(d.firstName, d.lastName),
  }));

  let teamStanding = dashTeamStanding("Audi");
  let lastRace = dashLastRace();
  let placeholderMode = true;

  let urlUsed = {
    driverStandings: null,
    constructorStandings: null,
    lastRace: null,
  };

  try {
    // 1) Driver standings
    const ds = await fetchFromAnyBase("/current/driverStandings.json");
    urlUsed.driverStandings = ds.urlUsed;
    const driverStandings = getCurrentDriverStandings(ds.json);

    // 2) Constructor standings
    const cs = await fetchFromAnyBase("/current/constructorStandings.json");
    urlUsed.constructorStandings = cs.urlUsed;
    const constructorStandings = getCurrentConstructorStandings(cs.json);

    // 3) Last race results
    const lr = await fetchFromAnyBase("/current/last/results.json");
    urlUsed.lastRace = lr.urlUsed;
    const lrParsed = getLastRaceResult(lr.json);
    if (lrParsed) lastRace = lrParsed;

    // Fill driver rows (match by code or familyName)
    const foundConstructorIds = new Set();

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

        const ctorId = match?.Constructors?.[0]?.constructorId;
        if (ctorId) foundConstructorIds.add(String(ctorId).toLowerCase());
      }
    }

    // Determine constructorId to use for "Audi" team block
    let ctorIdToUse = null;

    // Prefer explicit hint if it exists in standings
    if (
      constructorStandings.some(
        (c) =>
          String(c?.Constructor?.constructorId || "").toLowerCase() ===
          ERGAST_CONSTRUCTOR_ID_HINT
      )
    ) {
      ctorIdToUse = ERGAST_CONSTRUCTOR_ID_HINT;
    } else if (foundConstructorIds.size === 1) {
      ctorIdToUse = Array.from(foundConstructorIds)[0];
    } else if (foundConstructorIds.size > 1) {
      ctorIdToUse = Array.from(foundConstructorIds)[0];
    }

    if (ctorIdToUse) {
      const ctorRow = constructorStandings.find(
        (c) => String(c?.Constructor?.constructorId || "").toLowerCase() === ctorIdToUse
      );

      if (ctorRow) {
        teamStanding = {
          team: "Audi",
          position: fmtPos(ctorRow.position),
          points: ctorRow.points ?? "-",
          wins: ctorRow.wins ?? "-",
          originalTeam: ctorRow?.Constructor?.name ?? "-",
          constructorId: ctorIdToUse,
        };
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
    header: "Audi standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      logos: `LOCAL_ONLY: ${PAGES_BASE}/${TEAMLOGOS_DIR}/`,
      headshots: `LOCAL_ONLY: ${PAGES_BASE}/${HEADSHOTS_DIR}/<first>-<last>.png`,
      driverNumbers: `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-<number>.png`,
      driverStandings: urlUsed.driverStandings || "ERGAST_UNAVAILABLE",
      constructorStandings: urlUsed.constructorStandings || "ERGAST_UNAVAILABLE",
      lastRace: urlUsed.lastRace || "ERGAST_UNAVAILABLE",
      note:
        "Uses Ergast current standings with Jolpica fallback (Ergast-compatible). TeamStanding is inferred from the constructor of the pinned drivers if no 'audi' constructor exists.",
    },
    meta: {
      mode: placeholderMode ? "PLACEHOLDERS_LOCAL_ASSETS" : "ERGAST_LIVE_LOCAL_ASSETS",
      cacheBust: CACHE_BUST,
      note:
        "Before the first race (or if data is unavailable), outputs '-' placeholders. After the first race, fills positions/points/wins from current standings. Constructor standings are inferred from the drivers’ constructorId. Positions formatted as P1, P2, etc.",
    },
    audi: {
      team: "Audi",
      teamLogoPng: getTeamLogoUrl(AUDI_LOGO_FILE),
      teamStanding,
    },
    lastRace,
    drivers,
  };
}

// ---------- Main ----------

async function updateAudiStandings() {
  const out = await buildJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateAudiStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});