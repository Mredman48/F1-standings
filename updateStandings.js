// updateStandings.js
import fs from "node:fs/promises";

const OUTPUT_FILE = "f1_driver_standings.json";

const JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1";
const OPENF1_DRIVERS_URL = "https://api.openf1.org/v1/drivers?session_key=latest";

// Team display name overrides
const TEAM_NAME_MAP = {
  "Red Bull Racing": "Red Bull",
  "Oracle Red Bull Racing": "Red Bull",

  "RB F1 Team": "VCARB",
  "Visa Cash App RB": "VCARB",
  "Visa Cash App RB F1 Team": "VCARB",
};

// If OpenF1 team_name differs from Ergast/Jolpica constructor name
const OPENF1_TEAM_NAME_MAP = {
  "Red Bull Racing": "Red Bull",
  "RB": "VCARB",
  "Visa Cash App RB F1 Team": "VCARB",
  "Visa Cash App RB": "VCARB",
};

function normalizeTeamName(name) {
  if (!name) return null;
  return TEAM_NAME_MAP[name] || name;
}

function normalizeOpenF1TeamName(name) {
  if (!name) return null;
  return OPENF1_TEAM_NAME_MAP[name] || TEAM_NAME_MAP[name] || name;
}

function nameKey(first, last) {
  return `${(first || "").trim().toLowerCase()}|${(last || "").trim().toLowerCase()}`;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "f1-standings-bot/1.0",
      "Accept": "application/json",
    },
    redirect: "follow",
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}\n${text.slice(0, 200)}`);

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${url}\n${text.slice(0, 200)}`);
  }
}

function extractStandings(payload) {
  const season = payload?.MRData?.StandingsTable?.season ?? null;
  const lists = payload?.MRData?.StandingsTable?.StandingsLists ?? [];
  const driverStandings = lists?.[0]?.DriverStandings ?? [];
  return { season, driverStandings };
}

async function fetchCurrentStandings() {
  const urls = [
    `${JOLPICA_BASE}/current/driverstandings.json`,
    `${JOLPICA_BASE}/current/driverStandings.json`,
  ];

  for (const url of urls) {
    const data = await fetchJson(url);
    const parsed = extractStandings(data);
    return { parsed, sourceUrl: url };
  }

  throw new Error("Could not fetch current standings from Jolpica.");
}

async function fetchLastSeasonFinalStandings(seasonYear) {
  const y = Number(seasonYear);
  const lastSeason = Number.isFinite(y) ? y - 1 : new Date().getUTCFullYear() - 1;

  const urls = [
    `${JOLPICA_BASE}/${lastSeason}/last/driverstandings.json`,
    `${JOLPICA_BASE}/${lastSeason}/last/driverStandings.json`,
    `${JOLPICA_BASE}/${lastSeason}/driverstandings/last.json`,
    `${JOLPICA_BASE}/${lastSeason}/driverStandings/last.json`,
  ];

  let lastError = null;
  for (const url of urls) {
    try {
      const data = await fetchJson(url);
      const parsed = extractStandings(data);
      if (Array.isArray(parsed.driverStandings) && parsed.driverStandings.length > 0) {
        return { parsed, sourceUrl: url, lastSeason };
      }
      lastError = new Error(`Fetched but empty standings from ${url}`);
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error("Could not fetch last season final standings.");
}

// -------- FIXED: lastRace matches the season we publish --------
function parseLastRace(payload) {
  const race = payload?.MRData?.RaceTable?.Races?.[0] ?? null;
  if (!race) return null;

  return {
    season: race.season ?? null,
    round: race.round ? Number(race.round) : null,
    raceName: race.raceName ?? null,
    date: race.date ?? null,
    time: race.time ?? null,
    circuit: {
      name: race?.Circuit?.circuitName ?? null,
      location: {
        locality: race?.Circuit?.Location?.locality ?? null,
        country: race?.Circuit?.Location?.country ?? null,
      },
    },
  };
}

async function fetchLastRaceForSeason(season) {
  if (!season) return { found: false, lastRace: null, sourceUrlTried: [] };

  const urls = [
    `${JOLPICA_BASE}/${season}/last/results.json`,
    `${JOLPICA_BASE}/${season}/last/results/`,
    `${JOLPICA_BASE}/${season}/last/results`,
  ];

  for (const url of urls) {
    try {
      const data = await fetchJson(url);
      const lastRace = parseLastRace(data);
      if (lastRace) return { found: true, lastRace, sourceUrl: url, sourceUrlTried: urls };
    } catch {
      // try next
    }
  }

  return { found: false, lastRace: null, sourceUrlTried: urls };
}

// -------- OpenF1 enrichment --------
async function fetchOpenF1DriverMeta() {
  const arr = await fetchJson(OPENF1_DRIVERS_URL);
  if (!Array.isArray(arr)) return { byName: new Map(), rawCount: 0 };

  const byName = new Map();
  for (const d of arr) {
    const first = d?.first_name ?? null;
    const last = d?.last_name ?? null;
    if (!first || !last) continue;

    byName.set(nameKey(first, last), {
      driverNumber: d?.driver_number ?? null,
      headshotUrl: d?.headshot_url ?? null,
      teamColour: d?.team_colour ? `#${String(d.team_colour).replace("#", "")}` : null,
      teamName: normalizeOpenF1TeamName(d?.team_name ?? null),
      nameAcronym: d?.name_acronym ?? null,
    });
  }

  return { byName, rawCount: arr.length };
}

function matchOpenF1Meta(byName, first, last) {
  const exact = byName.get(nameKey(first, last));
  if (exact) return exact;

  const lastLower = (last || "").trim().toLowerCase();
  if (!lastLower) return null;

  let found = null;
  let count = 0;
  for (const [k, v] of byName.entries()) {
    const [, kLast] = k.split("|");
    if (kLast === lastLower) {
      found = v;
      count += 1;
      if (count > 1) return null;
    }
  }
  return found;
}

// ----- previous standings for arrows -----
async function readPreviousPositions() {
  try {
    const raw = await fs.readFile(OUTPUT_FILE, "utf8");
    const prev = JSON.parse(raw);
    const map = new Map();

    for (const d of prev?.drivers ?? []) {
      const code = d?.driver?.code ?? null;
      const first = d?.driver?.firstName ?? null;
      const last = d?.driver?.lastName ?? null;

      const pos = Number(d?.positionNumber);
      if (!Number.isFinite(pos)) continue;

      if (code) map.set(`code:${code}`, pos);
      if (first && last) map.set(`name:${nameKey(first, last)}`, pos);
    }

    return map;
  } catch {
    return new Map();
  }
}

function computePositionDelta(prevPos, currentPos) {
  if (!Number.isFinite(prevPos)) {
    return {
      previousPositionNumber: null,
      positionChange: null,
      positionDirection: "NEW",
      arrowSymbol: "NEW",
      positionChangeText: "NEW",
    };
  }

  const delta = prevPos - currentPos; // + means moved UP
  if (delta > 0) {
    return {
      previousPositionNumber: prevPos,
      positionChange: delta,
      positionDirection: "UP",
      arrowSymbol: "^",
      positionChangeText: `+${delta}`,
    };
  }
  if (delta < 0) {
    return {
      previousPositionNumber: prevPos,
      positionChange: delta,
      positionDirection: "DOWN",
      arrowSymbol: "v",
      positionChangeText: `${delta}`,
    };
  }
  return {
    previousPositionNumber: prevPos,
    positionChange: 0,
    positionDirection: "SAME",
    arrowSymbol: "-",
    positionChangeText: "0",
  };
}

// ---------- main ----------
async function updateStandings() {
  const nowIso = new Date().toISOString();
  const prevPosMap = await readPreviousPositions();

  // 1) Current standings (or fallback)
  const current = await fetchCurrentStandings();
  let { season, driverStandings } = current.parsed;

  let usedStandingsFallback = false;
  let standingsSourceUrl = current.sourceUrl;
  let fallbackInfo = null;

  if (!Array.isArray(driverStandings) || driverStandings.length === 0) {
    const fallback = await fetchLastSeasonFinalStandings(season);
    usedStandingsFallback = true;
    standingsSourceUrl = fallback.sourceUrl;
    fallbackInfo = { seasonRequested: season, fallbackSeason: fallback.lastSeason };
    season = String(fallback.lastSeason);
    driverStandings = fallback.parsed.driverStandings;
  }

  // ✅ lastRace pulled for the SAME season we publish
  const lastRaceInfo = await fetchLastRaceForSeason(season);

  // 2) OpenF1 metadata
  const openf1 = await fetchOpenF1DriverMeta();

  // 3) Build drivers
  const drivers = (driverStandings || []).map((d) => {
    const ctor = d.Constructors?.[0] ?? null;

    const firstName = d?.Driver?.givenName ?? null;
    const lastName = d?.Driver?.familyName ?? null;
    const driverCode = d?.Driver?.code ?? null;

    const meta = matchOpenF1Meta(openf1.byName, firstName, lastName);

    const constructorFull = ctor?.name ?? null;
    const constructorShort = normalizeTeamName(constructorFull);

    const currentPos = Number(d.position);
    const prevPos =
      (driverCode && prevPosMap.get(`code:${driverCode}`)) ??
      (firstName && lastName ? prevPosMap.get(`name:${nameKey(firstName, lastName)}`) : undefined);

    const delta = computePositionDelta(
      Number.isFinite(prevPos) ? Number(prevPos) : NaN,
      currentPos
    );

    return {
      position: `P${d.position}`,
      positionNumber: currentPos,
      points: Number(d.points),
      wins: Number(d.wins),

      ...delta,

      driver: {
        code: driverCode,
        firstName,
        lastName,
        fullName: firstName && lastName ? `${firstName} ${lastName}` : null,
        nationality: d?.Driver?.nationality ?? null,
        driverNumber: meta?.driverNumber ?? null,
        headshotUrl: meta?.headshotUrl ?? null,
        nameAcronym: meta?.nameAcronym ?? null,
      },

      constructor: {
        name: constructorShort,
        fullName: constructorFull,
        nationality: ctor?.nationality ?? null,
        teamHex: meta?.teamColour ?? null,
      },
    };
  });

  const out = {
    header: usedStandingsFallback ? `${season} Driver Standings (fallback)` : `${season} Driver Standings`,
    generatedAtUtc: nowIso,
    season: season ?? null,

    lastRace: lastRaceInfo.found ? lastRaceInfo.lastRace : null,
    lastRaceSource: {
      found: lastRaceInfo.found,
      urlUsed: lastRaceInfo.sourceUrl ?? null,
      urlsTried: lastRaceInfo.sourceUrlTried ?? [],
    },

    source: {
      kind: "jolpica ergast-compatible",
      url: standingsSourceUrl,
      note: usedStandingsFallback
        ? "Current season standings were empty; using last season final standings."
        : null,
    },

    enrichment: {
      openf1DriversUrl: OPENF1_DRIVERS_URL,
      openf1RowsSeen: openf1.rawCount,
      note: "Driver headshots + team hex colours come from OpenF1 drivers endpoint (joined by name).",
    },

    fallback: fallbackInfo,

    positionDeltaNotes:
      "positionDirection is one of UP/DOWN/SAME/NEW. positionChange = previousPosition - currentPosition.",
    drivers,
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUTPUT_FILE} season=${out.season} drivers=${drivers.length}`);
}

updateStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});