// Daily error email: the error reports the app sends (errors/<id>, see flushErrors in common.js) since the last email,
// grouped per error, to the RostiQ admin. No new errors: no email. Reports older than 30 days are removed.
// errorReport/last remembers up to when the last email went (only the job writes it; clients can't read it).
import nodemailer from "nodemailer";

const TO = process.env.ERROR_REPORT_TO || "levicaers1@gmail.com";
const FROM_ADDR = process.env.INVITE_FROM || "agenda@rostiq.be";
const KEEP_DAYS = 30;
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// The reports after `since`, grouped by message + place in the code. Pure (tested in ics.test.mjs).
export function groupErrors(errors, since) {
  const groups = new Map();
  let reports = 0;
  for (const r of Object.values(errors || {})) {
    if (!r || typeof r.at !== "number" || r.at <= since) continue;
    reports++;
    for (const it of Object.values(r.items || {})) {
      if (!it || !it.msg) continue;
      const key = `${it.msg}\n${it.src || ""}`;
      const g = groups.get(key) || { msg: String(it.msg).slice(0, 300), src: String(it.src || "").slice(0, 120), count: 0, teams: new Set(), pages: new Set(), devices: new Set(), versions: new Set(), first: r.at, last: r.at };
      g.count += Number(it.n) || 1;
      if (r.team) g.teams.add(r.team);
      if (r.page) g.pages.add(r.page);
      if (r.device) g.devices.add(r.device);
      if (r.version) g.versions.add(r.version);
      g.first = Math.min(g.first, r.at); g.last = Math.max(g.last, r.at);
      groups.set(key, g);
    }
  }
  const list = [...groups.values()].sort((a, b) => b.count - a.count || b.last - a.last);
  return { reports, list };
}

// The email (Dutch: it's for Levi).
export function errorEmail({ reports, list }, today) {
  const when = t => new Date(t).toLocaleString("nl-BE", { timeZone: "Europe/Brussels", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const subject = `RostiQ: ${list.length} ${list.length === 1 ? "fout" : "fouten"} sinds de vorige mail (${reports} ${reports === 1 ? "melding" : "meldingen"})`;
  const lines = list.map((g, i) => `${i + 1}. ${g.msg}\n   waar: ${g.src || "?"} · ${g.count}× · ploegen: ${[...g.teams].join(", ") || "-"} · pagina's: ${[...g.pages].join(", ") || "-"}\n` +
    `   toestellen: ${[...g.devices].join(" | ") || "-"} · versie: ${[...g.versions].join(", ") || "-"} · ${when(g.first)} – ${when(g.last)}`);
  const text = `Foutmeldingen uit de app, ${today}.\n\n${lines.join("\n\n")}\n\nDe volledige meldingen staan in de database onder errors/.`;
  const rows = list.map(g => `<tr><td style="padding:10px;border-top:1px solid #eee;vertical-align:top"><b style="color:#9f1d1d">${g.count}×</b></td>
    <td style="padding:10px;border-top:1px solid #eee"><div style="font-family:monospace;font-size:13px">${esc(g.msg)}</div>
    <div style="color:#666;font-size:12px;margin-top:4px">${esc(g.src || "?")} · versie ${esc([...g.versions].join(", ") || "-")} · ${esc(when(g.first))} – ${esc(when(g.last))}</div>
    <div style="color:#666;font-size:12px">Ploegen: ${esc([...g.teams].join(", ") || "-")} · pagina's: ${esc([...g.pages].join(", ") || "-")}</div>
    <div style="color:#666;font-size:12px">${esc([...g.devices].join(" | ") || "-")}</div></td></tr>`).join("");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:640px"><h2 style="margin:0 0 6px">${esc(subject)}</h2>
    <p style="color:#666;margin:0 0 12px">Foutmeldingen uit de app, gegroepeerd per fout. De volledige meldingen staan in de database onder <code>errors/</code>.</p>
    <table style="border-collapse:collapse;width:100%">${rows}</table></div>`;
  return { subject, text, html };
}

// The step in the daily job: returns the database writes (old reports removed, errorReport/last).
export async function runErrorReport({ db, dry = false, now = Date.now(), today }) {
  const [errSnap, lastSnap] = await Promise.all([db.ref("errors").once("value"), db.ref("errorReport/last").once("value")]);
  const errors = errSnap.val() || {}, since = Number(lastSnap.val()) || now - 864e5;
  const writes = {};
  for (const [id, r] of Object.entries(errors)) if (!r || typeof r.at !== "number" || r.at < now - KEEP_DAYS * 864e5) writes[`errors/${id}`] = null;
  const grouped = groupErrors(errors, since);
  if (!grouped.list.length) { console.log(`Error email: no new errors.`); return writes; }
  const user = (process.env.BREVO_SMTP_LOGIN || "").trim(), pass = (process.env.BREVO_SMTP_KEY || "").trim();
  const stream = process.env.INVITE_TRANSPORT === "stream";
  if (dry || (!stream && (!user || !pass))) { console.log(`Error email: ${grouped.list.length} kinds of error ${dry ? "would be" : "not"} sent${dry ? "" : " (Brevo not set up)"}.`); return writes; }
  const mail = nodemailer.createTransport(stream ? { streamTransport: true, buffer: true, newline: "unix" } : { host: "smtp-relay.brevo.com", port: 587, secure: false, auth: { user, pass } });
  const msg = errorEmail(grouped, today);
  try {
    const info = await mail.sendMail({ from: { name: "RostiQ", address: FROM_ADDR }, to: TO, subject: msg.subject, text: msg.text, html: msg.html });
    if (stream) console.log(info.message.toString());
    writes["errorReport/last"] = now;
    console.log(`Error email: ${grouped.list.length} kinds of error (${grouped.reports} reports) sent.`);
  } catch (e) { console.warn("Error email failed:", (e && e.code) || e); }
  return writes;
}
