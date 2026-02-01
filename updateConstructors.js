// updateConstructors.js
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";
const BASES = ["https://api.jolpi.ca/ergast/f1"];

// Your GitHub Pages base
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Folder where we store team logo PNGs (committed to repo)
const TEAMLOGO_DIR = "teamlogos";

// Bump this any time you want to force-regenerate logos
const LOGO_VERSION = "v4";

// Force hi-res download from F1 CDN
const LOGO_HEIGHT = 2048;
const LOGO_QUALITY = 100;

// Team -> Formula1.com team page slug (official site)
const TEAM_F1_PAGE_SLUG = {
  "Red Bull": "red-bull-racing",
  "Ferrari": "ferrari",
  "Mercedes": "mercedes",
  "McLaren": "mclaren",
  "Aston Martin": "aston-martin",
  "Alpine F1 Team": "alpine",
  "Williams": "williams",
  "Haas F1 Team": "haas",
  "Sauber": "kick-sauber",
  "VCARB": "racing-bulls",
  "Audi": "audi",
};

// Team hex colors (edit anytime)
const TEAM_HEX = {
  "Red Bull": "#1E41FF",
  "Ferrari": "#DC0000",
  "Mercedes": "#00D2BE",
  "McLaren": "#FF8700",
  "Aston Martin": "#006F62",
  "Alpine F1 Team": "#0090FF",
  "Williams": "#005AFF",
  "Haas F1 Team": "#B6BABD",
  "Sauber": "#00E701",
  "VCARB": "#2B4562",
  "Audi": "#000000",
};

function cleanTeamName(name) {
  const n = (name || "").trim();
  if (/red bull racing/i.test(n)) return "Red Bull";
  if (/RB F1 Team/i.test(n)) return "VCARB";
  return n;
}

/* -------------------- utils -------------------- */

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

function safeGet(obj, pathArr) {
  return pathArr.reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), obj);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
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

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON from ${url}: ${text.slice(0, 160)}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return { data, url, status: res.status };
}

async function fetchWithFallback(paths) {
  const attempts = [];
  for (const base of BASES) {
    for (const p of paths) {
      const url = `${base}${p}`;
      try {
        const out = await fetchJson(url);
        return { ...out, attempts };
      } catch (e) {
        attempts.push({ url, error: e?.message || String(e) });
      }
    }
  }
  throw new Error(`All fetch attempts failed: ${JSON.stringify(attempts, null, 2)}`);
}

/* -------------------- standings parsing -------------------- */

function parseConstructorStandingsPayload(payload) {
  const mr = payload?.MRData || {};
  const season = mr?.StandingsTable?.season || null;
  const round = mr?.StandingsTable?.round ?? null;

  const list =
    safeGet(payload, ["MRData", "StandingsTable", "StandingsLists", 0, "ConstructorStandings"]) || [];

  const total = Number(mr.total || 0);

  return {
    season,
    round,
    total,
    raw: Array.isArray(list) ? list : [],
  };
}

async function getStandingsWithFallback(now) {
  const utcYear = now.getUTCFullYear();

  const currentRes = await fetchWithFallback([
    "/current/constructorstandings.json",
    "/current/constructorStandings.json",
  ]);
  const currentParsed = parseConstructorStandingsPayload(currentRes.data);

  const inferredCurrentSeason = currentParsed.season ? Number(currentParsed.season) : null;
  const fallbackSeason = inferredCurrentSeason ? String(inferredCurrentSeason - 1) : String(utcYear - 1);

  let used = {
    tag: "current",
    url: currentRes.url,
    season: currentParsed.season,
    round: currentParsed.round,
    total: currentParsed.total,
    raw: currentParsed.raw,
    usedFallback: false,
    note: null,
  };

  if (used.total === 0 || used.raw.length === 0) {
    const prevRes = await fetchWithFallback([
      `/${fallbackSeason}/constructorstandings.json`,
      `/${fallbackSeason}/constructorStandings.json`,
    ]);
    const prevParsed = parseConstructorStandingsPayload(prevRes.data);

    if (prevParsed.total > 0 && prevParsed.raw.length > 0) {
      used = {
        tag: fallbackSeason,
        url: prevRes.url,
        season: prevParsed.season || fallbackSeason,
        round: prevParsed.round,
        total: prevParsed.total,
        raw: prevParsed.raw,
        usedFallback: true,
        note: `No constructor standings available for current season yet; showing ${fallbackSeason} season instead.`,
      };
    } else {
      used.note = "No constructor standings available yet (season not started or standings not published).";
    }
  }

  return used;
}

async function getLastRaceForSeason(seasonTag) {
  try {
    const { data, url } = await fetchWithFallback([
      `/${seasonTag}/last/results.json`,
      `/${seasonTag}/last/Results.json`,
    ]);

    const race = safeGet(data, ["MRData", "RaceTable", "Races", 0]) || null;

    return {
      source: url,
      season: race?.season ? Number(race.season) : null,
      round: race?.round ? Number(race.round) : null,
      name: race?.raceName || null,
      date: race?.date || null,
      timeUtc: race?.time || null,
      circuit: race?.Circuit?.circuitName || null,
      locality: race?.Circuit?.Location?.locality || null,
      country: race?.Circuit?.Location?.country || null,
    };
  } catch {
    return {
      source: null,
      season: null,
      round: null,
      name: null,
      date: null,
      timeUtc: null,
      circuit: null,
      locality: null,
      country: null,
    };
  }
}

/* -------------------- official F1 logos: scrape + upgrade + convert -------------------- */

/**
 * Pull either ...logowhite.webp or ...logolight.webp from the team page HTML.
 * Ferrari tends to use logolight (full colour).
 */
function extractLogoWebpFromTeamPage(html, season, team) {
  const re = new RegExp(
    `https://media\\.formula1\\.com/image/upload[^"']+/common/f1/${season}/[^"']+?logo(?:white|light)\\.webp`,
    "ig"
  );

  const matches = html.match(re) || [];
  if (matches.length === 0) return null;

  // Ferrari: prefer full-colour "logolight"
  if (team === "Ferrari") {
    const light = matches.find((u) => /logolight\.webp/i.test(u));
    if (light) return light;
  }

  // Others: prefer white if present
  const white = matches.find((u) => /logowhite\.webp/i.test(u));
  return white || matches[0];
}

/**
 * Force higher resolution + quality on a media.formula1.com URL.
 */
function upgradeF1MediaUrl(webpUrl) {
  if (!webpUrl) return null;

  let u = webpUrl;
  try {
    u = decodeURIComponent(webpUrl);
  } catch {
    // keep original
  }

  u = u
    .replace(/h_\d+/i, `h_${LOGO_HEIGHT}`)
    .replace(/q_auto/i, `q_${LOGO_QUALITY}`);

  if (!/\/q_\d+/.test(u) && /\/image\/upload\//.test(u)) {
    u = u.replace("/image/upload/", `/image/upload/q_${LOGO_QUALITY}/`);
  }

  return u;
}

async function buildTeamLogoPng({ team, season }) {
  const pageSlug = TEAM_F1_PAGE_SLUG[team];
  if (!pageSlug) {
    return { ok: false, pngUrl: null, note: "No F1 team page slug mapping for this team." };
  }

  const outRel = `${TEAMLOGO_DIR}/${season}_${safeFileSlug(team)}_${LOGO_VERSION}.png`;
  const outPath = path.join(outRel);

  // Reuse if already generated
  try {
    await fs.access(outPath);
    return { ok: true, pngUrl: makePagesUrl(outRel), note: "Reused cached PNG in repo." };
  } catch {
    // continue
  }

  const teamPageUrl = `https://www.formula1.com/en/teams/${pageSlug}`;
  const html = await fetchText(teamPageUrl);

  const webpUrl = extractLogoWebpFromTeamPage(html, season, team);
  if (!webpUrl) {
    return { ok: false, pngUrl: null, note: "No logo found on F1 team page." };
  }

  const hiResUrl = upgradeF1MediaUrl(webpUrl);
  const buf = await fetchBuffer(hiResUrl);

  await ensureDir(TEAMLOGO_DIR);

  const pngBuf = await sharp(buf)
    .png({ quality: 100, compressionLevel: 9 })
    .toBuffer();

  await fs.writeFile(outPath, pngBuf);

  return { ok: true, pngUrl: makePagesUrl(outRel), note: null };
}

/* -------------------- output mapping -------------------- */

function mapConstructorStanding(cs) {
  const ctor = cs?.Constructor || {};
  const team = cleanTeamName(ctor?.name || ctor?.Name || "");

  return {
    position: cs.position ? Number(cs.position) : null,
    positionText: cs.position ? `P${cs.position}` : null,
    points: cs.points ? Number(cs.points) : null,
    wins: cs.wins ? Number(cs.wins) : null,
    team: team || null,
    teamHex: TEAM_HEX[team] || null,
    teamLogoPng: null, // filled later
    _teamKey: team, // internal
  };
}

async function ensureDummyLogo() {
  await ensureDir(TEAMLOGO_DIR);
  const rel = `${TEAMLOGO_DIR}/dummy_team_${LOGO_VERSION}.png`;
  const filePath = path.join(rel);

  try {
    await fs.access(filePath);
  } catch {
    const size = 512;
    const svg = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 20}"
                fill="none" stroke="rgba(0,0,0,0.20)" stroke-width="18"/>
        <text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle"
              font-family="Arial" font-size="90" fill="rgba(0,0,0,0.35)">P11</text>
      </svg>
    `;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    await fs.writeFile(filePath, png);
  }

  return makePagesUrl(rel);
}

/* -------------------- main -------------------- */

async function updateConstructors() {
  const now = new Date();

  const used = await getStandingsWithFallback(now);

  const seasonNum = used.season ? Number(used.season) : null;
  const seasonStr =
    seasonNum ? String(seasonNum) : used.tag === "current" ? String(now.getUTCFullYear()) : String(used.tag);

  const lastRace = await getLastRaceForSeason(used.tag);

  let constructors = used.raw.map(mapConstructorStanding);

  for (const c of constructors) {
    const team = c._teamKey;

    try {
      const result = await buildTeamLogoPng({ team, season: seasonStr });
      c.teamLogoPng = result.pngUrl;
      c.logoNote = result.ok ? null : result.note;
    } catch (e) {
      c.teamLogoPng = null;
      c.logoNote = e?.message || String(e);
    }

    delete c._teamKey;
  }

  // Add dummy P11 only if fewer than 11 teams returned
  if (constructors.length < 11) {
    const dummyLogoUrl = await ensureDummyLogo();
    constructors.push({
      position: constructors.length + 1,
      positionText: `P${constructors.length + 1}`,
      points: 0,
      wins: 0,
      team: "Dummy Team",
      teamHex: "#999999",
      teamLogoPng: dummyLogoUrl,
      dummy: true,
    });
  }

  const out = {
    header: `${now.getUTCFullYear()} constructors standings`,
    generatedAtUtc: now.toISOString(),
    source: { constructors: used.url },
    meta: {
      usedSeasonTag: used.tag,
      season: seasonNum ? seasonNum : null,
      round: used.round !== null && used.round !== undefined ? Number(used.round) : null,
      total: used.total,
      usedFallback: used.usedFallback,
      note: used.note,
      logos: {
        source: "formula1.com official CDN",
        format: "png",
        heightRequested: LOGO_HEIGHT,
        qualityRequested: LOGO_QUALITY,
        folder: TEAMLOGO_DIR,
        version: LOGO_VERSION,
      },
    },
    lastRace,
    constructors,
  };

  await fs.writeFile("f1_constructor_standings.json", JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote f1_constructor_standings.json (seasonTag=${used.tag}, season=${seasonStr})`);
}

updateConstructors().catch((err) => {
  console.error(err);
  process.exit(1);
});