// Fixture: a well-behaved registration set - one scoped observer with a
// filter, no interval, no hot listener. Used by tests/author-check.mjs.
(function () {
  const el = document.getElementById("scoped") || document.body;
  const mo = new MutationObserver(() => {});
  mo.observe(el, { childList: true, attributes: true, attributeFilter: ["data-x"] });
  window.__authorGood = { mo };
})();
