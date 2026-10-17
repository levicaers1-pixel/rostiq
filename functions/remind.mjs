// RostiQ: a personal reminder an admin sends from a match card (notices/<team>/<id> = { k: "a", d: date, by, at },
// handled by the notice function in index.js).
//
// It goes to every linked player of the team who hasn't answered that match yet (or only the ones the admin ticked:
// n.p = { <pid>: true }), not the admin who sent it, and nobody reminded in the last 12 hours: a notification with Yes / No / Maybe on each of their devices, or, when they have no
// device with notifications (an iPhone without the app on the home screen, say), an email to their verified account
// address with the same three buttons. The buttons use the player's personal answer link, so one tap saves the answer.
//
// teams/<team>/reminded/<date> = { at, by, p: { <pid>: { at, v: "push" | "mail" | "none" } } } tells the admin who was
// reached (written here only; the rules let admins remove it, nothing else). The daily reminders skip players reminded
// in the last 12 hours. Logs only counts.
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";

export const REMIND_GAP = 12 * 3600e3; // at most one manual reminder per player and match in this time
const APP = "https://app.rostiq.be";
const FROM_ADDR = process.env.INVITE_FROM || "agenda@rostiq.be";
const TZ = "Europe/Brussels";
const LOCALES = { nl: "nl-BE", fr: "fr-BE", en: "en-GB" };

const TEXT = {
  nl: { push: (who, opp, when) => `${who ? `${who} vraagt: k` : "K"}an je erbij zijn? ${opp}, ${when}. Tik je antwoord 👇`,
        subject: (brand, opp, when) => `Kan je erbij zijn? ${brand} · ${opp}, ${when}`,
        intro: (who, brand) => `${who || brand} wil weten of je erbij bent:`,
        ask: "Tik op je antwoord, het wordt meteen bewaard:", yes: "✅ Ja", maybe: "❓ Misschien", no: "❌ Nee", at: "om",
        why: brand => `Je krijgt deze e-mail omdat de ploegbeheerder van ${brand} je een herinnering stuurde in RostiQ. Liever meldingen? Zet ze aan in de app.` },
  fr: { push: (who, opp, when) => `${who ? `${who} demande : t` : "T"}u peux être là ? ${opp}, ${when}. Touche ta réponse 👇`,
        subject: (brand, opp, when) => `Tu peux être là ? ${brand} · ${opp}, ${when}`,
        intro: (who, brand) => `${who || brand} voudrait savoir si tu seras là :`,
        ask: "Touche ta réponse, elle est enregistrée tout de suite :", yes: "✅ Oui", maybe: "❓ Peut-être", no: "❌ Non", at: "à",
        why: brand => `Tu reçois cet e-mail parce que l'administrateur de ${brand} t'a envoyé un rappel dans RostiQ. Tu préfères les notifications ? Active-les dans l'app.` },
  en: { push: (who, opp, when) => `${who ? `${who} asks: c` : "C"}an you make it? ${opp}, ${when}. Tap your answer 👇`,
        subject: (brand, opp, when) => `Can you make it? ${brand} · ${opp}, ${when}`,
        intro: (who, brand) => `${who || brand} would like to know whether you can make it:`,
        ask: "Tap your answer, it's saved straight away:", yes: "✅ Yes", maybe: "❓ Maybe", no: "❌ No", at: "at",
        why: brand => `You're getting this email because the team admin of ${brand} sent you a reminder in RostiQ. Rather have notifications? Turn them on in the app.` },
};
const ACTIONS = { nl: [["yes", "✅ Ja"], ["no", "❌ Nee"], ["maybe", "❓ Misschien"]],
  fr: [["yes", "✅ Oui"], ["no", "❌ Non"], ["maybe", "❓ Peut-être"]], en: [["yes", "✅ Yes"], ["no", "❌ No"], ["maybe", "❓ Maybe"]] };
const lang3 = l => (TEXT[l] ? l : "nl");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const yymmdd = date => date.slice(2).replace(/-/g, "");
const whenText = (date, start, lang, short) => {
  const day = new Date(date + "T12:00:00Z").toLocaleDateString(LOCALES[lang], short
    ? { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" } : { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return /^\d\d:\d\d$/.test(start || "") ? `${day} ${TEXT[lang].at} ${start}` : day;
};

// The player's answer links: with a personal key one tap answers; without (team turned personal links off) the app.
export function answerLinks(tid, date, key) {
  if (key) return { open: `${APP}/a/?${key}q${yymmdd(date)}`, yes: `${APP}/a/?${key}y${yymmdd(date)}`, maybe: `${APP}/a/?${key}m${yymmdd(date)}`, no: `${APP}/a/?${key}n${yymmdd(date)}` };
  const app = `${APP}/?t=${encodeURIComponent(tid)}`;
  return { open: app, yes: `${app}&ans=yes&d=${date}`, maybe: `${app}&ans=maybe&d=${date}`, no: `${app}&ans=no&d=${date}` };
}

// m = { tid, date, brand, opp, start, who (the admin's first name or ""), links }
export function remindPush(m, lang) {
  const L = lang3(lang);
  return { title: String(m.brand || "RostiQ").slice(0, 60), body: TEXT[L].push(m.who, m.opp, whenText(m.date, m.start, L)),
    tag: `${m.tid}-${m.date}`, link: m.links.open, links: JSON.stringify({ yes: m.links.yes, maybe: m.links.maybe, no: m.links.no }),
    actions: JSON.stringify(ACTIONS[L].map(([action, title]) => ({ action, title }))) };
}
export function remindEmail(m, lang) {
  const L = lang3(lang), T = TEXT[L], brand = m.brand || "RostiQ";
  const subject = T.subject(brand, m.opp, whenText(m.date, m.start, L, true));
  const when = whenText(m.date, m.start, L);
  const text = [T.intro(m.who, brand), "", `${m.opp} · ${when}`, "", T.ask,
    `${T.yes}: ${m.links.yes}`, `${T.maybe}: ${m.links.maybe}`, `${T.no}: ${m.links.no}`, "", T.why(brand)].join("\n");
  const btn = (href, label, bg) => `<a href="${esc(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:12px 20px;border-radius:10px;background:${bg};color:#fff;font-weight:700;text-decoration:none">${esc(label)}</a>`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:520px">
<p>${esc(T.intro(m.who, brand))}</p>
<p style="font-size:17px"><b>${esc(m.opp)}</b><br>${esc(when)}</p>
<p>${esc(T.ask)}</p>
<p>${btn(m.links.yes, T.yes, "#1f8a4c")}${btn(m.links.maybe, T.maybe, "#b7791f")}${btn(m.links.no, T.no, "#c0392b")}</p>
<p style="color:#777;font-size:12px">${esc(T.why(brand))}</p></div>`;
  return { subject, text, html };
}

function mailer() {
  if (process.env.INVITE_TRANSPORT === "stream") return nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const user = (process.env.BREVO_SMTP_LOGIN || "").trim(), pass = (process.env.BREVO_SMTP_KEY || "").trim();
  return user && pass ? nodemailer.createTransport({ host: "smtp-relay.brevo.com", port: 587, secure: false, auth: { user, pass } }) : null;
}

/** Sends one admin's reminder (notice n = { k: "a", d, by }) for team tid. */
export async function sendReminder(db, tid, n) {
  const val = path => db.ref(path).get().then(s => s.val());
  const T = `teams/${tid}`, date = n.d;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
  const [brand, sched, match, quickLinks, members, players, reminded, quick, subs] = await Promise.all([
    val(`${T}/info/brand`), val(`${T}/schedule/${date}`), val(`${T}/matches/${date}`), val(`${T}/settings/quickLinks`),
    val(`${T}/members`), val(`${T}/players`), val(`${T}/reminded/${date}`), val(`quickIndex/${tid}`), val(`inviteSubs/${tid}`)]);
  if (!sched || !sched.opp || sched.cancelled === true || date < today) return console.log("reminder: match not open, nothing sent");
  const now = Date.now(), before = (reminded && reminded.p) || {}, mems = members || {}, pl = players || {};
  // Sent only by a team admin (the rules check that); a RostiQ admin outside the team has no player row: no name.
  const who = String(((pl[mems[n.by]] || {}).name || "").trim().split(/\s+/)[0] || "").slice(0, 30);
  const writes = {}, stats = { push: 0, mail: 0, none: 0, skipped: 0 };
  let mail;
  for (const [uid, pid] of Object.entries(mems)) {
    const p = pl[pid];
    if (uid === n.by || !p || !p.name || (p.avail || {})[date]) continue; // the sender knows; answered already
    if (n.p && !n.p[pid]) continue; // the admin left this player out
    if (before[pid] && now - Number(before[pid].at || 0) < REMIND_GAP) { stats.skipped++; continue; }
    let key = (quick || {})[pid] || null;
    if (!key && quickLinks !== false) { // made once and kept, like the ones the app and the daily job make
      key = crypto.randomBytes(16).toString("base64url");
      writes[`quickKeys/${key}`] = { t: tid, p: pid, at: now };
      writes[`quickIndex/${tid}/${pid}`] = key;
    }
    const m = { tid, date, brand, opp: String(sched.opp).slice(0, 60), start: (match || {}).start, who, links: answerLinks(tid, date, key) };
    let v = "none", lang = null;
    for (const [dev, info] of Object.entries((await val(`pushTokens/${uid}`)) || {})) {
      if (!info || !info.token) continue;
      lang = lang || info.lang;
      try {
        await getMessaging().send({ token: info.token, data: remindPush(m, info.lang), webpush: { headers: { Urgency: "high", TTL: String(24 * 3600) } } });
        v = "push";
      } catch (e) {
        const code = (e && (e.code || e.errorInfo && e.errorInfo.code)) || "";
        if (/registration-token-not-registered|invalid-registration-token/.test(code)) writes[`pushTokens/${uid}/${dev}`] = null;
      }
    }
    if (v === "none") { // no working notifications: email to the account's own (verified) address
      const user = await getAuth().getUser(uid).catch(() => null);
      if (user && user.email && user.emailVerified) {
        mail = mail === undefined ? mailer() : mail;
        if (mail) {
          const msg = remindEmail(m, lang || ((subs || {})[pid] || {}).l);
          try {
            const info = await mail.sendMail({ from: { name: brand ? `${String(brand).slice(0, 40)} via RostiQ` : "RostiQ", address: FROM_ADDR }, to: user.email, ...msg });
            if (info && info.message && process.env.INVITE_TRANSPORT === "stream") console.log("=====MAIL=====\n" + info.message.toString());
            v = "mail";
          } catch (e) { console.warn("reminder email failed:", (e && (e.responseCode || e.code)) || "error"); }
        }
      }
    }
    stats[v]++;
    writes[`${T}/reminded/${date}/p/${pid}`] = { at: now, v };
  }
  // Always stamped, so the admin's screen knows the reminder has been handled (also when nobody new was left).
  writes[`${T}/reminded/${date}/at`] = now;
  writes[`${T}/reminded/${date}/by`] = n.by;
  await db.ref().update(writes);
  console.log(`reminder: ${stats.push} by notification, ${stats.mail} by email, ${stats.none} unreachable, ${stats.skipped} reminded recently`);
}
