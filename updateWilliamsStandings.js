// updateWilliamsStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Output JSON
const OUT_JSON = "f1_williams_standings.json";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Repo folders
const TEAMLOGOS_DIR = "teamlogos";
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";

// ✅ Williams logo pulled from YOUR repo (GitHub Pages)
const WILLIAMS_LOGO_PNG = `${PAGES_BASE}/${TEAMLOGOS_DIR}/2025_williams_color_v2.png`;

// --- Hybrid sources ---
// Standings via Jolpica (Ergast-compatible); keep Ergast as secondary fallback if it ever responds.
const ERGAST_BASES = [
  "https://api.jolpi.ca/ergast/f1",
  "https://ergast.com/api/f1",
];

const OPENF1_BASE = "https://api.openf1.org/v1";

// Williams constructorId on Ergast/Jolpica
const ERGAST_CONSTRUCTOR_ID = "williams";

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

// ✅ Driver number images (repo-saved)
function getDriverNumberImageUrl(driverNumber) {
  if (driverNumber == null || driverNumber === "-" || driverNumber === "") return null;
  return `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`;
}

// ✅ Headshots (LOCAL ONLY; no downloading) — only return if exists in repo checkout
async function getSavedHeadshotUrl({ firstName, lastName }) {
  const fileName = `${toSlug(firstName)}-${toSlug(lastName)}.png`;
  const localPath = `${HEADSHOTS_DIR}/${fileName}`;

  if (await exists(localPath)) {
    return `${PAGES_BASE}/${HEADSHOTS_DIR}/${fileName}`;
  }
  return null;
}

// ---------- Fetch helpers ----------

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    redirect: "follow",
  });

  const text = await res.text();
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
      const json = await fetchJson(url);
      return { json, urlUsed: url };
    } catch (e) {
      lastErr = e;
      console.warn(`Ergast/Jolpica fetch failed, trying next base. url=${url} err=${e.message}`);
    }
  }

  throw lastErr || new Error("All Ergast/Jolpica bases failed");
}

// OpenF1 rate-limit friendly fetch (simple backoff on 429)
async function fetchOpenF1Json(path, { retries = 4 } = {}) {
  const url = `${OPENF1_BASE}${path}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      redirect: "follow",
    });

    if (res.status === 429) {
      const waitMs = 1100 + attempt * 800; // > 1s to stay under 3 req/sec & avoid burst
      const body = await res.text().catch(() => "");
      console.warn(`OpenF1 429 (rate limited). Waiting ${waitMs}ms. ${body.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}\n${text.slice(0, 200)}`);

    try {
      return { json: JSON.parse(text), urlUsed: url };
    } catch {
      throw new Error(`Invalid JSON from ${url}\n${text.slice(0, 200)}`);
    }
  }

  throw new Error(`OpenF1 rate limited too long for ${url}`);
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

    // hybrid extras
    openf1: {
      meetingName: "-",
      circuitShortName: "-",
      location: "-",
      countryName: "-",
    },
  };
}

function dashTeamStanding() {
  return {
    team: "Williams",
    position: "-",
    points: "-",
    wins: "-",
    originalTeam: "-",
  };
}

// ---------- Ergast/Jolpica response extractors ----------

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
    openf1: {
      meetingName: "-",
      circuitShortName: "-",
      location: "-",
      countryName: "-",
    },
  };
}

// ---------- OpenF1 enrichment (latest completed Race session) ----------

function pickLatestCompletedRaceSession(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return null;

  // Prefer date_end if present; otherwise date_start
  const scored = sessions
    .map((s) => {
      const end = s?.date_end ? Date.parse(s.date_end) : NaN;
      const start = s?.date_start ? Date.parse(s.date_start) : NaN;
      const t = Number.isFinite(end) ? end : start;
      return { s, t };
    })
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => b.t - a.t);

  return scored[0]?.s ?? null;
}

async function enrichLastRaceWithOpenF1(lastRaceObj) {
  // If lastRace date is unknown, we can still try “latest completed Race”
  const nowIso = new Date().toISOString();

  // 1) Find most recent *completed* Race session
  // Using date_end<now to avoid grabbing a future race weekend.
  const sessionsRes = await fetchOpenF1Json(
    `/sessions?session_name=Race&date_end<${encodeURIComponent(nowIso)}`
  );

  const raceSession = pickLatestCompletedRaceSession(sessionsRes.json);
  if (!raceSession) {
    return { lastRace: lastRaceObj, openf1Sources: { sessions: sessionsRes.urlUsed, meeting: null } };
  }

  const meetingKey = raceSession.meeting_key;
  let meetingUrlUsed = null;
  let meeting = null;

  // 2) Meeting details (location/country/circuit name)
  if (meetingKey != null) {
    const meetingRes = await fetchOpenF1Json(`/meetings?meeting_key=${encodeURIComponent(meetingKey)}`);
    meetingUrlUsed = meetingRes.urlUsed;
    meeting = Array.isArray(meetingRes.json) ? meetingRes.json[0] : null;
  }

  const merged = {
    ...lastRaceObj,
    openf1: {
      meetingName: meeting?.meeting_name ?? raceSession?.meeting_name ?? "-",
      circuitShortName: meeting?.circuit_short_name ?? raceSession?.circuit_short_name ?? "-",
      location: meeting?.location ?? "-",
      countryName: meeting?.country_name ?? "-",
    },
  };

  // Optional: also mirror city/country into the Ergast circuit fields if Ergast lacks them
  if (
    merged?.circuit?.locality === "-" &&
    merged?.openf1?.location &&
    merged.openf1.location !== "-"
  ) {
    merged.circuit.locality = merged.openf1.location;
  }
  if (
    merged?.circuit?.country === "-" &&
    merged?.openf1?.countryName &&
    merged.openf1.countryName !== "-"
  ) {
    merged.circuit.country = merged.openf1.countryName;
  }

  return {
    lastRace: merged,
    openf1Sources: { sessions: sessionsRes.urlUsed, meeting: meetingUrlUsed },
  };
}

// ---------- Build JSON (Hybrid: Jolpica standings + OpenF1 lastRace enrichment) ----------

async function buildJson() {
  const now = new Date();

  // ✅ Williams drivers (pinned lineup)
  const driversBase = [
    { firstName: "Alex", lastName: "Albon", code: "ALB", driverNumber: 23 },
    { firstName: "Carlos", lastName: "Sainz", code: "SAI", driverNumber: 55 },
  ];

  const drivers = [];
  for (const d of driversBase) {
    const headshotUrl = await getSavedHeadshotUrl(d);

    drivers.push({
      firstName: d.firstName,
      lastName: d.lastName,
      code: d.code,
      driverNumber: d.driverNumber,

      numberImageUrl: getDriverNumberImageUrl(d.driverNumber),

      // placeholders until standings exist
      position: "-",
      points: "-",
      wins: "-",
      team: "Williams",
      placeholder: true,
      bestResult: dashBestResult(),

      headshotUrl,
    });
  }

  let teamStanding = dashTeamStanding();
  let lastRace = dashLastRace();
  let placeholderMode = true;

  let urlUsed = {
    driverStandings: null,
    constructorStandings: null,
    lastRace: null,
    openf1Sessions: null,
    openf1Meeting: null,
  };

  try {
    // --- Jolpica/Ergast standings ---
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

    // Team row
    const ctorRow = constructorStandings.find(
      (c) => String(c?.Constructor?.constructorId || "").toLowerCase() === ERGAST_CONSTRUCTOR_ID
    );

    if (ctorRow) {
      teamStanding = {
        team: "Williams",
        position: fmtPos(ctorRow.position),
        points: ctorRow.points ?? "-",
        wins: ctorRow.wins ?? "-",
        originalTeam: ctorRow?.Constructor?.name ?? "Williams",
      };
    }

    // Driver rows: match by code or familyName
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
      }
    }

    // --- OpenF1 enrichment (non-fatal) ---
    try {
      const enriched = await enrichLastRaceWithOpenF1(lastRace);
      lastRace = enriched.lastRace;
      urlUsed.openf1Sessions = enriched.openf1Sources.sessions;
      urlUsed.openf1Meeting = enriched.openf1Sources.meeting;
    } catch (e) {
      console.warn("OpenF1 enrichment failed (non-fatal).", e.message);
    }

    const anyDriverLive = drivers.some((d) => d.placeholder === false);
    const teamLive = teamStanding.position !== "-" && teamStanding.points !== "-";
    placeholderMode = !(anyDriverLive || teamLive);
  } catch (e) {
    console.warn("Standings fetch failed; keeping placeholders.", e.message);
    placeholderMode = true;

    // Even if standings fail, we can still *try* OpenF1 for lastRace enrichment
    try {
      const enriched = await enrichLastRaceWithOpenF1(lastRace);
      lastRace = enriched.lastRace;
      urlUsed.openf1Sessions = enriched.openf1Sources.sessions;
      urlUsed.openf1Meeting = enriched.openf1Sources.meeting;
    } catch {
      // ignore
    }
  }

  return {
    header: "Williams standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      logos: `LOCAL_ONLY: ${PAGES_BASE}/${TEAMLOGOS_DIR}/`,
      headshots: `LOCAL_ONLY: ${PAGES_BASE}/${HEADSHOTS_DIR}/<first>-<last>.png`,
      driverNumbers: `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-<number>.png`,

      // Hybrid sources
      driverStandings: urlUsed.driverStandings || "ERGAST_COMPAT_UNAVAILABLE",
      constructorStandings: urlUsed.constructorStandings || "ERGAST_COMPAT_UNAVAILABLE",
      lastRace: urlUsed.lastRace || "ERGAST_COMPAT_UNAVAILABLE",
      openf1Sessions: urlUsed.openf1Sessions || "OPENF1_NOT_USED_OR_UNAVAILABLE",
      openf1Meeting: urlUsed.openf1Meeting || "OPENF1_NOT_USED_OR_UNAVAILABLE",

      note:
        "Hybrid mode: standings from Jolpica (Ergast-compatible) with Ergast fallback; lastRace is enriched from OpenF1 when available.",
    },
    meta: {
      mode: placeholderMode ? "PLACEHOLDERS_LOCAL_ASSETS" : "HYBRID_LIVE_LOCAL_ASSETS",
      note:
        "Before the first race (or if data is unavailable), outputs '-' placeholders. After races, fills positions/points/wins from standings. Positions are formatted as P1, P2, etc. Last-race city/country may be enriched via OpenF1.",
    },
    williams: {
      team: "Williams",
      teamLogoPng: WILLIAMS_LOGO_PNG,
      teamStanding,
    },
    lastRace,
    drivers,
  };
}

// ---------- Main ----------

async function updateWilliamsStandings() {
  const out = await buildJson();
  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateWilliamsStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});