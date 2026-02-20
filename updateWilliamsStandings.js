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

// ✅ Williams logo from your repo
const WILLIAMS_LOGO_FILE = "2025_williams_color_v2.png";
const WILLIAMS_LOGO_PNG = `${PAGES_BASE}/${TEAMLOGOS_DIR}/${WILLIAMS_LOGO_FILE}`;

// --- Sources ---
const OPENF1_BASE = "https://api.openf1.org/v1";
const OPENF1_TEAM_NAMES_TO_TRY = [
  "Williams",
  "Williams Racing",
  "Atlassian Williams Racing",
];

const ERGAST_BASES = ["https://api.jolpi.ca/ergast/f1", "https://ergast.com/api/f1"];
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

// 🔥 Name normalization (Alexander → Alex Albon)
function normalizeDriverName(firstName, lastName) {
  const fn = String(firstName || "");
  const ln = String(lastName || "");

  if (fn.toLowerCase() === "alexander" && ln.toLowerCase() === "albon") {
    return { firstName: "Alex", lastName: "Albon" };
  }

  return {
    firstName: fn || "-",
    lastName: ln || "-",
  };
}

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function getDriverNumberImageUrl(driverNumber) {
  if (driverNumber == null || driverNumber === "-" || driverNumber === "") return null;
  return `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`;
}

async function getSavedHeadshotUrl({ firstName, lastName }) {
  if (!firstName || !lastName || firstName === "-" || lastName === "-") return null;

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
  return JSON.parse(text);
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
      console.warn(`Ergast fetch failed: ${url}`);
    }
  }
  throw lastErr || new Error("All Ergast bases failed");
}

async function fetchOpenF1Json(path, { retries = 4 } = {}) {
  const url = `${OPENF1_BASE}${path}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const { res, text } = await fetchText(url);

    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1200 + attempt * 800));
      continue;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return { json: JSON.parse(text), urlUsed: url };
  }

  throw new Error(`OpenF1 rate limit exceeded: ${url}`);
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

// ---------- OpenF1 Drivers ----------

function pickLatestMeetingRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const maxKey = Math.max(...rows.map((r) => Number(r.meeting_key) || 0));
  return rows.filter((r) => Number(r.meeting_key) === maxKey);
}

async function getWilliamsDriversFromOpenF1() {
  for (const teamName of OPENF1_TEAM_NAMES_TO_TRY) {
    try {
      const res = await fetchOpenF1Json(
        `/drivers?meeting_key=latest&team_name=${encodeURIComponent(teamName)}`
      );

      const rows = pickLatestMeetingRows(res.json);

      const byNum = new Map();
      for (const r of rows) {
        if (!byNum.has(r.driver_number)) byNum.set(r.driver_number, r);
      }

      const drivers = Array.from(byNum.values())
        .sort((a, b) => Number(a.driver_number) - Number(b.driver_number))
        .slice(0, 2)
        .map((r) => {
          const normalized = normalizeDriverName(r.first_name, r.last_name);

          return {
            firstName: normalized.firstName,
            lastName: normalized.lastName,
            code: (r?.name_acronym ?? "-").toUpperCase(),
            driverNumber: r?.driver_number ?? "-",
          };
        });

      if (drivers.length >= 2) {
        return { drivers, urlUsed: res.urlUsed };
      }
    } catch (e) {
      console.warn(`OpenF1 failed for ${teamName}`);
    }
  }

  return { drivers: [], urlUsed: null };
}

// ---------- Build JSON ----------

async function buildJson() {
  const now = new Date();

  const of1 = await getWilliamsDriversFromOpenF1();

  const drivers = [];
  for (const d of of1.drivers) {
    const headshotUrl = await getSavedHeadshotUrl(d);

    drivers.push({
      ...d,
      numberImageUrl: getDriverNumberImageUrl(d.driverNumber),
      position: "-",
      points: "-",
      wins: "-",
      team: "Williams",
      placeholder: true,
      bestResult: { position: "-", raceName: "-", round: "-", date: "-", circuit: "-" },
      headshotUrl,
    });
  }

  let teamStanding = {
    team: "Williams",
    position: "-",
    points: "-",
    wins: "-",
    originalTeam: "-",
  };

  let lastRace = {
    season: "-",
    round: "-",
    raceName: "-",
    date: "-",
    timeUtc: "-",
    circuit: { name: "-", locality: "-", country: "-" },
  };

  try {
    const ds = await fetchFromAnyErgastBase("/current/driverStandings.json");
    const cs = await fetchFromAnyErgastBase("/current/constructorStandings.json");
    const lr = await fetchFromAnyErgastBase("/current/last/results.json");

    const driverStandings = getCurrentDriverStandings(ds.json);
    const constructorStandings = getCurrentConstructorStandings(cs.json);
    const lrParsed = getLastRaceResult(lr.json);
    if (lrParsed) lastRace = lrParsed;

    const ctor = constructorStandings.find(
      (c) => c?.Constructor?.constructorId === ERGAST_CONSTRUCTOR_ID
    );

    if (ctor) {
      teamStanding = {
        team: "Williams",
        position: fmtPos(ctor.position),
        points: ctor.points,
        wins: ctor.wins,
        originalTeam: ctor?.Constructor?.name,
      };
    }

    for (const d of drivers) {
      const match = driverStandings.find(
        (row) =>
          row?.Driver?.code === d.code ||
          row?.Driver?.familyName?.toLowerCase() === d.lastName.toLowerCase()
      );

      if (match) {
        d.position = fmtPos(match.position);
        d.points = match.points;
        d.wins = match.wins;
        d.placeholder = false;
      }
    }
  } catch (e) {
    console.warn("Standings fetch failed.");
  }

  return {
    header: "Williams standings",
    generatedAtUtc: now.toISOString(),
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