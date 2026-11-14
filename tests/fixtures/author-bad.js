// Fixture: a deliberately bad extension registration set. Used by
// tests/author-check.mjs to prove the inventory and the author check can see a
// broad observer, a fast interval and a hot listener, and name the file.
(function () {
  const mo = new MutationObserver(() => {});
  mo.observe(document.body, { childList: true, subtree: true, attributes: true });
  window.__authorBad = { mo };
  setInterval(() => {
    const t = performance.now();
    while (performance.now() - t < 4) { /* burn */ }
  }, 20);
  window.addEventListener("scroll", () => {}, { passive: true });
})();
