
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";
const BASES = ["https://api.jolpi.ca/ergast/f1"];

// Your GitHub Pages base (where Widgy reads from)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Folder committed to repo for PNG logos
const TEAMLOGO_DIR = "teamlogos";

// Bump this to force new filenames (Widgy cache bust)
const LOGO_VERSION = "color_v2";

// High-res download request from F1 CDN
const LOGO_HEIGHT = 2048;
const LOGO_QUALITY = 100;

// F1 CDN uses a version segment (often changes). We try to learn it from team pages.
const DEFAULT_MEDIA_VERSION = "v1740000000";

// Team name cleanup to match your naming preferences
function cleanTeamName(name) {
  const n = (name || "").trim();
  if (/red bull racing/i.test(n)) return "Red Bull";
  if (/RB F1 Team/i.test(n)) return "VCARB";
  return n;
}

// Team colors (hex)
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
  "Cadillac": "#111111",
};

// Formula1.com team page slug
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
  "Cadillac": "cadillac",
};

/**
 * OFFICIAL F1 CDN "common/f1/{season}/{teamFolder}/" folder mapping.
 * These folder names are used in the media URL path.
 * (They’re not always identical to the team page slug.)
 */
const TEAM_F1_MEDIA_FOLDER = {
  "Red Bull": "redbullracing",
  "Ferrari": "ferrari",
  "Mercedes": "mercedes",
  "McLaren": "mclaren",
  "Aston Martin": "astonmartin",
  "Alpine F1 Team": "alpine",
  "Williams": "williams",
  "Haas F1 Team": "haas",
  "Sauber": "kicksauber",
  "VCARB": "racingbulls",
  "Audi": "audi",
  // Cadillac folder naming on CDN may differ; we’ll scrape as fallback
  "Cadillac": "cadillac",
};

/**
 * Preferred logo filename patterns to try (coloured first).
 */
function logoFilenameCandidates(season, team) {
  const folder = TEAM_F1_MEDIA_FOLDER[team];
  if (!folder) return [];
  return [
    `${season}${folder}logo.webp`,       // coloured (often)
    `${season}${folder}logolight.webp`,  // coloured/light
    `${season}${folder}logowhite.webp`,  // white
  ];
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

/* -------------------- standings + fallback -------------------- */

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

/* -------------------- F1 coloured logo builder -------------------- */

function extractMediaVersionFromHtml(html) {
  const m = html.match(/\/(v\d{6,})\//i);
  return m ? m[1] : DEFAULT_MEDIA_VERSION;
}

// Scrape *any* logo(light/white) URL from a team page (used as robust fallback — Cadillac)
function scrapeAnyLogoFromTeamPage(html, season) {
  const re = new RegExp(
    `https://media\\.formula1\\.com/image/upload[^"']+/common/f1/${season}/[^"']+?logo(?:light|white|)\\.webp`,
    "ig"
  );
  const matches = html.match(re) || [];
  // Prefer coloured/light if present
  const light = matches.find((u) => /logolight\.webp/i.test(u));
  return light || matches[0] || null;
}

function buildF1MediaUrl({ version, season, team, filename }) {
  const folder = TEAM_F1_MEDIA_FOLDER[team];
  if (!folder) return null;
  const transforms = `c_fit,h_${LOGO_HEIGHT},q_${LOGO_QUALITY}`;
  return `https://media.formula1.com/image/upload/${transforms}/${version}/common/f1/${season}/${folder}/${filename}`;
}

async function findBestColouredLogoWebpUrl({ season, team }) {
  const pageSlug = TEAM_F1_PAGE_SLUG[team];
  let version = DEFAULT_MEDIA_VERSION;
  let pageHtml = null;

  if (pageSlug) {
    try {
      pageHtml = await fetchText(`https://www.formula1.com/en/teams/${pageSlug}`);
      version = extractMediaVersionFromHtml(pageHtml) || DEFAULT_MEDIA_VERSION;
    } catch {
      // ignore
    }
  }

  // 1) Try predictable official CDN filenames first
  const candidates = logoFilenameCandidates(season, team);
  for (const filename of candidates) {
    const url = buildF1MediaUrl({ version, season, team, filename });
    if (!url) continue;
    try {
      await fetchBuffer(url);
      return { url, version, filename, strategy: "pattern" };
    } catch {
      // try next
    }
  }

  // 2) Fallback: scrape the team page for an actual logo URL and then upgrade transforms
  if (pageHtml) {
    const scraped = scrapeAnyLogoFromTeamPage(pageHtml, season);
    if (scraped) {
      // Upgrade transforms by rewriting h_ / q_
      let u = scraped;
      try {
        u = decodeURIComponent(u);
      } catch {}
      u = u.replace(/h_\d+/i, `h_${LOGO_HEIGHT}`).replace(/q_auto/i, `q_${LOGO_QUALITY}`);
      if (!/\/q_\d+/.test(u) && /\/image\/upload\//.test(u)) {
        u = u.replace("/image/upload/", `/image/upload/q_${LOGO_QUALITY}/`);
      }
      try {
        await fetchBuffer(u);
        return { url: u, version, filename: "scraped", strategy: "scrape" };
      } catch {
        // fallthrough
      }
    }
  }

  return { url: null, version, filename: null, strategy: null };
}

async function getOrBuildTeamLogoPng({ season, team }) {
  const outRel = `${TEAMLOGO_DIR}/${season}_${safeFileSlug(team)}_${LOGO_VERSION}.png`;
  const outPath = path.join(outRel);

  // Reuse if already generated
  try {
    await fs.access(outPath);
    return { ok: true, pngUrl: makePagesUrl(outRel), note: "cached" };
  } catch {
    // continue
  }

  const found = await findBestColouredLogoWebpUrl({ season, team });
  if (!found.url) {
    return { ok: false, pngUrl: null, note: "No suitable logo found on official F1 CDN." };
  }

  const webpBuf = await fetchBuffer(found.url);

  await ensureDir(TEAMLOGO_DIR);

  const pngBuf = await sharp(webpBuf)
    .png({ quality: 100, compressionLevel: 9 })
    .toBuffer();

  await fs.writeFile(outPath, pngBuf);

  return { ok: true, pngUrl: makePagesUrl(outRel), note: `${found.strategy}:${found.filename}` };
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
    teamLogoPng: null,
    _teamKey: team,
  };
}

/* -------------------- main -------------------- */

async function updateConstructors() {
  const now = new Date();
  const used = await getStandingsWithFallback(now);

  // Determine season string for F1 CDN path
  const seasonNum = used.season ? Number(used.season) : null;
  const seasonStr =
    seasonNum ? String(seasonNum) : used.tag === "current" ? String(now.getUTCFullYear()) : String(used.tag);

  const lastRace = await getLastRaceForSeason(used.tag);

  let constructors = used.raw.map(mapConstructorStanding);

  // Build logos -> PNG hosted by your GitHub Pages
  for (const c of constructors) {
    const team = c._teamKey;
    try {
      const result = await getOrBuildTeamLogoPng({ season: seasonStr, team });
      c.teamLogoPng = result.pngUrl;
      c.logoNote = result.ok ? null : result.note;
    } catch (e) {
      c.teamLogoPng = null;
      c.logoNote = e?.message || String(e);
    }
    delete c._teamKey;
  }

  // If fewer than 11 teams, add Cadillac placeholder at the end (P11 if there are 10)
  if (constructors.length < 11) {
    const position = constructors.length + 1;
    const cadLogo = await getOrBuildTeamLogoPng({ season: seasonStr, team: "Cadillac" });

    constructors.push({
      position,
      positionText: `P${position}`,
      points: 0,
      wins: 0,
      team: "Cadillac",
      teamHex: TEAM_HEX["Cadillac"] || "#111111",
      teamLogoPng: cadLogo.ok ? cadLogo.pngUrl : null,
      dummy: true,
      note: "Placeholder until standings include Cadillac",
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