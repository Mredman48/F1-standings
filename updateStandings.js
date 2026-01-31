// updateStandings.js
import fs from "node:fs/promises";

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

// If OpenF1 team_name differs from Ergast/Jolpica constructor name, normalize it here
const OPENF1_TEAM_NAME_MAP = {
  "Red Bull Racing": "Red Bull",
  "RB": "VCARB",
  "Visa Cash App RB F1 Team": "VCARB",
  "Visa Cash App RB": "VCARB",
};

// ---------- helpers ----------
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
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}\n${text.slice(0, 200)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${url}\n${text.slice(0, 200)}`);
  }
}

function extractStandings(payload) {
  const season = payload?.MRData?.StandingsTable?.season ?? null;
  const round = payload?.MRData?.StandingsTable?.StandingsLists?.[0]?.round ?? payload?.MRData?.StandingsTable?.round ?? null;
  const lists = payload?.MRData?.StandingsTable?.StandingsLists ?? [];
  const driverStandings = lists?.[0]?.DriverStandings ?? [];
  const total = Number(payload?.MRData?.total ?? 0);

  return { season, round, total, driverStandings };
}

// Jolpica tends to work best with lowercase endpoints
async function fetchCurrentStandings() {
  const urls = [
    `${JOLPICA_BASE}/current/driverstandings.json`,
    `${JOLPICA_BASE}/current/driverStandings.json`,
  ];

  for (const url of urls) {
    const data = await fetchJson(url);
    const parsed = extractStandings(data);
    // return even if empty; caller decides on fallback
    return { data, parsed, sourceUrl: url };
  }

  // practically unreachable because we return on first success, but kept for safety
  throw new Error("Could not fetch current standings from Jolpica.");
}

// Fallback: last season final standings
async function fetchLastSeasonFinalStandings(seasonYear) {
  const y = Number(seasonYear);
  const lastSeason = Number.isFinite(y) ? y - 1 : new Date().getUTCFullYear() - 1;

  const urls = [
    // Ergast pattern: /{season}/last/driverStandings.json (try both cases + lowercase)
    `${JOLPICA_BASE}/${lastSeason}/last/driverstandings.json`,
    `${JOLPICA_BASE}/${lastSeason}/last/driverStandings.json`,
    // Some mirrors also support /{season}/driverStandings/last.json (try variants)
    `${JOLPICA_BASE}/${lastSeason}/driverstandings/last.json`,
    `${JOLPICA_BASE}/${lastSeason}/driverStandings/last.json`,
  ];

  let lastError = null;

  for (const url of urls) {
    try {
      const data = await fetchJson(url);
      const parsed = extractStandings(data);
      if (Array.isArray(parsed.driverStandings) && parsed.driverStandings.length > 0) {
        return { data, parsed, sourceUrl: url, lastSeason };
      }
      lastError = new Error(`Fetched but empty standings from ${url}`);
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error("Could not fetch last season final standings.");
}

// OpenF1 driver metadata: headshot + team_colour
async function fetchOpenF1DriverMeta() {
  const arr = await fetchJson(OPENF1_DRIVERS_URL);
  if (!Array.isArray(arr)) return { byName: new Map(), rawCount: 0 };

  // OpenF1 can return multiple entries per driver_number across meetings/sessions.
  // We'll keep the most recent-ish occurrence (the array is typically recent-first, but not guaranteed).
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
  // exact match
  const exact = byName.get(nameKey(first, last));
  if (exact) return exact;

  // fallback: sometimes first names differ (e.g. "Alex" vs "Alexander")
  // try last-name-only unique match
  const lastLower = (last || "").trim().toLowerCase();
  if (!lastLower) return null;

  let found = null;
  let count = 0;
  for (const [k, v] of byName.entries()) {
    const [, kLast] = k.split("|");
    if (kLast === lastLower) {
      found = v;
      count += 1;
      if (count > 1) return null; // ambiguous
    }
  }
  return found;
}

// ---------- main ----------
async function updateStandings() {
  const nowIso = new Date().toISOString();

  // 1) Get current standings
  const current = await fetchCurrentStandings();
  let { season, round, driverStandings } = current.parsed;

  let usedFallback = false;
  let standingsSourceUrl = current.sourceUrl;
  let fallbackInfo = null;

  // 2) If empty, fallback to last season final
  if (!Array.isArray(driverStandings) || driverStandings.length === 0) {
    const fallback = await fetchLastSeasonFinalStandings(season);
    usedFallback = true;
    standingsSourceUrl = fallback.sourceUrl;
    fallbackInfo = { seasonRequested: season, fallbackSeason: fallback.lastSeason };
    season = String(fallback.lastSeason);
    round = fallback.parsed.round ?? "last";
    driverStandings = fallback.parsed.driverStandings;
  }

  // 3) Fetch OpenF1 meta for headshots + team colours
  const openf1 = await fetchOpenF1DriverMeta();

  // 4) Build driver list
  const drivers = (driverStandings || []).map((d) => {
    const ctor = d.Constructors?.[0] ?? null;

    const firstName = d?.Driver?.givenName ?? null;
    const lastName = d?.Driver?.familyName ?? null;

    const meta = matchOpenF1Meta(openf1.byName, firstName, lastName);

    const constructorFull = ctor?.name ?? null;
    const constructorShort = normalizeTeamName(constructorFull);

    // Prefer OpenF1 team colour if present; else null (you can add manual team color fallback if you want)
    const teamHex = meta?.teamColour ?? null;

    return {
      position: `P${d.position}`,
      positionNumber: Number(d.position),
      points: Number(d.points),
      wins: Number(d.wins),

      driver: {
        code: d?.Driver?.code ?? null,
        firstName,
        lastName,
        fullName: firstName && lastName ? `${firstName} ${lastName}` : null,
        nationality: d?.Driver?.nationality ?? null,

        // NEW:
        driverNumber: meta?.driverNumber ?? null,
        headshotUrl: meta?.headshotUrl ?? null,
        nameAcronym: meta?.nameAcronym ?? null,
      },

      constructor: {
        name: constructorShort,
        fullName: constructorFull,
        nationality: ctor?.nationality ?? null,

        // NEW:
        teamHex, // e.g. "#3671C6"
      },
    };
  });

  const out = {
    header: usedFallback
      ? `${season} Driver Standings (fallback)`
      : `${season} Driver Standings`,
    generatedAtUtc: nowIso,

    season: season ?? null,
    round: round ?? null,

    source: {
      kind: "jolpica ergast-compatible",
      url: standingsSourceUrl,
      note: usedFallback
        ? "Current season standings were empty; using last season final standings."
        : null,
    },

    enrichment: {
      openf1DriversUrl: OPENF1_DRIVERS_URL,
      openf1RowsSeen: openf1.rawCount,
      note:
        "Driver headshots + team hex colours come from OpenF1 drivers endpoint (joined by name).",
    },

    fallback: fallbackInfo,
    drivers,
  };

  await fs.writeFile("f1_driver_standings.json", JSON.stringify(out, null, 2), "utf8");
  console.log(
    `Wrote f1_driver_standings.json season=${out.season} drivers=${drivers.length} fallback=${usedFallback}`
  );
}

updateStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});