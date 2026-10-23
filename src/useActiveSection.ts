import { useEffect, useState } from "react";
import { activeSectionAt } from "./activeSection";
import { PAGE_BLOCKS } from "./config/pageBlocks";

/** Presentation only: one layout read per animation frame, no data requests. */
export function useActiveSection() {
  const [activeSection, setActiveSection] = useState<string>();

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const mobileControls = document.querySelector(".section-nav__mobile-controls");
      const nav = document.querySelector(".section-nav");
      // Opening the mobile menu must not move the reading line down the page.
      const navHeight = mobileControls?.getBoundingClientRect().height || nav?.getBoundingClientRect().height || 52;
      const statusHeight = document.querySelector(".activity-bar")?.getBoundingClientRect().height || 0;
      const positions = PAGE_BLOCKS.flatMap(({ id }) => {
        const element = document.getElementById(id);
        return element ? [{ id, top: element.getBoundingClientRect().top }] : [];
      });
      setActiveSection(activeSectionAt(positions, navHeight + statusHeight + 32));
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    for (const selector of ["main", ".sticky-navigation"]) {
      const element = document.querySelector(selector);
      if (element) observer.observe(element);
    }
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return activeSection;
}
