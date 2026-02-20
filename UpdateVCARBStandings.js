// updateVCARBStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Output JSON (keep naming consistent with your other endpoints style)
const OUT_JSON = "vcarb_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Repo folders
const TEAMLOGOS_DIR = "teamlogos";
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";

// CDN/Widgy cache-busting
const CACHE_BUST = true;

// ✅ VCARB / Racing Bulls logo (repo file)
const VCARB_LOGO_FILE = "2025_vcarb_color_v2.png";

// Ergast + fallback (Ergast-compatible Jolpica)
const ERGAST_BASES = [
  "https://ergast.com/api/f1",
  "https://api.jolpi.ca/ergast/api/f1",
];

// Ergast constructorId for Racing Bulls / RB / AlphaTauri can vary by era.
// We’ll primarily infer constructor from the drivers; but keep a hint list too.
const CONSTRUCTOR_ID_HINTS = [
  "rb",              // common modern id
  "racing_bulls",    // if it ever appears
  "alphatauri",      // older era
  "toro_rosso",      // older era
  "minardi",         // legacy
];

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

function dashTeamStanding() {
  return {
    team: "VCARB",
    position: "-",
    points: "-",
    wins: "-",
    originalTeam: "-",
    constructorId: "-",
  };
}

// ---------- Core: enforce exactly two placeholder drivers if empty ----------
function ensurePlaceholders(drivers) {
  // If we already have >= 2 drivers, leave it alone.
  if (Array.isArray(drivers) && drivers.length >= 2) return drivers;

  // Always return exactly two placeholders (Liam Lawson + Arvid Lindblad)
  // NOTE: You specified Arvid's number is 41.
  return [
    {
      firstName: "Liam",
      lastName: "Lawson",
      code: "LAW",
      driverNumber: 30,
      numberImageUrl: getDriverNumberImageUrl(30),
      position: "-",
      points: "-",
      wins: "-",
      team: "Racing Bulls",
      placeholder: true,
      bestResult: dashBestResult(),
      headshotUrl: null,
    },
    {
      firstName: "Arvid",
      lastName: "Lindblad",
      code: "LIN",
      driverNumber: 41,
      numberImageUrl: getDriverNumberImageUrl(41),
      position: "-",
      points: "-",
      wins: "-",
      team: "Racing Bulls",
      placeholder: true,
      bestResult: dashBestResult(),
      headshotUrl: null,
    },
  ];
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

// Try to infer the constructorId for the team.
// Priority:
// 1) If both pinned drivers exist and share a constructorId, use it
// 2) Else, use the first found constructorId among pinned drivers
// 3) Else, fall back to known constructorId hints if present in standings
function inferConstructorId({ drivers, driverStandings, constructorStandings }) {
  const ids = [];

  for (const d of drivers) {
    const match = driverStandings.find((row) => {
      const code = String(row?.Driver?.code || "").toUpperCase();
      const fam = String(row?.Driver?.familyName || "").toLowerCase();
      return code === d.code || fam === String(d.lastName || "").toLowerCase();
    });

    const ctorId = match?.Constructors?.[0]?.constructorId;
    if (ctorId) ids.push(String(ctorId).toLowerCase());
  }

  const unique = Array.from(new Set(ids));
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) return unique[0];

  // fallback: see if any hint exists in constructor standings
  for (const hint of CONSTRUCTOR_ID_HINTS) {
    const exists = constructorStandings.some(
      (c) => String(c?.Constructor?.constructorId || "").toLowerCase() === hint
    );
    if (exists) return hint;
  }

  return null;
}

// ---------- Build JSON (Ergast live, placeholders fallback) ----------

async function buildJson() {
  const now = new Date();

  // Pinned lineup for VCARB concept (will be used if Ergast can match them)
  // If Ergast doesn’t have them yet / doesn’t match, placeholders kick in.
  const pinnedDrivers = [
    { firstName: "Liam", lastName: "Lawson", code: "LAW", driverNumber: 30 },
    { firstName: "Arvid", lastName: "Lindblad", code: "LIN", driverNumber: 41 },
  ];

  // Start as placeholders (pinned drivers)
  let drivers = pinnedDrivers.map((d) => ({
    firstName: d.firstName,
    lastName: d.lastName,
    code: d.code,
    driverNumber: d.driverNumber,

    numberImageUrl: getDriverNumberImageUrl(d.driverNumber),

    position: "-",
    points: "-",
    wins: "-",
    team: "Racing Bulls",
    placeholder: true,
    bestResult: dashBestResult(),

    headshotUrl: getSavedHeadshotUrl(d.firstName, d.lastName),
  }));

  // Ensure exactly two drivers even if pinned list ever changes
  drivers = ensurePlaceholders(drivers);

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

    // Fill driver rows
    for (const d of drivers) {
      const match = driverStandings.find((row) => {
        const code = String(row?.Driver?.code || "").toUpperCase();
        const fam = String(row?.Driver?.familyName || "").toLowerCase();
        return code === d.code || fam === String(d.lastName || "").toLowerCase();
      });

      if (match) {
        d.position = fmtPos(match.position);
        d.points = match.points ?? "-";
        d.wins = match.wins ?? "-";
        d.placeholder = false;

        // Update team label to whatever Ergast calls it (useful for debugging)
        const ctorName = match?.Constructors?.[0]?.name;
        if (ctorName) d.team = ctorName;
      }
    }

    // Team row: infer constructorId then lookup its constructor standings row
    const ctorIdToUse = inferConstructorId({
      drivers,
      driverStandings,
      constructorStandings,
    });

    if (ctorIdToUse) {
      const ctorRow = constructorStandings.find(
        (c) => String(c?.Constructor?.constructorId || "").toLowerCase() === ctorIdToUse
      );

      if (ctorRow) {
        teamStanding = {
          team: "VCARB",
          position: fmtPos(ctorRow.position),
          points: ctorRow.points ?? "-",
          wins: ctorRow.wins ?? "-",
          originalTeam: ctorRow?.Constructor?.name ?? "Racing Bulls",
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
    header: "VCARB standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      logos: `LOCAL_ONLY: ${PAGES_BASE}/${TEAMLOGOS_DIR}/`,
      headshots: `LOCAL_ONLY: ${PAGES_BASE}/${HEADSHOTS_DIR}/<first>-<last>.png`,
      driverNumbers: `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-<number>.png`,
      driverStandings: urlUsed.driverStandings || "ERGAST_UNAVAILABLE",
      constructorStandings: urlUsed.constructorStandings || "ERGAST_UNAVAILABLE",
      lastRace: urlUsed.lastRace || "ERGAST_UNAVAILABLE",
      note:
        "Uses Ergast current standings with Jolpica fallback (Ergast-compatible). Team standings inferred from the pinned drivers’ constructorId where possible.",
    },
    meta: {
      mode: placeholderMode ? "PLACEHOLDERS_LOCAL_ASSETS" : "ERGAST_LIVE_LOCAL_ASSETS",
      cacheBust: CACHE_BUST,
      teamAliases: ["VCARB", "Racing Bulls"],
      note:
        "Before the first race (or if data is unavailable), outputs '-' placeholders. After races, fills positions/points/wins from current standings. Positions formatted as P1, P2, etc. If no drivers are available, placeholders are Liam Lawson (#30) and Arvid Lindblad (#41).",
    },
    vcarb: {
      team: "VCARB",
      teamAliases: ["Racing Bulls"],
      teamLogoPng: getTeamLogoUrl(VCARB_LOGO_FILE),
      teamStanding,
    },
    lastRace,
    drivers,
  };
}

// ---------- Main ----------

async function updateVCARBStandings() {
  const out = await buildJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateVCARBStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});