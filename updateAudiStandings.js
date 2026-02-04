// updateAudiStandings.js
import fs from "node:fs/promises";
import path from "node:path";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Ergast-compatible sources
const ERGAST_BASES = ["https://api.jolpi.ca/ergast/f1", "https://ergast.com/api/f1"];

// OpenF1 (headshots)
const OPENF1_BASE = "https://api.openf1.org/v1";

// Your GitHub Pages base (update if needed)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Where we save PNG logos (must be committed)
const TEAMLOGO_DIR = "teamlogos";

// ✅ Colored Audi logo PNG (your chosen source)
const STATIC_AUDI_LOGO_PNG =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Audif1.com_logo17_%28cropped%29.svg/1920px-Audif1.com_logo17_%28cropped%29.svg.png";

// Output files
const OUT_JSON = "f1_audi_standings.json";
const OUT_LOGO_PNG = `${TEAMLOGO_DIR}/audi_logo_colored.png`;

// What counts as “Kick Sauber” historically
const SAUBER_MATCHERS = [
  "stake f1 team kick sauber",
  "kick sauber",
  "stake f1 team",
  "stake",
  "sauber",
  "alfa romeo", // just in case older naming shows up
];

function safeGet(obj, pathArr) {
  return pathArr.reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), obj);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function makePagesUrl(relPath) {
  return `${PAGES_BASE}/${relPath.split(path.sep).join("/")}`;
}

async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, ...headers },
    redirect: "follow",
  });
  const text = await res.text();
  return { res, text };
}

async function fetchJson(url, headers = {}) {
  const { res, text } = await fetchText(url, { Accept: "application/json", ...headers });
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON from ${url}: ${text.slice(0, 160)}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return data;
}

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "image/*,*/*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchErgastWithFallback(p) {
  const attempts = [];
  for (const base of ERGAST_BASES) {
    const url = `${base}${p}`;
    try {
      const data = await fetchJson(url);
      return { data, url, attempts };
    } catch (e) {
      attempts.push({ url, error: e?.message || String(e) });
    }
  }
  throw new Error(`All Ergast fetch attempts failed: ${JSON.stringify(attempts, null, 2)}`);
}

/* -------------------- Audi logo: ensure it exists as PNG in repo -------------------- */

async function buildAudiLogoPngIfMissing() {
  // If already saved, reuse (stable URL for Widgy)
  try {
    await fs.access(OUT_LOGO_PNG);
    return { ok: true, pngUrl: makePagesUrl(OUT_LOGO_PNG), note: "cached" };
  } catch {
    // continue
  }

  await ensureDir(TEAMLOGO_DIR);

  // Download the PNG and save it directly (no conversion needed)
  const pngBuf = await fetchBuffer(STATIC_AUDI_LOGO_PNG);
  await fs.writeFile(OUT_LOGO_PNG, pngBuf);

  return { ok: true, pngUrl: makePagesUrl(OUT_LOGO_PNG), note: "static_wikipedia_png" };
}

/* -------------------- OpenF1 headshots (best-effort) -------------------- */

async function getOpenF1HeadshotMap() {
  // Uses latest session so it works even in offseason/preseason
  try {
    const sessions = await fetchJson(`${OPENF1_BASE}/sessions?session_key=latest`);
    const sessionKey = Array.isArray(sessions) ? sessions[0]?.session_key : null;
    if (!sessionKey) return new Map();

    const drivers = await fetchJson(
      `${OPENF1_BASE}/drivers?session_key=${encodeURIComponent(sessionKey)}`
    );

    const map = new Map();
    if (Array.isArray(drivers)) {
      for (const d of drivers) {
        if (d?.driver_number != null) {
          map.set(Number(d.driver_number), d.headshot_url || null);
        }
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/* -------------------- Ergast standings helpers -------------------- */

function parseDriverStandings(payload) {
  const list =
    safeGet(payload, ["MRData", "StandingsTable", "StandingsLists", 0, "DriverStandings"]) || [];
  const season = safeGet(payload, ["MRData", "StandingsTable", "season"]) || null;
  const round = safeGet(payload, ["MRData", "StandingsTable", "round"]) || null;
  const total = Number(payload?.MRData?.total || 0);

  return { list: Array.isArray(list) ? list : [], season, round, total };
}

async function getDriverStandingsForSeason(seasonTag) {
  const { data, url } = await fetchErgastWithFallback(`/${seasonTag}/driverstandings.json`);
  const parsed = parseDriverStandings(data);
  return { ...parsed, source: url, seasonTag: String(seasonTag) };
}

function teamNameFromStandingRow(d) {
  const constructors = Array.isArray(d.Constructors) ? d.Constructors : [];
  return constructors[0]?.name || "";
}

function teamMatchesAny(teamName, matchers) {
  const t = String(teamName || "").toLowerCase();
  return matchers.some((m) => t.includes(String(m).toLowerCase()));
}

function mapDriverStanding(d, headshotMap, options = {}) {
  const driver = d.Driver || {};
  const originalTeam = teamNameFromStandingRow(d) || null;
  const num = driver.permanentNumber ? Number(driver.permanentNumber) : null;

  const obj = {
    position: d.position ? `P${d.position}` : null,
    points: d.points ? Number(d.points) : null,
    wins: d.wins ? Number(d.wins) : null,
    firstName: driver.givenName || null,
    lastName: driver.familyName || null,
    code: driver.code || null,
    driverNumber: num,
    team: options.teamOverride || originalTeam,
    headshotUrl: num != null ? headshotMap.get(num) || null : null,
    placeholder: Boolean(options.placeholder),
  };

  if (options.includeOriginalTeam) obj.originalTeam = originalTeam;
  return obj;
}

/* -------------------- main -------------------- */

async function updateAudiStandings() {
  const now = new Date();
  const prevYear = String(now.getUTCFullYear() - 1);

  // 1) Ensure Audi logo exists as PNG in repo
  const audiLogo = await buildAudiLogoPngIfMissing();

  // 2) Headshots
  const headshotMap = await getOpenF1HeadshotMap();

  // 3) Pull current season standings
  const current = await getDriverStandingsForSeason("current");

  // 4) If Audi exists in current standings, use Audi drivers
  const audiDriversCurrent = current.list
    .filter((d) => teamMatchesAny(teamNameFromStandingRow(d), ["audi"]))
    .map((d) => mapDriverStanding(d, headshotMap, { teamOverride: "Audi" }));

  let driversOut;
  let meta;

  if (audiDriversCurrent.length > 0) {
    driversOut = audiDriversCurrent;
    meta = {
      season: current.season ? String(current.season) : null,
      round: current.round ? String(current.round) : null,
      mode: "AUDI_LIVE_FROM_CURRENT_SEASON",
      note: null,
      sources: { driverStandings: current.source },
    };
  } else {
    // 5) Otherwise use Kick Sauber drivers from last year as placeholders
    const last = await getDriverStandingsForSeason(prevYear);

    const sauberDriversLastYear = last.list
      .filter((d) => teamMatchesAny(teamNameFromStandingRow(d), SAUBER_MATCHERS))
      .map((d) =>
        mapDriverStanding(d, headshotMap, {
          teamOverride: "Audi", // Force display team to Audi
          includeOriginalTeam: true,
          placeholder: true,
        })
      );

    driversOut =
      sauberDriversLastYear.length > 0
        ? sauberDriversLastYear
        : [
            {
              position: "P?",
              points: 0,
              wins: 0,
              firstName: "Audi",
              lastName: "Driver 1",
              code: null,
              driverNumber: null,
              team: "Audi",
              headshotUrl: null,
              placeholder: true,
              originalTeam: null,
            },
            {
              position: "P?",
              points: 0,
              wins: 0,
              firstName: "Audi",
              lastName: "Driver 2",
              code: null,
              driverNumber: null,
              team: "Audi",
              headshotUrl: null,
              placeholder: true,
              originalTeam: null,
            },
          ];

    meta = {
      season: last.season ? String(last.season) : prevYear,
      round: last.round ? String(last.round) : null,
      mode: "AUDI_PLACEHOLDERS_FROM_KICK_SAUBER_LAST_YEAR",
      note:
        "Audi not present in current standings yet; showing Kick Sauber drivers from last year as placeholders (team label forced to Audi, Audi colored logo used).",
      sources: { driverStandings: last.source },
    };
  }

  const out = {
    header: "Audi standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      openf1: OPENF1_BASE,
      audiLogoSourcePng: STATIC_AUDI_LOGO_PNG,
      ergastBases: ERGAST_BASES,
      driverStandings: meta.sources.driverStandings,
    },
    meta,
    audi: {
      team: "Audi",
      teamLogoPng: audiLogo.ok ? audiLogo.pngUrl : null,
      teamLogoLocalPath: OUT_LOGO_PNG,
    },
    drivers: driversOut,
  };

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON} (${meta.mode})`);
}

updateAudiStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});