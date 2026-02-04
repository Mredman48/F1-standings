// updateRedBullStandings.js
import fs from "node:fs/promises";
import path from "node:path";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

const ERGAST_BASES = [
  "https://api.jolpi.ca/ergast/f1",
  "https://ergast.com/api/f1",
];

const OPENF1_BASE = "https://api.openf1.org/v1";

const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// ✅ Use existing logo already downloaded in your repo
const TEAMLOGO_PATH = "teamlogos/redbull_logo.png";

// Output JSON
const OUT_JSON = "f1_redbull_standings.json";

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
  const { res, text } = await fetchText(url, {
    Accept: "application/json",
    ...headers,
  });

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON from ${url}: ${text.slice(0, 120)}`);
  }

  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return data;
}

async function fetchErgastWithFallback(p) {
  for (const base of ERGAST_BASES) {
    const url = `${base}${p}`;
    try {
      const data = await fetchJson(url);
      return { data, url };
    } catch {
      continue;
    }
  }
  throw new Error(`All Ergast sources failed for ${p}`);
}

/* ---------------- Headshots ---------------- */

async function getOpenF1HeadshotMap() {
  try {
    const sessions = await fetchJson(
      `${OPENF1_BASE}/sessions?session_key=latest`
    );
    const sessionKey = sessions?.[0]?.session_key;
    if (!sessionKey) return new Map();

    const drivers = await fetchJson(
      `${OPENF1_BASE}/drivers?session_key=${sessionKey}`
    );

    const map = new Map();
    for (const d of drivers) {
      if (d?.driver_number) {
        map.set(Number(d.driver_number), d.headshot_url || null);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/* ---------------- Best Result ---------------- */

async function getDriverBestResult(seasonTag, driverId) {
  try {
    const { data } = await fetchErgastWithFallback(
      `/${seasonTag}/drivers/${driverId}/results.json?limit=500`
    );

    const races = data?.MRData?.RaceTable?.Races || [];
    let bestPos = null;
    let bestRace = null;

    for (const r of races) {
      const result = r?.Results?.[0];
      if (!result) continue;

      const pos = Number(result.position);
      if (!Number.isFinite(pos)) continue;

      if (bestPos === null || pos < bestPos) {
        bestPos = pos;
        bestRace = r;
      }
    }

    if (!bestRace) return null;

    return {
      position: `P${bestPos}`,
      raceName: bestRace.raceName || null,
      round: bestRace.round || null,
      date: bestRace.date || null,
      circuit: bestRace?.Circuit?.circuitName || null,
    };
  } catch {
    return null;
  }
}

/* ---------------- Main ---------------- */

async function updateRedBullStandings() {
  const now = new Date();

  // Headshots
  const headshotMap = await getOpenF1HeadshotMap();

  // Pull current driver standings
  const { data, url } = await fetchErgastWithFallback(
    `/current/driverstandings.json`
  );

  const standings =
    data?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];

  // Find Red Bull drivers
  const redBullDrivers = standings.filter((d) => {
    const team = d?.Constructors?.[0]?.name?.toLowerCase() || "";
    return team.includes("red bull");
  });

  let driversOut = [];

  if (redBullDrivers.length > 0) {
    // Use real Red Bull driver 1
    const d1 = redBullDrivers[0];
    const driver = d1.Driver;

    const num = driver.permanentNumber
      ? Number(driver.permanentNumber)
      : null;

    driversOut.push({
      position: `P${d1.position}`,
      points: Number(d1.points),
      wins: Number(d1.wins),
      firstName: driver.givenName,
      lastName: driver.familyName,
      driverNumber: num,
      headshotUrl: num ? headshotMap.get(num) : null,
      bestResult: await getDriverBestResult("current", driver.driverId),
    });
  } else {
    // Blank placeholder if Red Bull not found
    driversOut.push({
      position: null,
      points: null,
      wins: null,
      firstName: "Max",
      lastName: "Verstappen",
      driverNumber: null,
      headshotUrl: null,
      bestResult: null,
      placeholder: true,
    });
  }

  // Always include Isack Hadjar as driver 2 placeholder
  driversOut.push({
    position: null,
    points: null,
    wins: null,
    firstName: "Isack",
    lastName: "Hadjar",
    driverNumber: null,
    headshotUrl: null,
    bestResult: null,
    placeholder: true,
  });

  // Output JSON
  const out = {
    header: "Red Bull standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      driverStandings: url,
      openf1: OPENF1_BASE,
    },
    redbull: {
      team: "Red Bull",
      teamLogoPng: makePagesUrl(TEAMLOGO_PATH),
    },
    drivers: driversOut,
  };

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateRedBullStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});