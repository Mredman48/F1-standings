// updateFerrariStandings.js
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

// Your Ferrari logo (already in repo)
const FERRARI_LOGO_PNG =
  "https://raw.githubusercontent.com/Mredman48/F1-standings/refs/heads/main/teamlogos/2025_ferrari_color_v2.png";

const OUT_JSON = "f1_ferrari_standings.json";
const HEADSHOT_DIR = "headshots";

// OpenF1 base
const OPENF1 = "https://api.openf1.org/v1";

// ✅ Driver number images (your folder + naming format)
const PAGES_BASE = "https://mredman48.github.io/F1-standings";
const DRIVER_NUMBER_FOLDER = "driver-numbers";

function getDriverNumberImageUrl(driverNumber) {
  if (!driverNumber || driverNumber === "-") return null;
  return `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-${driverNumber}.png`;
}

// ------------ helpers ------------

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} from ${url}\n${t.slice(0, 200)}`);
  }
  return res.json();
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

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
  };
}

function dashTeamStanding(teamDisplay, originalTeam = "-") {
  return { team: teamDisplay, position: "-", points: "-", wins: "-", originalTeam };
}

// Pick “latest” driver record if OpenF1 returns multiple rows
function pickLatestByMeetingKey(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  // meeting_key tends to increase over time
  return rows.reduce((best, cur) => {
    const a = Number(best.meeting_key ?? -1);
    const b = Number(cur.meeting_key ?? -1);
    return b > a ? cur : best;
  }, rows[0]);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

// Download image and convert to PNG.
// (PNG file may not be transparent unless the source image has transparency.)
async function downloadToPng(imageUrl, outFilePath) {
  const res = await fetch(imageUrl, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Failed to download image: ${res.status} ${imageUrl}`);

  const buf = Buffer.from(await res.arrayBuffer());

  // Convert whatever it is to PNG for consistency
  const pngBuf = await sharp(buf).png().toBuffer();
  await fs.writeFile(outFilePath, pngBuf);
}

function rawGithubUrlForFile(repoFull, filePath) {
  // Use your real repo; Actions sets GITHUB_REPOSITORY as "Owner/Repo"
  // raw.githubusercontent.com uses this format:
  // https://raw.githubusercontent.com/Owner/Repo/main/<path>
  return `https://raw.githubusercontent.com/${repoFull}/main/${filePath.replace(/\\/g, "/")}`;
}

// ------------ main ------------

async function updateFerrariStandings() {
  const now = new Date();

  const repoFull = process.env.GITHUB_REPOSITORY || "Mredman48/F1-standings";

  const driversConfig = [
    { firstName: "Charles", lastName: "Leclerc", driverNumber: 16, code: "LEC" },
    { firstName: "Lewis", lastName: "Hamilton", driverNumber: 44, code: "HAM" },
  ];

  await ensureDir(HEADSHOT_DIR);

  const drivers = [];

  for (const d of driversConfig) {
    const url =
      `${OPENF1}/drivers?driver_number=${encodeURIComponent(d.driverNumber)}` +
      `&first_name=${encodeURIComponent(d.firstName)}` +
      `&last_name=${encodeURIComponent(d.lastName)}`;

    const rows = await fetchJson(url);
    const latest = pickLatestByMeetingKey(rows);

    // Only accept “real” headshot URLs. If none, leave "-" (no placeholder images).
    let headshotUrl = latest?.headshot_url || "-";

    let headshotPngPath = "-";
    let headshotPngUrl = "-";

    if (headshotUrl && headshotUrl !== "-") {
      const fileName = `${slugify(d.firstName)}-${slugify(d.lastName)}.png`;
      headshotPngPath = path.join(HEADSHOT_DIR, fileName);

      // Download + convert to PNG
      await downloadToPng(headshotUrl, headshotPngPath);

      // Provide a stable URL your widgets can load
      headshotPngUrl = rawGithubUrlForFile(repoFull, headshotPngPath);
    }

    const driverNumberStr = String(d.driverNumber);

    drivers.push({
      position: "-",
      points: "-",
      wins: "-",
      firstName: d.firstName,
      lastName: d.lastName,
      code: d.code,
      driverNumber: driverNumberStr,

      // ✅ NEW FIELD
      numberImageUrl: getDriverNumberImageUrl(driverNumberStr),

      team: "Ferrari",
      headshotUrl: headshotPngUrl,
      bestResult: dashBestResult(),
    });
  }

  const out = {
    header: "Ferrari standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      ferrariLogo: FERRARI_LOGO_PNG,
      headshots: "OpenF1 drivers endpoint (headshot_url)",
      driverNumbers: `${PAGES_BASE}/${DRIVER_NUMBER_FOLDER}/driver-number-<number>.png`,
    },
    meta: {
      mode: "DASH_PLACEHOLDERS_REAL_HEADSHOTS",
      note:
        "All non-image datapoints are '-' placeholders for widget building. Headshots are downloaded and converted to PNG, then served from your repo. Driver number images are pulled from your repo folder driver-numbers.",
    },
    ferrari: {
      team: "Ferrari",
      teamLogoPng: FERRARI_LOGO_PNG,
      teamStanding: dashTeamStanding("Ferrari", "Scuderia Ferrari"),
    },
    lastRace: dashLastRace(),
    drivers,
  };

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_JSON} and saved headshots (if available) into /${HEADSHOT_DIR}`);
}

updateFerrariStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});