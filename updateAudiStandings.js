// updateAudiStandings.js
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Ergast-compatible sources
const ERGAST_BASES = ["https://api.jolpi.ca/ergast/f1", "https://ergast.com/api/f1"];

// OpenF1 (headshots)
const OPENF1_BASE = "https://api.openf1.org/v1";

// Your GitHub Pages base (update if needed)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Where we save PNG logos (must be committed)
const TEAMLOGO_DIR = "teamlogos";

// ✅ Official Audi logo on F1 media CDN (correct team)
const AUDI_LOGO_WEBP =
  "https://media.formula1.com/image/upload/c_fit,h_1024/q_auto/v1740000000/common/f1/2026/audi/2026audilogowhite.webp";

// Output files
const OUT_JSON = "f1_audi_standings.json";
const OUT_LOGO_PNG = `${TEAMLOGO_DIR}/audi_logo_1024.png`;

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

/* -------------------- Audi logo: always PNG output -------------------- */

async function buildAudiLogoPngIfMissing() {
  // If it already exists, don't re-download (stable URL for Widgy)
  try {
    await fs.access(OUT_LOGO_PNG);
    return { ok: true, pngUrl: makePagesUrl(OUT_LOGO_PNG), note: "cached" };
  } catch {
    // continue
  }

  await ensureDir(TEAMLOGO_DIR);

  // Download official Audi logo webp (hi-res)
  const webp = await fetchBuffer(AUDI_LOGO_WEBP);

  // Convert to PNG (keeps transparency)
  const png = await sharp(webp).png().toBuffer();

  await fs.writeFile(OUT_LOGO_PNG, png);
  return { ok: true, pngUrl: makePagesUrl(OUT_LOGO_PNG), note: "from_f1_media_cdn" };
}

/* -------------------- OpenF1 headshots (best-effort) -------------------- */

async function getOpenF1HeadshotMap() {
  // Uses latest session so it works even before the current season starts
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

/* -------------------- Ergast standings + fallback -------------------- */

function parseDriverStandings(payload) {
  const list =
    safeGet(payload, ["MRData", "StandingsTable", "StandingsLists", 0, "DriverStandings"]) || [];
  const season = safeGet(payload, ["MRData", "StandingsTable", "season"]) || null;
  const round = safeGet(payload, ["MRData", "StandingsTable", "round"]) || null;
  const total = Number(payload?.MRData?.total || 0);

  return { list: Array.isArray(list) ? list : [], season, round, total };
}

async function getDriverStandingsWithFallback() {
  const now = new Date();
  const prevYear = String(now.getUTCFullYear() - 1);

  // Try current
  const cur = await fetchErgastWithFallback(`/current/driverstandings.json`);
  const curParsed = parseDriverStandings(cur.data);

  if (curParsed.total > 0 && curParsed.list.length > 0) {
    return { ...curParsed, source: cur.url, usedFallback: false, seasonTag: "current", note: null };
  }

  // Fallback previous season
  const prev = await fetchErgastWithFallback(`/${prevYear}/driverstandings.json`);
  const prevParsed = parseDriverStandings(prev.data);

  return {
    ...prevParsed,
    source: prev.url,
    usedFallback: true,
    seasonTag: prevYear,
    note: `No current season standings yet; using ${prevYear}.`,
  };
}

async function getAudiConstructorStanding(seasonTag) {
  // Try to pull Audi constructor entry if available
  try {
    const { data, url } = await fetchErgastWithFallback(`/${seasonTag}/constructorstandings.json`);
    const list =
      safeGet(data, ["MRData", "StandingsTable", "StandingsLists", 0, "ConstructorStandings"]) || [];
    const standings = Array.isArray(list) ? list : [];

    const audiRow = standings.find((c) =>
      String(c?.Constructor?.name || "").toLowerCase().includes("audi")
    );

    return { audiRow: audiRow || null, source: url };
  } catch {
    return { audiRow: null, source: null };
  }
}

function mapDriverStanding(d, headshotMap) {
  const driver = d.Driver || {};
  const constructors = Array.isArray(d.Constructors) ? d.Constructors : [];
  const teamName = constructors[0]?.name || null;

  const num = driver.permanentNumber ? Number(driver.permanentNumber) : null;

  return {
    position: d.position ? `P${d.position}` : null,
    points: d.points ? Number(d.points) : null,
    wins: d.wins ? Number(d.wins) : null,
    firstName: driver.givenName || null,
    lastName: driver.familyName || null,
    code: driver.code || null,
    driverNumber: num,
    team: teamName,
    headshotUrl: num != null ? headshotMap.get(num) || null : null,
  };
}

/* -------------------- main -------------------- */

async function updateAudiStandings() {
  const now = new Date();

  // 1) Build the Audi logo PNG
  const audiLogo = await buildAudiLogoPngIfMissing();

  // 2) Headshots (best-effort)
  const headshotMap = await getOpenF1HeadshotMap();

  // 3) Standings (with fallback season)
  const standings = await getDriverStandingsWithFallback();

  // 4) Filter Audi drivers from driver standings (if they exist)
  const audiDrivers = standings.list
    .filter((d) => {
      const constructors = Array.isArray(d.Constructors) ? d.Constructors : [];
      const teamName = constructors[0]?.name || "";
      return teamName.toLowerCase().includes("audi");
    })
    .map((d) => mapDriverStanding(d, headshotMap));

  // 5) If none exist yet, provide placeholders so you can design widgets
  const driversOut =
    audiDrivers.length > 0
      ? audiDrivers
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
          },
        ];

  // 6) Audi constructor standing (best-effort)
  const ctor = await getAudiConstructorStanding(standings.seasonTag);
  const audiCtor = ctor.audiRow;

  const out = {
    header: "Audi standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      driverStandings: standings.source,
      constructorStandings: ctor.source,
      openf1: OPENF1_BASE,
      audiLogoSourceWebp: AUDI_LOGO_WEBP,
    },
    meta: {
      season: standings.season ? String(standings.season) : null,
      round: standings.round ? String(standings.round) : null,
      usedFallback: Boolean(standings.usedFallback),
      note: standings.note || null,
    },
    audi: {
      team: "Audi",
      teamLogoPng: audiLogo.ok ? audiLogo.pngUrl : null,
      teamLogoLocalPath: OUT_LOGO_PNG,
      constructorStanding: audiCtor
        ? {
            position: audiCtor.position ? `P${audiCtor.position}` : null,
            points: audiCtor.points ? Number(audiCtor.points) : null,
            wins: audiCtor.wins ? Number(audiCtor.wins) : null,
          }
        : null,
    },
    drivers: driversOut,
  };

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateAudiStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});