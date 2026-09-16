export interface PageBlockDefinition {
  id: string;
  navigationLabel: string;
  codeLocation: string;
  dataFile?: string;
}

// Order here is the order in the sticky page navigation. The codeLocation and
// dataFile fields are documentation for maintainers and intentionally do not
// couple rendering to file-system paths.
export const PAGE_BLOCKS: PageBlockDefinition[] = [
  { id: "energia", navigationLabel: "Energiafolyam", codeLocation: "blocks/energy-flow", dataFile: "dashboard-{range}.json" },
  { id: "energiamix", navigationLabel: "Országos energia · Bulgária", codeLocation: "blocks/bulgaria-energy", dataFile: "bulgaria-energy-mix.json" },
  { id: "hirek", navigationLabel: "Hírek", codeLocation: "blocks/news", dataFile: "energy-news.json" },
  { id: "elojelzes", navigationLabel: "Előrejelzés", codeLocation: "blocks/forecast", dataFile: "dashboard-{range}.json" },
  { id: "fogyasztasi-proba", navigationLabel: "Interaktív próba", codeLocation: "blocks/planner", dataFile: "dashboard-{range}.json" },
  { id: "napallas", navigationLabel: "Napállás", codeLocation: "blocks/sun-position" },
  { id: "napelem", navigationLabel: "Termelés", codeLocation: "blocks/home-climate", dataFile: "dashboard-{range}.json" },
  { id: "klima", navigationLabel: "Hőmérséklet", codeLocation: "blocks/home-climate", dataFile: "govee-history.json" },
];
