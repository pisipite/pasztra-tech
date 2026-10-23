export interface SectionPosition {
  id: string;
  top: number;
}

/** The section whose heading most recently passed the sticky navigation.
 * Keep it selected through the inter-section gap; the cover has no selection. */
export function activeSectionAt(positions: readonly SectionPosition[], readingLine: number): string | undefined {
  let active: SectionPosition | undefined;
  for (const position of positions) {
    if (Number.isFinite(position.top) && position.top <= readingLine && (!active || position.top >= active.top)) {
      active = position;
    }
  }
  return active?.id;
}
