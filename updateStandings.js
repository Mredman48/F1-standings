// updateStandings.js
import fs from "node:fs/promises";

const OUTPUT_FILE = "f1_driver_standings.json";

const JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1";
const OPENF1_DRIVERS_URL = "https://api.openf1.org/v1/drivers?session_key=latest";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const HEADSHOTS_DIR = "headshots";

// If Widgy/GitHub CDN is stubborn
const CACHE_BUST = true;

// Team display name overrides
const TEAM_NAME_MAP = {
  "Red Bull Racing": "Red Bull",
  "Oracle Red Bull Racing": "Red Bull",

  "RB F1 Team": "VCARB",
  "Visa Cash App RB": "VCARB",
  "Visa Cash App RB F1 Team": "VCARB",
};

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

// -------------------- fetch helpers --------------------

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "f1-standings-bot/1.0",
      "Accept": "application/json",
    },
    redirect: "follow",
  });
  const text = await res.text();
  return { res, text };
}

async function fetchJsonStrict(url) {
  const { res, text } = await fetchText(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}\n${text.slice(0, 250)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${url}\n${text.slice(0, 250)}`);
  }
}

// ✅ NEW: safe JSON fetch that never throws on 401/403/etc.
// You can choose how to handle it at the call site.
async function fetchJsonSafe(url) {
  const { res, text } = await fetchText(url);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      url,
      text: text.slice(0, 400),
      json: null,
    };
  }
  try {
    return { ok: true, status: res.status, url, text: null, json: JSON.parse(text) };
  } catch {
    return { ok: false, status: res.status, url, text: text.slice(0, 400), json: null };
  }
}

// -------------------- Ergast/Jolpica parsing --------------------

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

  // NOTE: if Jolpica is empty/offseason, we still return empty standings (no fallback).
  for (const url of urls) {
    const data = await fetchJsonStrict(url);
    const parsed = extractStandings(data);
    return { parsed, sourceUrl: url };
  }

  throw new Error("Could not fetch current standings from Jolpica.");
}

// lastRace matches the season we publish
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
      const data = await fetchJsonStrict(url);
      const lastRace = parseLastRace(data);
      if (lastRace) return { found: true, lastRace, sourceUrl: url, sourceUrlTried: urls };
    } catch {
      // try next
    }
  }

  return { found: false, lastRace: null, sourceUrlTried: urls };
}

// -------------------- OpenF1 enrichment (SAFE) --------------------
// ✅ This will NOT throw if OpenF1 is locked (401). It just returns empty meta.

async function fetchOpenF1DriverMeta() {
  const resp = await fetchJsonSafe(OPENF1_DRIVERS_URL);

  // OpenF1 locked during live sessions -> do NOT fail the workflow
  if (!resp.ok) {
    console.warn(
      `OpenF1 unavailable: HTTP ${resp.status} from ${resp.url}. Continuing without OpenF1 enrichment.`
    );
    if (resp.text) console.warn(resp.text);
    return {
      byName: new Map(),
      rawCount: 0,
      openf1Ok: false,
      openf1Status: resp.status,
    };
  }

  const arr = resp.json;
  if (!Array.isArray(arr)) {
    console.warn("OpenF1 returned non-array. Continuing without enrichment.");
    return { byName: new Map(), rawCount: 0, openf1Ok: false, openf1Status: resp.status };
  }

  const byName = new Map();
  for (const d of arr) {
    const first = d?.first_name ?? null;
    const last = d?.last_name ?? null;
    if (!first || !last) continue;

    byName.set(nameKey(first, last), {
      driverNumber: d?.driver_number ?? null,
      teamColour: d?.team_colour ? `#${String(d.team_colour).replace("#", "")}` : null,
      teamName: normalizeOpenF1TeamName(d?.team_name ?? null),
      nameAcronym: d?.name_acronym ?? null,
    });
  }

  return { byName, rawCount: arr.length, openf1Ok: true, openf1Status: resp.status };
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

// -------------------- previous positions (arrows) --------------------

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

// -------------------- placeholders mode (alphabetical) --------------------

function buildAlphabeticalPlaceholders(openf1Meta) {
  // If OpenF1 is available, we can build a 2026-ish roster placeholders from it.
  // If not, still return an empty placeholder list (or keep your previous count).
  const rows = [];

  // Prefer OpenF1 names if we have them
  for (const [k, v] of openf1Meta.byName.entries()) {
    const [first, last] = k.split("|").map((x) => x || "");
    if (!first || !last) continue;

    rows.push({
      driver: {
        code: v?.nameAcronym ?? null,
        firstName: first ? first[0].toUpperCase() + first.slice(1) : null,
        lastName: last ? last[0].toUpperCase() + last.slice(1) : null,
        fullName: `${first ? first[0].toUpperCase() + first.slice(1) : ""} ${last ? last[0].toUpperCase() + last.slice(1) : ""}`.trim(),
        nationality: null,
        driverNumber: v?.driverNumber ?? null,
        headshotUrl:
          first && last ? getLocalHeadshotUrl(first, last) : null,
        nameAcronym: v?.nameAcronym ?? null,
      },
      constructor: {
        name: v?.teamName ?? null,
        fullName: v?.teamName ?? null,
        nationality: null,
        teamHex: v?.teamColour ?? null,
      },
    });
  }

  // Sort alphabetically by last name then first
  rows.sort((a, b) => {
    const aL = (a.driver.lastName || "").toLowerCase();
    const bL = (b.driver.lastName || "").toLowerCase();
    if (aL !== bL) return aL.localeCompare(bL);
    const aF = (a.driver.firstName || "").toLowerCase();
    const bF = (b.driver.firstName || "").toLowerCase();
    return aF.localeCompare(bF);
  });

  // If OpenF1 is locked, rows will be empty. That’s OK: we still output a valid JSON.
  // If you want a fixed-length placeholder list (like 22), you can keep your existing list here.
  return rows.map((r) => ({
    position: "-",
    positionNumber: null,
    points: "-",
    wins: "-",

    previousPositionNumber: null,
    positionChange: null,
    positionDirection: "NEW",
    arrowSymbol: "NEW",
    positionChangeText: "NEW",

    driver: r.driver,
    constructor: r.constructor,
  }));
}

// -------------------- main --------------------

async function updateStandings() {
  const nowIso = new Date().toISOString();
  const prevPosMap = await readPreviousPositions();

  // 1) Current standings from Jolpica (no fallback to last season)
  const current = await fetchCurrentStandings();
  let { season, driverStandings } = current.parsed;

  // 2) OpenF1 enrichment (SAFE, never throws)
  const openf1 = await fetchOpenF1DriverMeta();

  // lastRace pulled for the SAME season we publish (best-effort)
  const lastRaceInfo = await fetchLastRaceForSeason(season);

  // 3) If no standings, output alphabetical placeholders (dashes)
  const standingsEmpty = !Array.isArray(driverStandings) || driverStandings.length === 0;

  if (standingsEmpty) {
    const drivers = buildAlphabeticalPlaceholders(openf1);

    const out = {
      header: `${season || "current"} Driver Standings`,
      generatedAtUtc: nowIso,
      season: season ?? null,

      mode: "PLACEHOLDERS",
      lastRace: lastRaceInfo.found ? lastRaceInfo.lastRace : null,
      lastRaceSource: {
        found: lastRaceInfo.found,
        urlUsed: lastRaceInfo.sourceUrl ?? null,
        urlsTried: lastRaceInfo.sourceUrlTried ?? [],
      },

      source: {
        kind: "jolpica ergast-compatible",
        url: current.sourceUrl,
        note: "Standings were empty; outputting alphabetical placeholders with dashes.",
      },

      enrichment: {
        openf1DriversUrl: OPENF1_DRIVERS_URL,
        openf1RowsSeen: openf1.rawCount,
        openf1Ok: openf1.openf1Ok,
        openf1Status: openf1.openf1Status,
        note:
          "If OpenF1 is locked during live sessions, enrichment is skipped (no crash). Headshots are LOCAL ONLY from repo /headshots.",
      },

      positionDeltaNotes:
        "positionDirection is one of UP/DOWN/SAME/NEW. positionChange = previousPosition - currentPosition.",
      drivers,
    };

    await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
    console.log(`Wrote ${OUTPUT_FILE} mode=PLACEHOLDERS drivers=${drivers.length}`);
    return;
  }

  // 4) Normal standings mode
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
      position: d.position ? `P${d.position}` : "-",
      positionNumber: Number.isFinite(currentPos) ? currentPos : null,
      points: d?.points != null ? Number(d.points) : "-",
      wins: d?.wins != null ? Number(d.wins) : "-",

      ...delta,

      driver: {
        code: driverCode,
        firstName,
        lastName,
        fullName: firstName && lastName ? `${firstName} ${lastName}` : null,
        nationality: d?.Driver?.nationality ?? null,
        driverNumber: meta?.driverNumber ?? null,
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
    header: `${season} Driver Standings`,
    generatedAtUtc: nowIso,
    season: season ?? null,

    mode: "LIVE",

    lastRace: lastRaceInfo.found ? lastRaceInfo.lastRace : null,
    lastRaceSource: {
      found: lastRaceInfo.found,
      urlUsed: lastRaceInfo.sourceUrl ?? null,
      urlsTried: lastRaceInfo.sourceUrlTried ?? [],
    },

    source: {
      kind: "jolpica ergast-compatible",
      url: current.sourceUrl,
      note: null,
    },

    enrichment: {
      openf1DriversUrl: OPENF1_DRIVERS_URL,
      openf1RowsSeen: openf1.rawCount,
      openf1Ok: openf1.openf1Ok,
      openf1Status: openf1.openf1Status,
      note:
        "Driver numbers + team hex colours + acronyms come from OpenF1 when available. If OpenF1 is locked during live sessions, enrichment is skipped (no crash). Headshots are LOCAL ONLY from repo /headshots.",
    },

    positionDeltaNotes:
      "positionDirection is one of UP/DOWN/SAME/NEW. positionChange = previousPosition - currentPosition.",
    drivers,
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUTPUT_FILE} mode=LIVE drivers=${drivers.length}`);
}

updateStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});