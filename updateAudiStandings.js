// updateAudiStandings.js
import fs from "node:fs/promises";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Ergast (Jolpi first, Ergast fallback)
const ERGAST_BASES = ["https://api.jolpi.ca/ergast/f1", "https://ergast.com/api/f1"];

// Output JSON
const OUT_JSON = "f1_audi_standings.json";

// Repo folders
const TEAMLOGOS_DIR = "teamlogos";
const HEADSHOTS_DIR = "headshots";
const DRIVER_NUMBER_FOLDER = "driver-numbers";

// GitHub Pages base (Widgy-friendly)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

// Audi logo (repo file path used in JSON)
const AUDI_LOGO_LOCAL = "teamlogos/audi_logo_colored.png";
const AUDI_LOGO_PAGES = `${PAGES_BASE}/${AUDI_LOGO_LOCAL}`;

// External Audi logo source (only used to create local file if missing)
const AUDI_LOGO_SOURCE_PNG =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Audif1.com_logo17_%28cropped%29.svg/1920px-Audif1.com_logo17_%28cropped%29.svg.png";

// ---------- Helpers ----------

function toSlug(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
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

async function fetchText(url, accept = "application/json") {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: accept },
    redirect: "follow",
  });
  const text = await res.text();
  return { res, text };
}

async function fetchBinary(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---------- Driver number + headshot URLs (LOCAL ONLY) ----------

function getDriverNumberImageUrl(driverNumber) {
  if (driverNumber == null || driverNumber === "-" || driverNumber === "") return null;
  return `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`;
}

// ✅ Headshots: only return URL if local file exists in /headshots
async function getSavedHeadshotUrl({ firstName, lastName }) {
  if (!firstName || !lastName || firstName === "-" || lastName === "-") return null;
  const fileName = `${toSlug(firstName)}-${toSlug(lastName)}.png`;
  const localPath = `${HEADSHOTS_DIR}/${fileName}`;

  if (await exists(localPath)) {
    return `${PAGES_BASE}/${HEADSHOTS_DIR}/${fileName}`;
  }
  return null;
}

// ---------- Ergast fetch with retry/backoff (429 + HTML guards) ----------

async function fetchErgastWithFallback(pathPart) {
  const attempts = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (const base of ERGAST_BASES) {
    const url = `${base}${pathPart}`;

    for (let i = 1; i <= 5; i++) {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": UA, Accept: "application/json" },
          redirect: "follow",
        });

        const text = await res.text();

        // Throttling
        if (res.status === 429) {
          attempts.push({ url, ok: false, status: 429, try: i, err: "throttled" });
          await sleep(1000 * i);
          continue;
        }

        if (!res.ok) {
          attempts.push({ url, ok: false, status: res.status, try: i, err: text.slice(0, 120) });
          break;
        }

        // Sometimes returns HTML instead of JSON
        if (text.trimStart().startsWith("<")) {
          attempts.push({ url, ok: false, status: "HTML", try: i, err: text.slice(0, 120) });
          await sleep(1000 * i);
          continue;
        }

        const data = JSON.parse(text);
        attempts.push({ url, ok: true, status: 200, try: i });
        return { data, url, attempts };
      } catch (e) {
        attempts.push({ url, ok: false, status: "ERR", try: i, err: String(e?.message || e) });
        await sleep(1000 * i);
      }
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

// ---------- Audi logo ensure ----------

async function ensureAudiLogo() {
  await ensureDir(TEAMLOGOS_DIR);
  if (await exists(AUDI_LOGO_LOCAL)) return;

  const buf = await fetchBinary(AUDI_LOGO_SOURCE_PNG);
  await fs.writeFile(AUDI_LOGO_LOCAL, buf);
}

// ---------- Main ----------

async function updateAudiStandings() {
  const now = new Date();

  await ensureAudiLogo();

  let seasonUsed = "current";
  let roundUsed = "-";

  let driverStandingsUrlUsed = null;
  let constructorStandingsUrlUsed = null;
  let lastRaceUrlUsed = null;

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

  // Load current; if Audi not present, fallback to 2025 (Sauber placeholders)
  let loaded = await loadSeason("current");

  const csLists = getStandingsListsFromErgast(loaded.constructor);
  const cs = csLists?.[0]?.ConstructorStandings || [];
  const audiInCurrent = cs.some(
    (x) => (x?.Constructor?.constructorId || "").toLowerCase() === "audi"
  );

  if (!audiInCurrent) {
    loaded = await loadSeason("2025");
    seasonUsed = "2025";
  }

  roundUsed = String(loaded.lastRaceRound || "-");

  // Last race output
  const lastRace = getRacesFromErgast(loaded.lastRace)?.[0];
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

  // Constructor standing (Audi if present, else Sauber row but labeled Audi)
  const consLists = getStandingsListsFromErgast(loaded.constructor);
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
    : { team: "Audi", position: "-", points: "-", wins: "-", originalTeam: "-" };

  // Driver standings (Audi if present, else Sauber drivers but labeled Audi)
  const dsLists = getStandingsListsFromErgast(loaded.driver);
  const dsRows = dsLists?.[0]?.DriverStandings || [];

  function belongsToConstructor(row, constructorId) {
    const cs = row?.Constructors || [];
    return cs.some((c) => (c?.constructorId || "").toLowerCase() === constructorId);
  }

  const constructorIdForDrivers = audiInCurrent ? "audi" : "sauber";
  const driverRows = dsRows.filter((r) => belongsToConstructor(r, constructorIdForDrivers));
  const chosenDrivers = driverRows.slice(0, 2);

  function bestFinishDash() {
    return { position: "-", raceName: "-", round: "-", date: "-", circuit: "-" };
  }

  const driversOut = [];
  for (const r of chosenDrivers) {
    const d = r?.Driver;
    const firstName = d?.givenName || "-";
    const lastName = d?.familyName || "-";
    const driverNumber = d?.permanentNumber ? Number(d.permanentNumber) : "-";

    const headshotUrl =
      firstName !== "-" && lastName !== "-" ? await getSavedHeadshotUrl({ firstName, lastName }) : null;

    driversOut.push({
      driverId: d?.driverId || toSlug(`${firstName}-${lastName}`),
      position: `P${r?.position ?? "-"}`,
      points: Number(r?.points ?? 0),
      wins: Number(r?.wins ?? 0),
      firstName,
      lastName,
      code: d?.code || "-",
      driverNumber,

      numberImageUrl: getDriverNumberImageUrl(driverNumber),

      team: "Audi",
      headshotUrl, // ✅ LOCAL ONLY or null
      placeholder: !audiInCurrent,
      bestFinish: bestFinishDash(),
      originalTeam: r?.Constructors?.[0]?.name || "-",
    });
  }

  // Pad if needed
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
      bestFinish: bestFinishDash(),
      originalTeam: "Sauber",
    });
  }

  const out = {
    header: "Audi standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      ergastBases: ERGAST_BASES,
      driverStandings: driverStandingsUrlUsed,
      constructorStandings: constructorStandingsUrlUsed,
      lastRace: lastRaceUrlUsed,
      audiLogoSourcePng: AUDI_LOGO_SOURCE_PNG,
      headshots: `LOCAL_ONLY: ${PAGES_BASE}/${HEADSHOTS_DIR}/<first>-<last>.png`,
      driverNumbers: `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-<number>.png`,
    },
    meta: {
      mode: audiInCurrent ? "AUDI_LIVE_LOCAL_HEADSHOTS" : "AUDI_PLACEHOLDERS_LOCAL_HEADSHOTS",
      seasonUsed: String(seasonUsed),
      roundUsed: String(roundUsed),
      note: audiInCurrent
        ? "Audi present in standings; using live data. Headshots are LOCAL ONLY from repo /headshots."
        : "Audi not present in current standings yet; using Kick Sauber drivers + constructor data from last year as placeholders (team label forced to Audi). Headshots are LOCAL ONLY from repo /headshots.",
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
