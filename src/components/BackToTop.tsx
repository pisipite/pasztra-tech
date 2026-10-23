export function BackToTop() {
  const scrollToTop = () => window.scrollTo({
    top: 0,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });

  return <button className="back-to-top" type="button" onClick={scrollToTop} aria-label="Vissza az oldal tetejére" title="Vissza az oldal tetejére"><span aria-hidden="true">↑</span></button>;
}
