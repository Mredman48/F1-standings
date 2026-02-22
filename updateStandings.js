// updateStandings.js
import fs from "node:fs/promises";

const OUTPUT_FILE = "f1_driver_standings.json";

const JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1";
const OPENF1_DRIVERS_URL = "https://api.openf1.org/v1/drivers?session_key=latest";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Local repo folders (served via Pages)
const HEADSHOTS_DIR = "headshots";

// If Widgy/GitHub CDN is stubborn
const CACHE_BUST = true;

// Team display name overrides (Ergast/Jolpica constructor names)
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
  "Oracle Red Bull Racing": "Red Bull",

  "RB": "VCARB",
  "RB F1 Team": "VCARB",
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

// ✅ LOCAL ONLY (NO CHECKS): Always returns Pages URL for /headshots/<first>-<last>.png
function getLocalHeadshotUrl(firstName, lastName) {
  if (!firstName || !lastName) return null;
  const file = `${toSlug(firstName)}-${toSlug(lastName)}.png`;
  return withCacheBust(`${PAGES_BASE}/${HEADSHOTS_DIR}/${file}`);
}

function fmtPos(pos) {
  if (pos == null || pos === "-" || pos === "") return "-";
  const n = Number(pos);
  if (!Number.isFinite(n)) return "-";
  return `P${n}`;
}

// ✅ Name normalization rules
function normalizeDriverName(firstName, lastName) {
  let first = (firstName || "").trim();
  let last = (lastName || "").trim();

  // If Jolpica gives: givenName="Andrea" familyName="Kimi Antonelli"
  if (first.toLowerCase() === "andrea" && last.toLowerCase() === "kimi antonelli") {
    first = "Kimi";
    last = "Antonelli";
  }

  // If OpenF1 gives: first_name="Andrea Kimi" last_name="Antonelli"
  if (first.toLowerCase() === "andrea kimi" && last.toLowerCase() === "antonelli") {
    first = "Kimi";
    last = "Antonelli";
  }

  // If anything yields a combined full name "Andrea Kimi Antonelli"
  const full = `${first} ${last}`.trim().toLowerCase();
  if (full === "andrea kimi antonelli") {
    first = "Kimi";
    last = "Antonelli";
  }

  // (Keeping this because you asked earlier on Williams)
  if (first.toLowerCase() === "alexander" && last.toLowerCase() === "albon") {
    first = "Alex";
    last = "Albon";
  }

  return { firstName: first || null, lastName: last || null };
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "f1-standings-bot/1.0",
      Accept: "application/json",
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

// ---------- Jolpica standings (CURRENT ONLY, no last-season fallback) ----------

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

  let lastErr = null;
  for (const url of urls) {
    try {
      const data = await fetchJson(url);
      const parsed = extractStandings(data);
      return { parsed, sourceUrl: url, urlsTried: urls };
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("Could not fetch current standings from Jolpica.");
}

// ---------- last race (best-effort) ----------

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

// -------- OpenF1 enrichment (numbers/colors/acronym/team) --------

async function fetchOpenF1DriverMeta() {
  const arr = await fetchJson(OPENF1_DRIVERS_URL);
  if (!Array.isArray(arr)) return { byName: new Map(), rawCount: 0, raw: [] };

  const byName = new Map();

  for (const d of arr) {
    let first = d?.first_name ?? null;
    let last = d?.last_name ?? null;

    const norm = normalizeDriverName(first, last);
    first = norm.firstName;
    last = norm.lastName;

    if (!first || !last) continue;

    byName.set(nameKey(first, last), {
      driverNumber: d?.driver_number ?? null,
      teamColour: d?.team_colour ? `#${String(d.team_colour).replace("#", "")}` : null,
      teamName: normalizeOpenF1TeamName(d?.team_name ?? null),
      nameAcronym: d?.name_acronym ?? null,
    });
  }

  return { byName, rawCount: arr.length, raw: arr };
}

function matchOpenF1Meta(byName, first, last) {
  const exact = byName.get(nameKey(first, last));
  if (exact) return exact;

  const lastLower = (last || "").trim().toLowerCase();
  if (!lastLower) return null;

  // unique last-name fallback
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

// ---------- Placeholder drivers (alphabetical) when standings are empty/unavailable ----------
function buildAlphabeticalPlaceholderDrivers(openf1Raw) {
  if (!Array.isArray(openf1Raw) || openf1Raw.length === 0) return [];

  // De-dupe by driver_number (latest session may include duplicates)
  const byNum = new Map();
  for (const r of openf1Raw) {
    const num = r?.driver_number;
    if (num == null) continue;

    const norm = normalizeDriverName(r?.first_name ?? null, r?.last_name ?? null);
    if (!norm.firstName || !norm.lastName) continue;

    if (!byNum.has(num)) {
      byNum.set(num, {
        firstName: norm.firstName,
        lastName: norm.lastName,
        code: (r?.name_acronym ?? null)?.toUpperCase?.() ?? (r?.name_acronym ?? null),
        driverNumber: num,
        teamName: normalizeOpenF1TeamName(r?.team_name ?? null),
        teamHex: r?.team_colour ? `#${String(r.team_colour).replace("#", "")}` : null,
      });
    }
  }

  const rows = Array.from(byNum.values()).sort((a, b) => {
    const al = (a.lastName || "").toLowerCase();
    const bl = (b.lastName || "").toLowerCase();
    if (al !== bl) return al.localeCompare(bl);
    return (a.firstName || "").toLowerCase().localeCompare((b.firstName || "").toLowerCase());
  });

  // Alphabetical placeholders: position "-" points "-" wins "-"
  return rows.map((r) => ({
    position: "-", // ✅ dashes as requested
    positionNumber: null,
    points: "-",
    wins: "-",

    previousPositionNumber: null,
    positionChange: null,
    positionDirection: null,
    arrowSymbol: null,
    positionChangeText: null,

    driver: {
      code: r.code ?? null,
      firstName: r.firstName,
      lastName: r.lastName,
      fullName: r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : null,
      nationality: null,
      driverNumber: r.driverNumber ?? null,
      headshotUrl:
        r.firstName && r.lastName ? getLocalHeadshotUrl(r.firstName, r.lastName) : null,
      nameAcronym: r.code ?? null,
    },

    constructor: {
      name: r.teamName ?? null,
      fullName: r.teamName ?? null,
      nationality: null,
      teamHex: r.teamHex ?? null,
    },

    placeholder: true,
  }));
}

// ---------- main ----------
async function updateStandings() {
  const nowIso = new Date().toISOString();
  const prevPosMap = await readPreviousPositions();

  // OpenF1 meta + raw (used for enrichment AND placeholders)
  const openf1 = await fetchOpenF1DriverMeta();

  // 1) CURRENT standings (no last-season fallback)
  let season = null;
  let driverStandings = [];
  let standingsSourceUrl = null;
  let standingsUrlsTried = [];

  let standingsOk = false;
  let standingsError = null;

  try {
    const current = await fetchCurrentStandings();
    season = current.parsed.season;
    driverStandings = current.parsed.driverStandings;
    standingsSourceUrl = current.sourceUrl;
    standingsUrlsTried = current.urlsTried || [];
    standingsOk = Array.isArray(driverStandings) && driverStandings.length > 0;
  } catch (e) {
    standingsOk = false;
    standingsError = String(e?.message || e);
  }

  // lastRace best-effort (if season known)
  const lastRaceInfo = await fetchLastRaceForSeason(season);

  // 2) Build drivers
  let drivers = [];

  if (!standingsOk) {
    // ✅ Alphabetical placeholder mode
    drivers = buildAlphabeticalPlaceholderDrivers(openf1.raw);

    const out = {
      header: "Driver Standings (placeholders)",
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
        url: standingsSourceUrl ?? "UNAVAILABLE",
        urlsTried: standingsUrlsTried,
        ok: false,
        error: standingsError,
        note:
          "Current season driver standings were empty/unavailable; output is alphabetical placeholders (from OpenF1 drivers list).",
      },

      enrichment: {
        openf1DriversUrl: OPENF1_DRIVERS_URL,
        openf1RowsSeen: openf1.rawCount,
        note:
          "Placeholder driver list (alphabetical) is built from OpenF1 drivers endpoint. Headshots are LOCAL ONLY from repo /headshots. Standings fields are '-' until Jolpica standings populate.",
      },

      positionDeltaNotes:
        "In placeholder mode, position deltas are null because there is no current positionNumber.",
      drivers,
    };

    await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
    console.log(`Wrote ${OUTPUT_FILE} mode=PLACEHOLDERS drivers=${drivers.length}`);
    return;
  }

  // ✅ Live standings mode
  drivers = (driverStandings || []).map((d) => {
    const ctor = d.Constructors?.[0] ?? null;

    // Normalize names (incl. Antonelli fix)
    const rawFirst = d?.Driver?.givenName ?? null;
    const rawLast = d?.Driver?.familyName ?? null;
    const norm = normalizeDriverName(rawFirst, rawLast);
    const firstName = norm.firstName;
    const lastName = norm.lastName;

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
      position: fmtPos(d.position), // ✅ P1 formatting
      positionNumber: Number.isFinite(currentPos) ? currentPos : null,
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

        // ✅ LOCAL repo headshots (no OpenF1 headshot_url)
        headshotUrl: firstName && lastName ? getLocalHeadshotUrl(firstName, lastName) : null,

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
    header: season ? `${season} Driver Standings` : "Driver Standings",
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
      urlsTried: standingsUrlsTried,
      ok: true,
      note: null,
    },

    enrichment: {
      openf1DriversUrl: OPENF1_DRIVERS_URL,
      openf1RowsSeen: openf1.rawCount,
      note:
        "Driver numbers + team hex colours + acronyms come from OpenF1 drivers endpoint (joined by name). Headshots are LOCAL ONLY from repo /headshots. Name normalization includes: 'Andrea Kimi Antonelli' -> firstName 'Kimi', lastName 'Antonelli'.",
    },

    positionDeltaNotes:
      "positionDirection is one of UP/DOWN/SAME/NEW. positionChange = previousPosition - currentPosition.",
    drivers,
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUTPUT_FILE} mode=LIVE season=${out.season} drivers=${drivers.length}`);
}

updateStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});