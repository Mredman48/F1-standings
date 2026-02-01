// updateConstructors.js
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";
const BASES = ["https://api.jolpi.ca/ergast/f1"];

// Your GitHub Pages base
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Folder where we’ll store PNGs in the repo (commit this folder)
const TEAMLOGO_DIR = "teamlogos";

function cleanTeamName(name) {
  const n = (name || "").trim();

  // Your naming rules:
  if (/red bull racing/i.test(n)) return "Red Bull";
  if (/RB F1 Team/i.test(n)) return "VCARB";

  return n;
}

// team -> formula1.com team page slug
// (these are used only to locate official logowhite.webp on F1 pages)
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

// Team hex colors (tweak anytime)
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

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function makePagesUrl(relPath) {
  return `${PAGES_BASE}/${relPath.split(path.sep).join("/")}`;
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
    throw new Error(`Non-JSON from ${url}: ${text.slice(0, 120)}`);
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

function safeGet(obj, pathArr) {
  return pathArr.reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), obj);
}

/**
 * Find the official "logowhite" image on the F1 team page.
 * We DO NOT guess version numbers; we scrape the page for the actual media URL.
 */
function extractOfficialLogoWebp(html, season) {
  // Examples resemble:
  // https://media.formula1.com/image/upload/.../common/f1/2025/alpine/2025alpinelogowhite.webp
  const re = new RegExp(
    `https://media\\.formula1\\.com/image/upload[^"']+/common/f1/${season}/[^"']+?logowhite\\.webp`,
    "i"
  );
  const m = html.match(re);
  return m ? m[0] : null;
}

function safeFileSlug(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Download official webp and convert to PNG (transparent) using sharp.
 * Returns a GitHub Pages URL to the PNG in your repo.
 */
async function getOrBuildTeamLogoPng({ team, season }) {
  const slug = TEAM_F1_PAGE_SLUG[team];
  if (!slug) return null;

  // Output filename you will commit
  const outRel = `${TEAMLOGO_DIR}/${season}_${safeFileSlug(team)}.png`;
  const outPath = path.join(outRel);

  // If already exists, reuse (faster + less network)
  try {
    await fs.access(outPath);
    return makePagesUrl(outRel);
  } catch {
    // continue
  }

  const teamPageUrl = `https://www.formula1.com/en/teams/${slug}`;
  const html = await fetchText(teamPageUrl);

  const webpUrl = extractOfficialLogoWebp(html, season);
  if (!webpUrl) {
    // Nothing found on page for that season
    return null;
  }

  const buf = await fetchBuffer(webpUrl);

  await ensureDir(TEAMLOGO_DIR);

  // Convert webp -> png
  const png = await sharp(buf).png().toBuffer();
  await fs.writeFile(outPath, png);

  return makePagesUrl(outRel);
}

function mapConstructorStanding(cs, { season }) {
  const ctor = cs?.Constructor || {};
  const team = cleanTeamName(ctor?.name || ctor?.Name || "");

  return {
    position: cs.position ? Number(cs.position) : null,
    positionText: cs.position ? `P${cs.position}` : null,
    points: cs.points ? Number(cs.points) : null,
    wins: cs.wins ? Number(cs.wins) : null,
    team: team || null,
    teamHex: TEAM_HEX[team] || null,
    // filled later (async) as a PNG URL hosted on *your* GitHub Pages
    teamLogoPng: null,
    _teamKey: team, // internal helper for logo lookup; removed before write
    _season: season, // internal helper; removed before write
  };
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

/**
 * Return standings for current season; if empty, fallback to previous season.
 */
async function getStandingsWithFallback(now) {
  const utcYear = now.getUTCFullYear();

  // current
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

  // If empty, fallback
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

async function updateConstructors() {
  const now = new Date();
  const used = await getStandingsWithFallback(now);

  const seasonNum = used.season ? Number(used.season) : null;
  const seasonStr = seasonNum ? String(seasonNum) : (used.tag === "current" ? String(now.getUTCFullYear()) : String(used.tag));

  // Build base array
  let constructors = used.raw.map((cs) => mapConstructorStanding(cs, { season: seasonStr }));

  // Fill official logos (download -> convert -> serve from your GitHub Pages)
  for (const c of constructors) {
    const team = c._teamKey;
    const season = c._season;

    try {
      c.teamLogoPng = await getOrBuildTeamLogoPng({ team, season });
    } catch (e) {
      // If something goes wrong, keep null (don’t fail workflow)
      c.teamLogoPng = null;
      console.log(`Logo error for ${team}:`, e?.message || String(e));
    }

    // remove internal helpers
    delete c._teamKey;
    delete c._season;
  }

  // ✅ Add dummy 11th-place team (for widget layout building)
  constructors.push({
    position: 11,
    positionText: "P11",
    points: 0,
    wins: 0,
    team: "Dummy Team",
    teamHex: "#999999",
    teamLogoPng: makePagesUrl(`${TEAMLOGO_DIR}/dummy_team.png`),
    dummy: true
  });

  // Ensure dummy logo exists (transparent PNG) if not already
  // (Creates a simple transparent placeholder, 256x256)
  await ensureDir(TEAMLOGO_DIR);
  const dummyPath = path.join(TEAMLOGO_DIR, "dummy_team.png");
  try {
    await fs.access(dummyPath);
  } catch {
    const blank = await sharp({
      create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
      .png()
      .toBuffer();
    await fs.writeFile(dummyPath, blank);
  }

  const lastRace = await getLastRaceForSeason(used.tag);

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
        kind: "official_f1_site",
        storedAs: "png_in_repo",
        folder: TEAMLOGO_DIR
      }
    },
    lastRace,
    constructors
  };

  await fs.writeFile("f1_constructor_standings.json", JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote f1_constructor_standings.json (seasonTag=${used.tag})`);
}

updateConstructors().catch((err) => {
  console.error(err);
  process.exit(1);
});