// updateAudiStandings.js
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

const OPENF1_BASE = "https://api.openf1.org/v1";
const ERGAST_BASES = ["https://api.jolpi.ca/ergast/f1", "https://ergast.com/api/f1"];

const OUT_JSON = "f1_audi_standings.json";

const TEAMLOGOS_DIR = "teamlogos";
const HEADSHOTS_DIR = "headshots";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// ✅ Driver number images (you uploaded these)
const DRIVER_NUMBER_FOLDER = "driver-numbers";
function getDriverNumberImageUrl(driverNumber) {
  if (driverNumber == null || driverNumber === "-" || driverNumber === "") return null;
  return `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`;
}

// Audi logo (you already use this file path in your JSON)
const AUDI_LOGO_LOCAL = "teamlogos/audi_logo_colored.png";
const AUDI_LOGO_PAGES = `${PAGES_BASE}/${AUDI_LOGO_LOCAL}`;

// External Audi logo source (kept in sources)
const AUDI_LOGO_SOURCE_PNG =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Audif1.com_logo17_%28cropped%29.svg/1920px-Audif1.com_logo17_%28cropped%29.svg.png";

// ---------- small helpers ----------

function toSlug(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function fetchText(url, accept = "application/json") {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: accept },
    redirect: "follow",
  });
  const text = await res.text();
  return { res, text };
}

async function fetchJson(url) {
  const { res, text } = await fetchText(url, "application/json");
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}\n${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function fetchBinary(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

// ---------- Ergast helpers (with fallback) ----------

async function fetchErgastWithFallback(pathPart) {
  const attempts = [];
  for (const base of ERGAST_BASES) {
    const url = `${base}${pathPart}`;
    try {
      const data = await fetchJson(url);
      attempts.push({ url, status: 200, ok: true });
      return { data, url, attempts };
    } catch (e) {
      attempts.push({ url, status: "ERR", ok: false, err: String(e?.message || e) });
    }
  }
  const err = new Error(`Failed Ergast fetch for ${pathPart}. Attempts: ${JSON.stringify(attempts)}`);
  err.attempts = attempts;
  throw err;
}

function getRacesFromErgast(data) {
  return data?.MRData?.RaceTable?.Races || [];
}

function getStandingsListsFromErgast(data) {
  return data?.MRData?.StandingsTable?.StandingsLists || [];
}

// ---------- OpenF1 headshot pipeline (real only) ----------

async function getOpenF1HeadshotUrlByDriverNumber(driverNumber) {
  const url = `${OPENF1_BASE}/drivers?driver_number=${encodeURIComponent(driverNumber)}`;
  try {
    const rows = await fetchJson(url);
    if (!Array.isArray(rows) || rows.length === 0) return null;

    // pick newest by meeting_key if present
    const best = rows.reduce((a, b) => {
      const ak = Number(a?.meeting_key ?? -1);
      const bk = Number(b?.meeting_key ?? -1);
      return bk > ak ? b : a;
    }, rows[0]);

    return best?.headshot_url || null;
  } catch {
    return null;
  }
}

/**
 * ✅ UPDATED:
 * - Use openF1Number for lookup if provided, otherwise driverNumber.
 */
async function getOrUpdateHeadshotPng(
  { firstName, lastName, driverNumber, openF1Number },
  width = 900
) {
  const slug = `${toSlug(firstName)}-${toSlug(lastName)}`;
  const fileName = `${slug}.png`;
  const localPath = path.join(HEADSHOTS_DIR, fileName);
  const pagesUrl = `${PAGES_BASE}/${HEADSHOTS_DIR}/${fileName}`;

  const lookupNumber = openF1Number ?? driverNumber;
  const openf1Url = await getOpenF1HeadshotUrlByDriverNumber(lookupNumber);

  if (!openf1Url) {
    if (await exists(localPath)) return pagesUrl;
    return null;
  }

  const buf = await fetchBinary(openf1Url);
  await ensureDir(HEADSHOTS_DIR);

  const png = await sharp(buf)
    .resize({ width, withoutEnlargement: true })
    .png()
    .toBuffer();

  await fs.writeFile(localPath, png);
  return pagesUrl;
}

// ---------- Audi logo ensure (keeps your existing JSON fields) ----------

async function ensureAudiLogo() {
  await ensureDir(TEAMLOGOS_DIR);
  const local = AUDI_LOGO_LOCAL;
  if (await exists(local)) return;

  const buf = await fetchBinary(AUDI_LOGO_SOURCE_PNG);
  await fs.writeFile(local, buf);
}

// ---------- Main logic ----------

async function updateAudiStandings() {
  const now = new Date();

  await ensureAudiLogo();

  let seasonUsed = "current";
  let roundUsed = "-";

  let driverStandingsUrlUsed = null;
  let constructorStandingsUrlUsed = null;
  let lastRaceUrlUsed = null;

  let driverStandingsData = null;
  let constructorStandingsData = null;
  let lastRaceData = null;

  async function loadSeason(season) {
    const ds = await fetchErgastWithFallback(`/${season}/driverstandings.json`);
    const cs = await fetchErgastWithFallback(`/${season}/constructorstandings.json`);
    const lr = await fetchErgastWithFallback(`/${season}/last/results.json`);

    driverStandingsUrlUsed = ds.url;
    constructorStandingsUrlUsed = cs.url;
    lastRaceUrlUsed = lr.url;

    return {
      driver: ds.data,
      constructor: cs.data,
      lastRace: lr.data,
      lastRaceRound: getRacesFromErgast(lr.data)?.[0]?.round || "-",
    };
  }

  let loaded = await loadSeason("current");

  const csLists = getStandingsListsFromErgast(loaded.constructor);
  const cs = csLists?.[0]?.ConstructorStandings || [];
  const audiInCurrent = cs.some((x) => (x?.Constructor?.constructorId || "").toLowerCase() === "audi");

  if (!audiInCurrent) {
    loaded = await loadSeason("2025");
    seasonUsed = "2025";
  }

  roundUsed = String(loaded.lastRaceRound || "-");

  driverStandingsData = loaded.driver;
  constructorStandingsData = loaded.constructor;
  lastRaceData = loaded.lastRace;

  const lastRace = getRacesFromErgast(lastRaceData)?.[0];
  const lastRaceOut = lastRace
    ? {
        season: String(lastRace.season || seasonUsed),
        round: String(lastRace.round || "-"),
        raceName: lastRace.raceName || "-",
        date: lastRace.date || "-",
        timeUtc: lastRace.time || "-",
        circuit: {
          name: lastRace?.Circuit?.circuitName || "-",
          locality: lastRace?.Circuit?.Location?.locality || "-",
          country: lastRace?.Circuit?.Location?.country || "-",
        },
      }
    : {
        season: String(seasonUsed),
        round: "-",
        raceName: "-",
        date: "-",
        timeUtc: "-",
        circuit: { name: "-", locality: "-", country: "-" },
      };

  const consLists = getStandingsListsFromErgast(constructorStandingsData);
  const consRows = consLists?.[0]?.ConstructorStandings || [];

  const getConsRow = (constructorId) =>
    consRows.find((x) => (x?.Constructor?.constructorId || "").toLowerCase() === constructorId);

  const audiConsRow = audiInCurrent ? getConsRow("audi") : null;
  const sauberConsRow = getConsRow("sauber");

  const consUsed = audiConsRow || sauberConsRow || null;

  const teamStandingOut = consUsed
    ? {
        team: "Audi",
        position: `P${consUsed.position}`,
        points: Number(consUsed.points),
        wins: Number(consUsed.wins),
        originalTeam: consUsed?.Constructor?.name || "-",
      }
    : {
        team: "Audi",
        position: "-",
        points: "-",
        wins: "-",
        originalTeam: "-",
      };

  const dsLists = getStandingsListsFromErgast(driverStandingsData);
  const dsRows = dsLists?.[0]?.DriverStandings || [];

  function belongsToConstructor(row, constructorId) {
    const cs = row?.Constructors || [];
    return cs.some((c) => (c?.constructorId || "").toLowerCase() === constructorId);
  }

  const constructorIdForDrivers = audiInCurrent ? "audi" : "sauber";
  const driverRows = dsRows.filter((r) => belongsToConstructor(r, constructorIdForDrivers));
  const chosenDrivers = driverRows.slice(0, 2);

  function bestFinishFromRow() {
    return { position: "-", raceName: "-", round: "-", date: "-", circuit: "-" };
  }

  const driversOut = [];

  for (const r of chosenDrivers) {
    const d = r?.Driver;
    const firstName = d?.givenName || "-";
    const lastName = d?.familyName || "-";
    const driverNumber = d?.permanentNumber ? Number(d.permanentNumber) : null;

    // ✅ Use openF1Number if you ever need to override (defaults to driverNumber)
    const headshotPagesUrl =
      driverNumber != null
        ? await getOrUpdateHeadshotPng(
            { firstName, lastName, driverNumber, openF1Number: driverNumber },
            900
          )
        : null;

    driversOut.push({
      driverId: d?.driverId || toSlug(`${firstName}-${lastName}`),
      position: `P${r?.position ?? "-"}`,
      points: Number(r?.points ?? 0),
      wins: Number(r?.wins ?? 0),
      firstName,
      lastName,
      code: d?.code || "-",
      driverNumber: driverNumber ?? "-",

      // ✅ driver-number images you uploaded
      numberImageUrl: getDriverNumberImageUrl(driverNumber ?? "-"),

      team: "Audi",
      headshotUrl: headshotPagesUrl,
      placeholder: !audiInCurrent,
      bestFinish: bestFinishFromRow(r),
      originalTeam: r?.Constructors?.[0]?.name || "-",
    });
  }

  while (driversOut.length < 2) {
    driversOut.push({
      driverId: "-",
      position: "-",
      points: "-",
      wins: "-",
      firstName: "-",
      lastName: "-",
      code: "-",
      driverNumber: "-",
      numberImageUrl: null,
      team: "Audi",
      headshotUrl: null,
      placeholder: true,
      bestFinish: { position: "-", raceName: "-", round: "-", date: "-", circuit: "-" },
      originalTeam: "Sauber",
    });
  }

  const out = {
    header: "Audi standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      openf1: OPENF1_BASE,
      audiLogoSourcePng: AUDI_LOGO_SOURCE_PNG,
      ergastBases: ERGAST_BASES,
      driverStandings: driverStandingsUrlUsed,
      constructorStandings: constructorStandingsUrlUsed,
      lastRace: lastRaceUrlUsed,
      driverNumbers: `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-<number>.png`,
    },
    meta: {
      mode: audiInCurrent ? "AUDI_LIVE" : "AUDI_PLACEHOLDERS_FROM_KICK_SAUBER_LAST_YEAR",
      seasonUsed: String(seasonUsed),
      roundUsed: String(roundUsed),
      note: audiInCurrent
        ? "Audi present in standings; using live data."
        : "Audi not present in current standings yet; using Kick Sauber drivers + constructor data from last year as placeholders (team label forced to Audi).",
    },
    audi: {
      team: "Audi",
      teamLogoPng: AUDI_LOGO_PAGES,
      teamLogoLocalPath: AUDI_LOGO_LOCAL,
      teamStanding: teamStandingOut,
    },
    lastRace: lastRaceOut,
    drivers: driversOut,
  };

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON}`);
}

updateAudiStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});