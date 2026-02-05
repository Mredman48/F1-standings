// updateFerrariStandings.js
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const UA = "f1-standings-bot/1.0 (GitHub Actions)";

const FERRARI_LOGO_PNG =
  "https://raw.githubusercontent.com/Mredman48/F1-standings/refs/heads/main/teamlogos/2025_ferrari_color_v2.png";

const OUT_JSON = "f1_ferrari_standings.json";
const HEADSHOT_DIR = "headshots";

// Use GitHub Pages for Widgy-friendly URLs
const PAGES_BASE = "https://mredman48.github.io/F1-standings";

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    redirect: "follow",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return text;
}

async function fetchBinary(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "image/*,*/*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// Pull *all* media.formula1.com image urls out of HTML
function extractF1MediaUrls(html) {
  const re =
    /https:\/\/media\.formula1\.com\/image\/upload\/[^"'()<>\s]+?\.(?:webp|png|jpg|jpeg)/gi;

  const found = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    found.add(m[0]);
  }
  return [...found];
}

// Score candidates so we pick a real driver headshot/cutout, not random thumbnails
function scoreCandidate(url, driverSlug) {
  const u = url.toLowerCase();
  const slug = driverSlug.toLowerCase();

  let score = 0;

  // Strong indicators of official structured assets
  if (u.includes("/common/f1/")) score += 30;

  // Driver identity
  if (u.includes(slug)) score += 60;

  // Often cutouts are left/right variants
  if (u.includes("left") || u.includes("right")) score += 20;

  // Avoid obvious news thumbnails / generic imagery
  const badHints = ["16x9", "single", "thumb", "thumbnail", "share", "social", "banner"];
  if (badHints.some((b) => u.includes(b))) score -= 40;

  // Prefer bigger “person” assets; deprioritize team/car/track assets
  const badTopics = ["track", "circuit", "livery", "car", "garage"];
  if (badTopics.some((b) => u.includes(b))) score -= 15;

  // Prefer modern formats (webp) because they often preserve alpha
  if (u.endsWith(".webp")) score += 10;

  return score;
}

// Pick best URL from driver profile page OR fallback to /en/drivers list page
async function findBestF1HeadshotUrl(driverSlug) {
  const profileUrl = `https://www.formula1.com/en/drivers/${driverSlug}`;
  const listUrl = `https://www.formula1.com/en/drivers`;

  const sources = [
    { name: "profile", url: profileUrl },
    { name: "list", url: listUrl },
  ];

  let best = null;

  for (const src of sources) {
    const html = await fetchText(src.url);
    const urls = extractF1MediaUrls(html);

    // Score all candidates
    const scored = urls
      .map((u) => ({ url: u, score: scoreCandidate(u, driverSlug), src: src.name }))
      .filter((x) => x.score > 0) // only plausible ones
      .sort((a, b) => b.score - a.score);

    if (scored.length) {
      best = scored[0];
      break;
    }
  }

  return best?.url || null;
}

// Ensure decent resolution (F1 URLs often accept transforms in the path).
// If we can’t reliably inject transforms, we still download original.
function tryUpgradeWidth(url, width = 1024) {
  // Many F1 media URLs have transforms already; try to replace w_### if present.
  let u = url;
  if (u.match(/w_\d+/)) {
    u = u.replace(/w_\d+/, `w_${width}`);
    return u;
  }
  // If no width transform exists, we can try inserting `w_{width}` after /upload/
  // This usually works with Cloudinary-style URLs.
  return u.replace("/image/upload/", `/image/upload/w_${width}/`);
}

// Download F1 media -> convert to PNG -> save to /headshots
// Returns GitHub Pages URL to the saved PNG, OR null if not found.
async function getAndSaveHeadshotPng(driverSlug, width = 1024) {
  const bestUrl = await findBestF1HeadshotUrl(driverSlug);

  if (!bestUrl) {
    console.log(`No F1 headshot found for ${driverSlug} (returning null)`);
    return null; // ✅ no placeholders
  }

  const upgraded = tryUpgradeWidth(bestUrl, width);
  console.log(`Headshot chosen for ${driverSlug}: ${upgraded}`);

  const imgBuffer = await fetchBinary(upgraded);

  // Convert to PNG and preserve transparency if present
  const png = await sharp(imgBuffer).png().toBuffer();

  await fs.mkdir(HEADSHOT_DIR, { recursive: true });

  const fileName = `${driverSlug}_${width}.png`;
  const filePath = path.join(HEADSHOT_DIR, fileName);

  await fs.writeFile(filePath, png);

  // ✅ Widgy-friendly stable URL via GitHub Pages
  return `${PAGES_BASE}/${HEADSHOT_DIR}/${fileName}`;
}

// ---------- Placeholder builders (dashes) ----------

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

// ---------- Main ----------

async function updateFerrariStandings() {
  const now = new Date();

  const driversConfig = [
    { firstName: "Charles", lastName: "Leclerc", code: "LEC", driverNumber: "16", slug: "charles-leclerc" },
    { firstName: "Lewis", lastName: "Hamilton", code: "HAM", driverNumber: "44", slug: "lewis-hamilton" },
  ];

  const drivers = [];

  for (const d of driversConfig) {
    // ✅ real headshot only, else null
    const headshotUrl = await getAndSaveHeadshotPng(d.slug, 1024);

    drivers.push({
      position: "-",
      points: "-",
      wins: "-",
      firstName: d.firstName,
      lastName: d.lastName,
      code: d.code,
      driverNumber: d.driverNumber,
      team: "Ferrari",
      headshotUrl, // null if not found
      bestResult: dashBestResult(),
    });
  }

  const out = {
    header: "Ferrari standings",
    generatedAtUtc: now.toISOString(),
    sources: {
      ferrariLogo: FERRARI_LOGO_PNG,
      headshots: "Scraped from formula1.com pages; downloaded from media.formula1.com and converted to PNG",
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
  console.log(`Wrote ${OUT_JSON}`);
}

updateFerrariStandings().catch((err) => {
  console.error(err);
  process.exit(1);
});