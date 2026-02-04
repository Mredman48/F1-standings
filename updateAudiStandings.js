// updateAudiStandings.js
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

const ERGAST_BASES = ["https://api.jolpi.ca/ergast/f1", "https://ergast.com/api/f1"];
const OPENF1_BASE = "https://api.openf1.org/v1";

// Your GitHub Pages base
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Where we save PNG logos to commit
const TEAMLOGO_DIR = "teamlogos";

// Cache-bust version tag for filenames
const LOGO_VERSION = "audi_v1";

// Fetch a higher-res logo from F1 CDN
const LOGO_HEIGHT = 512;
const LOGO_QUALITY = 100;

function safeGet(obj, pathArr) {
  return pathArr.reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), obj);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function makePagesUrl(relPath) {
  return `${PAGES_BASE}/${relPath.split(path.sep).join("/")}`;
}

function safeFileSlug(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
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
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
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

/* -------------------- OpenF1 headshots -------------------- */

async function getOpenF1HeadshotMap() {
  // Use latest session so it works even before current season starts.
  // This returns drivers for the most recent session OpenF1 knows about.
  try {
    const sessions = await fetchJson(`${OPENF1_BASE}/sessions?session_key=latest`);
    const sessionKey = Array.isArray(sessions) ? sessions[0]?.session_key : null;
    if (!sessionKey) return new Map();

    const drivers = await fetchJson(`${OPENF1_BASE}/drivers?session_key=${encodeURIComponent(sessionKey)}`);
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

/* -------------------- Audi logo (official F1 CDN -> PNG) -------------------- */

function extractMediaUrlFromTeamPage(html) {
  // Grab any logo webp for Audi from the page:
  // https://media.formula1.com/image/upload/.../common/f1/<year>/audi/...logo*.webp
  const re = /https:\/\/media\.formula1\.com\/image\/upload\/[^"']+?\/common\/f1\/\d{4}\/[^"']+?logo[^"']*?\.webp/ig;
  const matches = html.match(re) || [];

  // Prefer colored/light if available, else first match
  const light = matches.find((u) => /logolight\.webp/i.test(u));
  return light || matches[0] || null;
}

function upgradeF1MediaTransforms(url) {
  // Replace h_### and q_auto if present; otherwise inject quality
  let u = url;
  u = u.replace(/h_\d+/i, `h_${LOGO_HEIGHT}`);
  u = u.replace(/q_auto/i, `q_${LOGO_QUALITY}`);

  if (!/\/q_\d+/.test(u) && /\/image\/upload\//.test(u)) {
    u = u.replace("/image/upload/", `/image/upload/q_${LOGO_QUALITY}/`);
  }
  if (!/\/h_\d+/.test(u) && /\/image\/upload\//.test(u)) {
    // If no height transform exists, just add it after upload/
    u = u.replace("/image/upload/", `/image/upload/c_fit,h_${LOGO_HEIGHT},q_${LOGO_QUALITY}/`);
  }
  return u;
}

async function getOrBuildAudiLogoPng() {
  const rel = `${TEAMLOGO_DIR}/audi_${LOGO_VERSION}.png`;
  const outPath = path.join(rel);

  // If already exists, reuse
  try {
    await fs.access(outPath);
    return { ok: true, pngUrl: makePagesUrl(rel), note: "cached" };
  } catch {
    // continue
  }

  // Scrape official team page to find the current CDN asset URL
  const teamPage = "https://www.formula1.com/en/teams/audi";
  const { res, text } = await fetchText(teamPage, { Accept: "text/html,*/*" });
  if (!res.ok) return { ok: false, pngUrl: null, note: `Team page HTTP ${res.status}` };

  const mediaUrl = extractMediaUrlFromTeamPage(text);
  if (!mediaUrl) return { ok: false, pngUrl: null, note: "No Audi logo found on team page" };

  const hiResWebpUrl = upgradeF1MediaTransforms(mediaUrl);

  const webp = await fetchBuffer(hiResWebpUrl);

  await ensureDir(TEAMLOGO_DIR);

  const png = await sharp(webp).png({ quality: 100, compressionLevel: 9 }).toBuffer();
  await fs.writeFile(outPath, png);

  return { ok: true, pngUrl: makePagesUrl(rel), note: "from_f1_cdn" };
}

/* -------------------- Ergast: Audi drivers/constructor -------------------- */

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

  // current first
  const cur = await fetchErgastWithFallback(`/current/driverstandings.json`);
  const curParsed = parseDriverStandings(cur.data);

  if (curParsed.total > 0 && curParsed.list.length > 0) {
    return { ...curParsed, source: cur.url, usedFallback: false, seasonTag: "current" };
  }

  // fallback previous season
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

async function getConstructorStandingsForAudiWithFallback(seasonTag) {
  // Get constructor standings so we can pull Audi points too (if available)
  // If Audi not present, will return null constructor.
  try {
    const { data, url } = await fetchErgastWithFallback(`/${seasonTag}/constructorstandings.json`);
    const list =
      safeGet(data, ["MRData", "StandingsTable", "StandingsLists", 0, "ConstructorStandings"]) || [];
    const standings = Array.isArray(list) ? list : [];
    const audiRow = standings.find((c) => String(c?.Constructor?.name || "").toLowerCase().includes("audi"));
    return { audiRow: audiRow || null, source: url };
  } catch {
    return { audiRow: null, source: null };
  }
}

function mapDriver(d, headshotMap) {
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

async function updateAudiStandings() {
  const now = new Date();

  const headshotMap = await getOpenF1HeadshotMap();
  const audiLogo = await getOrBuildAudiLogoPng();

  const standings = await getDriverStandingsWithFallback();

  // Filter drivers whose constructor name contains "Audi"
  const audiDrivers = standings.list
    .filter((d) => {
      const constructors = Array.isArray(d.Constructors) ? d.Constructors : [];
      const teamName = constructors[0]?.name || "";
      return teamName.toLowerCase().includes("audi");
    })
    .map((d) => mapDriver(d, headshotMap));

  // If there are no Audi drivers yet, add placeholders so you can build the widget
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

  // Audi constructor points (best-effort)
  const ctor = await getConstructorStandingsForAudiWithFallback(standings.seasonTag);
  const audiCtor = ctor.audiRow;

  const out = {
    header: "Audi standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      driverStandings: standings.source,
      openf1: OPENF1_BASE,
      audiTeamPage: "https://www.formula1.com/en/teams/audi",
      constructorStandings: ctor.source,
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
      teamLogoNote: audiLogo.ok ? null : audiLogo.note,
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

  await fs.writeFile("f1_audi_standings.json", JSON.stringify(out, null, 2), "utf8");
  console.log("Wrote f1_audi_standings.json");
}

updateAudiStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});