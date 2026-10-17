import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addHungarianNewsTranslations } from "./news-translation.mjs";

export async function translatePublishedArticle({ file = resolve("public/data/energy-news.json"), requestedUrl = process.env.NEWS_TRANSLATION_URL?.trim(), now = new Date(), ...options } = {}) {
  if (!requestedUrl) throw new Error("Nincs kiválasztott hír a fordításhoz.");
  const data = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(data.items) || !Array.isArray(data.sources)) throw new Error("Érvénytelen hírfolyam.");
  // No RSS, weather, sensor, transport or remote history calls on this path.
  const result = await addHungarianNewsTranslations(data, { ...options, requestedUrl, historyUrl: "", preserveItems: true });
  result.translation.updatedAt = now.toISOString();
  // Keep the news collection timestamp: translating is not collecting news.
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Hírfordítás: ${result.translation.status}.`);
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await translatePublishedArticle();
