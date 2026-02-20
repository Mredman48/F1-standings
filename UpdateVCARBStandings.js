// updateVCARBStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Output JSON
const OUT_JSON = "f1_vcarb_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Repo folders
const TEAMLOGOS_DIR = "teamlogos";
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";

// ✅ VCARB/Racing Bulls logo from your repo (update filename if needed)
const VCARB_LOGO_PNG = `${PAGES_BASE}/${TEAMLOGOS_DIR}/2025_vcarb_color_v2.png`;

// --- Sources ---
// Drivers (who + numbers) from OpenF1
const OPENF1_BASE = "https://api.openf1.org/v1";

// OpenF1 team name can vary; we’ll try these in order
const OPENF1_TEAM_NAMES_TO_TRY = [
  "Racing Bulls",
  "VCARB",
  "RB",
  "Visa Cash App RB",
  "Visa Cash App Racing Bulls",
  "AlphaTauri", // legacy fallback just in case OpenF1 is weird
];

// Standings from Jolpica (Ergast-compatible), Ergast fallback
const ERGAST_BASES = [
  "https://api.jolpi.ca/ergast/f1",
  "https://ergast.com/api/f1",
];

// Ergast constructorId for Racing Bulls can change across eras.
// We'll infer from the two drivers if needed.
const ERGAST_CONSTRUCTOR_ID_HINTS = [
  "rb",
  "racing_bulls",
  "visa_cash_app_rb",
  "alphatauri",
  "toro_rosso",
];

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

// Number PNGs from your repo
function getDriverNumberImageUrl(driverNumber) {
  if (driverNumber == null || driverNumber === "-" || driverNumber === "") return null;
  return `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`;
}

// Headshots local-only, only if file exists in repo checkout
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

// OpenF1 rate-limit safe fetch (backoff on 429)
async function fetchOpenF1Json(path, { retries = 4 } = {}) {
  const url = `${OPENF1_BASE}${path}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const { res, text } = await fetchText(url);

    if (res.status === 429) {
      const waitMs = 1100 + attempt * 900;
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

function dashTeamStanding(teamLabel = "Racing Bulls") {
  return {
    team: teamLabel,
    position: "-",
    points: "-",
    wins: "-",
    originalTeam: "-",
    constructorId: "-",
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

// ---------- OpenF1: get current drivers for Racing Bulls/VCARB ----------

function pickLatestMeetingRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const withMk = rows.filter((r) => r && r.meeting_key != null);
  if (withMk.length === 0) return rows;

  const maxKey = withMk.reduce((m, r) => Math.max(m, Number(r.meeting_key) || -1), -1);
  return rows.filter((r) => Number(r?.meeting_key) === maxKey);
}

async function getVcarbDriversFromOpenF1() {
  // Try multiple possible team_name values until we get >=2 drivers
  for (const teamName of OPENF1_TEAM_NAMES_TO_TRY) {
    try {
      const res = await fetchOpenF1Json(
        `/drivers?meeting_key=latest&team_name=${encodeURIComponent(teamName)}`
      );

      const rows = pickLatestMeetingRows(res.json);

      // De-dupe by driver_number
      const byNum = new Map();
      for (const r of rows) {
        const num = r?.driver_number;
        if (num == null) continue;
        if (!byNum.has(num)) byNum.set(num, r);
      }

      const drivers = Array.from(byNum.values())
        .sort((a, b) => Number(a.driver_number) - Number(b.driver_number))
        .slice(0, 2)
        .map((r) => ({
          firstName: r?.first_name ?? "-",
          lastName: r?.last_name ?? "-",
          code: (r?.name_acronym ?? "-").toUpperCase(),
          driverNumber: r?.driver_number ?? "-",
          openf1TeamNameUsed: teamName,
          fromOpenF1: true,
        }));

      if (drivers.length >= 2) {
        return { drivers, urlUsed: res.urlUsed, teamNameUsed: teamName };
      }
    } catch (e) {
      console.warn(`OpenF1 team_name="${teamName}" failed or empty.`, e.message);
    }
  }

  return { drivers: [], urlUsed: null, teamNameUsed: null };
}

// ---------- Build JSON (OpenF1 drivers + Ergast standings) ----------

async function buildJson() {
  const now = new Date();

  // Fallback placeholders ONLY if OpenF1 returns nothing
  const FALLBACK_DRIVERS = [
    { firstName: "Liam", lastName: "Lawson", code: "LAW", driverNumber: 30, fromOpenF1: false },
    { firstName: "Arvid", lastName: "Lindblad", code: "LIN", driverNumber: 41, fromOpenF1: false },
  ];

  const of1 = await getVcarbDriversFromOpenF1();
  const driversBase = of1.drivers.length === 2 ? of1.drivers : FALLBACK_DRIVERS;

  // Build driver objects (numbers from OpenF1, images from repo)
  const drivers = [];
  for (const d of driversBase) {
    const headshotUrl =
      d.firstName !== "-" && d.lastName !== "-" ? await getSavedHeadshotUrl(d) : null;

    drivers.push({
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

      headshotUrl,

      fromOpenF1: Boolean(d.fromOpenF1),
    });
  }

  let teamStanding = dashTeamStanding("Racing Bulls");
  let lastRace = dashLastRace();
  let placeholderMode = true;

  let urlUsed = {
    openf1Drivers: of1.urlUsed,
    openf1TeamNameUsed: of1.teamNameUsed,
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

    // Fill driver standings: match by acronym (code) first, then last name
    const foundCtorIds = new Map(); // ctorId -> count

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

        const ctorId = String(match?.Constructors?.[0]?.constructorId || "").toLowerCase();
        if (ctorId) foundCtorIds.set(ctorId, (foundCtorIds.get(ctorId) || 0) + 1);
      }
    }

    // Determine constructorId for teamStanding:
    // 1) Any known hint present in standings
    // 2) Else infer from the drivers' constructorId (most common)
    let ctorIdToUse = null;

    for (const hint of ERGAST_CONSTRUCTOR_ID_HINTS) {
      if (
        constructorStandings.some(
          (c) => String(c?.Constructor?.constructorId || "").toLowerCase() === hint
        )
      ) {
        ctorIdToUse = hint;
        break;
      }
    }

    if (!ctorIdToUse && foundCtorIds.size) {
      // take most frequent ctorId among the two drivers
      ctorIdToUse = Array.from(foundCtorIds.entries()).sort((a, b) => b[1] - a[1])[0][0];
    }

    if (ctorIdToUse) {
      const ctorRow = constructorStandings.find(
        (c) => String(c?.Constructor?.constructorId || "").toLowerCase() === ctorIdToUse
      );

      if (ctorRow) {
        teamStanding = {
          team: "Racing Bulls",
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
    console.warn("Standings fetch failed; keeping placeholders.", e.message);
    placeholderMode = true;
  }

  return {
    header: "VCARB standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      openf1: OPENF1_BASE,
      openf1Drivers:
        urlUsed.openf1Drivers ||
        `${OPENF1_BASE}/drivers?meeting_key=latest&team_name=Racing%20Bulls`,
      openf1TeamNameUsed: urlUsed.openf1TeamNameUsed || "NOT_FOUND",
      logos: `LOCAL_ONLY: ${PAGES_BASE}/${TEAMLOGOS_DIR}/`,
      headshots: `LOCAL_ONLY: ${PAGES_BASE}/${HEADSHOTS_DIR}/<first>-<last>.png`,
      driverNumbers: `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-<number>.png`,
      driverStandings: urlUsed.driverStandings || "ERGAST_COMPAT_UNAVAILABLE",
      constructorStandings: urlUsed.constructorStandings || "ERGAST_COMPAT_UNAVAILABLE",
      lastRace: urlUsed.lastRace || "ERGAST_COMPAT_UNAVAILABLE",
      note:
        "Drivers/numbers come from OpenF1 (tries multiple team_name aliases). Standings come from Jolpica (Ergast-compatible) with Ergast fallback. Team standing is inferred from constructor standings or drivers’ constructorId.",
    },
    meta: {
      mode: placeholderMode ? "PLACEHOLDERS_LOCAL_ASSETS" : "OPENF1_DRIVERS_ERGAST_STANDINGS_LOCAL_ASSETS",
      teamAliasesTried: OPENF1_TEAM_NAMES_TO_TRY,
      note:
        "Drivers are fully automatic via OpenF1 (meeting_key=latest). Positions are formatted as P1, P2, etc. Number images are always pulled from your repo using the API-provided number.",
    },
    vcarb: {
      team: "VCARB",
      teamAliases: ["Racing Bulls"],
      teamLogoPng: VCARB_LOGO_PNG,
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