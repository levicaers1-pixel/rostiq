// RostiQ – runs in <head>, before the page is drawn: shows the team's last-known branding (saved on
// this device by common.js) straight away, so switching tabs doesn't flash the default RostiQ look.
// common.js takes over once the team's data arrives.
(function () {
  try {
    const q = new URLSearchParams(location.search);
    if (q.has("pick")) return;
    const id = (q.get("t") || localStorage.getItem("team") || "").toLowerCase();
    if (!id) return;
    const info = JSON.parse(localStorage.getItem("brand:" + id) || "null");
    window.BOOT_BRAND = { id, info };
    const c = info && info.colors;
    if (c) {
      const vars = o => Object.entries(o || {}).filter(([k, v]) => /^--[a-z-]{2,20}$/.test(k) && /^#[0-9a-fA-F]{6}$/.test(v))
        .map(([k, v]) => `${k}: ${v};`).join(" ");
      const style = document.createElement("style");
      style.id = "team-colors";
      style.textContent = `:root { ${vars(c.light)} } @media (prefers-color-scheme: dark) { :root { ${vars(c.dark)} } }`;
      document.head.append(style);
    }
    if (info && info.font === "serif") document.documentElement.classList.add("font-serif");
    if (info && info.brand) document.title = document.title.replace(/^RostiQ/, info.brand);
  } catch (e) { /* no storage: the page simply starts with the default look */ }
})();

// Called right after the header: the team's logo or name; an empty placeholder when it isn't known yet.
function rostiqBootHeader() {
  const b = window.BOOT_BRAND, a = document.querySelector(".brand-inner > a");
  if (!b || !a) return;
  const info = b.info || {};
  a.textContent = "";
  if (info.logo) {
    const img = document.createElement("img");
    img.className = "logo"; img.alt = info.brand || ""; img.src = info.logo;
    a.append(img);
  } else {
    const span = document.createElement("span");
    span.className = "logo-text";
    span.textContent = info.brand || " ";
    a.append(span);
  }
}
