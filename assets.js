import fs from "node:fs/promises";

const YEAR = 2026;
const VERSION = "v1740000001";

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
    return res.ok;
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
        console.log(`OK  ${team} ${angle}`);
      } else {
        console.log(`MISS ${team} ${angle}`);
      }
    }
  }

  await fs.writeFile(
    "f1_car_assets_2026.json",
    JSON.stringify(result, null, 2)
  );

  console.log("Saved f1_car_assets_2026.json");
}

buildAssetMap().catch((err) => {
  console.error(err);
  process.exit(1);
});