// Interface language: Dutch, English or French. Pick with the NL | EN | FR switch in the menu;
// the default follows the phone/browser language.
// Use t("key", { var: value }) in code, and data-i18n="key" (or -title / -placeholder / -html) in HTML.

const LANG = (() => {
  let saved = null;
  try { saved = localStorage.getItem("lang"); } catch {}
  if (saved === "nl" || saved === "en" || saved === "fr") return saved;
  const langs = navigator.languages || [navigator.language || ""];
  for (const l of langs) { const m = /^(nl|en|fr)\b/i.exec(l); if (m) return m[1].toLowerCase(); }
  return "en";
})();
const LOCALE = { nl: "nl-BE", fr: "fr-BE", en: "en-GB" }[LANG];
document.documentElement.lang = LANG;

// French uses the singular for 0 and 1 ("0 voiture"), Dutch and English only for 1.
const plural = (n, one, many) => ((LANG === "fr" ? Math.abs(n) < 2 : n === 1) ? one : many);
// Who to ask for access: the team's own admin name, or a generic one.
const adminName = () => (window.TEAM && TEAM.adminName) || ({ nl: "de ploegbeheerder", fr: "l'administrateur de l'équipe" }[LANG] || "the team admin");

// The texts themselves are in i18n/<lang>.js; only the one for this language is downloaded.
// It is written into the page right here, so it runs before the scripts that follow (common.js…).
const T = {};
document.write(`<script src="${new URL(`i18n/${LANG}.js`, document.currentScript.src).href}"><\/script>`);

function t(key, vars = {}) {
  const v = T[LANG] && T[LANG][key];
  if (v === undefined) return key;
  return typeof v === "function" ? v(vars) : v;
}

// Fill in static texts marked in the HTML.
function applyStaticTexts() {
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-html]").forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll("[data-i18n-title]").forEach(el => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  const title = document.querySelector("title[data-i18n-doc]");
  if (title) document.title = t(title.dataset.i18nDoc);
}
