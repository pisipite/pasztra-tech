import type { EnergyNewsItem } from "../../types";

const storageKey = "solar-home-news-translations-v1";
const maximumStoredTranslations = 120;

export type LocalNewsTranslation = {
  url: string;
  titleHu: string;
  summaryHu: string;
  storedAt: string;
};

export type LocalNewsTranslations = Record<string, LocalNewsTranslation>;

type TranslationAvailability = "available" | "downloadable" | "downloading" | "unavailable";

type DownloadProgressEvent = Event & { loaded: number };

type TranslationMonitor = {
  addEventListener(type: "downloadprogress", listener: (event: DownloadProgressEvent) => void): void;
};

type BrowserTranslator = {
  translate(text: string): Promise<string>;
};

type BrowserTranslatorFactory = {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<TranslationAvailability>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (monitor: TranslationMonitor) => void;
  }): Promise<BrowserTranslator>;
};

type TranslatorGlobal = typeof globalThis & { Translator?: BrowserTranslatorFactory };

export class BrowserTranslationUnavailableError extends Error {}

let translatorPromise: Promise<BrowserTranslator> | undefined;

function translatorFactory() {
  return (globalThis as TranslatorGlobal).Translator;
}

export function canTranslateInBrowser() {
  return Boolean(translatorFactory());
}

async function getTranslator(onStatus: (status: string) => void) {
  const factory = translatorFactory();
  if (!factory) throw new BrowserTranslationUnavailableError("Ebben a böngészőben nincs helyi fordító.");

  const availability = await factory.availability({ sourceLanguage: "bg", targetLanguage: "hu" });
  if (availability === "unavailable") {
    throw new BrowserTranslationUnavailableError("A bolgár–magyar helyi fordítás ebben a böngészőben nem érhető el.");
  }

  if (!translatorPromise) {
    if (availability !== "available") onStatus("Nyelvi csomag…");
    translatorPromise = factory.create({
      sourceLanguage: "bg",
      targetLanguage: "hu",
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => {
          const percent = Math.round(Math.max(0, Math.min(1, event.loaded)) * 100);
          onStatus(`Letöltés ${percent}%`);
        });
      },
    }).catch((error) => {
      translatorPromise = undefined;
      throw error;
    });
  }

  return translatorPromise;
}

export async function translateNewsInBrowser(item: EnergyNewsItem, onStatus: (status: string) => void) {
  const translator = await getTranslator(onStatus);
  onStatus("Fordítás…");
  const titleHu = (await translator.translate(item.title)).trim();
  const summaryHu = (await translator.translate(item.summary)).trim();
  if (!titleHu || !summaryHu) throw new Error("A böngésző nem adott vissza teljes fordítást.");
  return { titleHu, summaryHu };
}

export function loadLocalNewsTranslations(): LocalNewsTranslations {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as LocalNewsTranslations;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function storeLocalNewsTranslation(item: EnergyNewsItem, translation: Pick<LocalNewsTranslation, "titleHu" | "summaryHu">) {
  const current = loadLocalNewsTranslations();
  const next: LocalNewsTranslations = {
    ...current,
    [item.id]: { ...translation, url: item.url, storedAt: new Date().toISOString() },
  };
  const entries = Object.entries(next)
    .sort(([, left], [, right]) => right.storedAt.localeCompare(left.storedAt))
    .slice(0, maximumStoredTranslations);
  const trimmed = Object.fromEntries(entries) as LocalNewsTranslations;
  localStorage.setItem(storageKey, JSON.stringify(trimmed));
  return trimmed;
}
