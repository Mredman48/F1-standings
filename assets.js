import fs from "node:fs/promises";
import fetch from "node-fetch";

const YEAR = 2026;
const VERSION = "v1740000001"; // can update later

const BASE =
  "https://media.formula1.com/image/upload/c_lfill,w_3392/q_auto";

const TEAMS = [
  "redbull",
  "ferrari",
  "mercedes",
  "mclaren",
  "astonmartin",
  "alpine",
  "williams",
  "haas",
  "sauber",
  "rb"
];

const ANGLES = ["right", "left", "front", "rear"];

async function checkImage(url) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function buildAssetMap() {
  const result = {};

  for (const team of TEAMS) {
    result[team] = {};

    for (const angle of ANGLES) {
      const url = `${BASE}/${VERSION}/common/f1/${YEAR}/${team}/${YEAR}${team}car${angle}.webp`;

      const exists = await checkImage(url);

      if (exists) {
        result[team][angle] = url;
        console.log(`✅ ${team} ${angle}`);
      } else {
        console.log(`❌ ${team} ${angle}`);
      }
    }
  }

  await fs.writeFile(
    "f1_car_assets_2026.json",
    JSON.stringify(result, null, 2)
  );

  console.log("🎉 Asset map saved");
}

buildAssetMap();