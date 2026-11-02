// RostiQ's own sign-in email: Firebase makes the sign-in link (the same kind the app used to have Firebase send), and we
// send it through Brevo from login@rostiq.be, in the player's language and with the team's name. Firebase's own email
// (and its SMTP setting) failed silently; this way a failure is visible and logged.
// Limits per email address (signinLog/<hash>: { n, at }) and per IP (signinIp/<hash>), written only by this function and
// cleaned up by the daily job. Logs only counts and outcomes, never addresses.
import nodemailer from "nodemailer";
import crypto from "node:crypto";

export const SIGNIN_FROM = process.env.SIGNIN_FROM || "login@rostiq.be";
export const LIMITS = { perEmail: 4, perIp: 15, windowMs: 3600e3 };
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const APP_ORIGINS = ["https://app.rostiq.be"];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const hashKey = s => crypto.createHash("sha256").update(String(s).toLowerCase()).digest("base64url").slice(0, 24);

/** Checks a request body; returns { email, url, lang, tid } or { error }. Only app pages may be the link's target. */
export function checkRequest(body) {
  const email = String((body && body.email) || "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 200) return { error: "email" };
  let url;
  try { url = new URL(String(body.url || "")); } catch { return { error: "url" }; }
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url.origin) && process.env.FUNCTIONS_EMULATOR === "true";
  if (!APP_ORIGINS.includes(url.origin) && !local) return { error: "url" };
  const lang = ["nl", "fr", "en"].includes(body.lang) ? body.lang : "nl";
  const tid = /^[a-z0-9][a-z0-9-]{1,39}$/.test(body.tid || "") ? body.tid : null;
  return { email, url: url.href, lang, tid };
}

/** May this address / IP get another email now? Returns the new counter values, or null when over the limit. */
export function nextCount(prev, now, max) {
  if (!prev || typeof prev.at !== "number" || now - prev.at > LIMITS.windowMs) return { n: 1, at: now };
  return prev.n >= max ? null : { n: prev.n + 1, at: prev.at };
}

const TEXT = {
  nl: { subject: team => team ? `Aanmelden bij ${team} op RostiQ` : "Je aanmeldlink voor RostiQ",
        hello: "Hallo,", intro: team => team ? `Klik op de knop om je aan te melden bij ${team} op RostiQ.` : "Klik op de knop om je aan te melden bij RostiQ.",
        button: "Aanmelden", device: "Open de link bij voorkeur op het toestel waarop je je aanmeldlink vroeg. De link werkt één keer.",
        other: "Werkt de knop niet? Kopieer dan deze link in je browser:", notYou: "Heb je dit niet gevraagd? Dan mag je deze mail negeren." },
  fr: { subject: team => team ? `Connexion à ${team} sur RostiQ` : "Ton lien de connexion RostiQ",
        hello: "Bonjour,", intro: team => team ? `Clique sur le bouton pour te connecter à ${team} sur RostiQ.` : "Clique sur le bouton pour te connecter à RostiQ.",
        button: "Se connecter", device: "Ouvre de préférence le lien sur l'appareil où tu l'as demandé. Le lien ne fonctionne qu'une fois.",
        other: "Le bouton ne marche pas ? Copie ce lien dans ton navigateur :", notYou: "Tu n'as rien demandé ? Ignore simplement cet e-mail." },
  en: { subject: team => team ? `Sign in to ${team} on RostiQ` : "Your RostiQ sign-in link",
        hello: "Hi,", intro: team => team ? `Tap the button to sign in to ${team} on RostiQ.` : "Tap the button to sign in to RostiQ.",
        button: "Sign in", device: "Preferably open the link on the device where you asked for it. The link works once.",
        other: "Button not working? Copy this link into your browser:", notYou: "Didn't ask for this? You can ignore this email." },
};

/** The email: subject, plain text and HTML. */
export function signinEmail(link, lang, team) {
  const T = TEXT[lang] || TEXT.nl, name = team ? String(team).slice(0, 60) : "";
  const text = `${T.hello}\n\n${T.intro(name)}\n\n${link}\n\n${T.device}\n\n${T.notYou}\n\nRostiQ`;
  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;color:#17152f">
    <div style="background:#1e1b4b;color:#fff;padding:18px 22px;border-radius:16px 16px 0 0;font-weight:800;font-size:20px">RostiQ</div>
    <div style="border:1px solid #dddcef;border-top:0;border-radius:0 0 16px 16px;padding:22px">
      <p style="margin:0 0 12px">${esc(T.hello)}</p>
      <p style="margin:0 0 20px">${esc(T.intro(name))}</p>
      <p style="margin:0 0 20px"><a href="${esc(link)}" style="display:inline-block;background:#1e1b4b;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px">${esc(T.button)}</a></p>
      <p style="margin:0 0 16px;color:#605d7e;font-size:14px">${esc(T.device)}</p>
      <p style="margin:0 0 6px;color:#605d7e;font-size:13px">${esc(T.other)}</p>
      <p style="margin:0 0 16px;font-size:12px;word-break:break-all"><a href="${esc(link)}" style="color:#5b4fd6">${esc(link)}</a></p>
      <p style="margin:0;color:#605d7e;font-size:13px">${esc(T.notYou)}</p>
    </div></div>`;
  return { subject: T.subject(name), text, html };
}

let transport = null;
function mailer() {
  if (transport) return transport;
  const user = (process.env.BREVO_SMTP_LOGIN || "").trim(), pass = (process.env.BREVO_SMTP_KEY || "").trim();
  transport = process.env.INVITE_TRANSPORT === "stream" ? nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" })
    : nodemailer.createTransport({ host: "smtp-relay.brevo.com", port: 587, secure: false, auth: { user, pass } });
  return transport;
}

/** Handles one request: { status, body }. makeLink(email, url) is Firebase Auth's generateSignInWithEmailLink. */
export async function handleSignin({ db, body, ip, makeLink, now = Date.now() }) {
  const req = checkRequest(body);
  if (req.error) return { status: 400, body: { error: req.error } };
  // Limits (in a transaction, so two quick requests can't both slip through).
  const over = async (path, max) => {
    let ok = true;
    await db.ref(path).transaction(prev => { const next = nextCount(prev, now, max); if (!next) { ok = false; return; } return next; });
    return !ok;
  };
  if (await over(`signinIp/${hashKey(ip || "?")}`, LIMITS.perIp) || await over(`signinLog/${hashKey(req.email)}`, LIMITS.perEmail)) {
    console.log("signin: over the limit");
    return { status: 429, body: { error: "rate" } };
  }
  let link;
  try { link = await makeLink(req.email, { url: req.url, handleCodeInApp: true }); }
  catch (e) { console.error("signin: link failed", (e && e.code) || "error"); return { status: 500, body: { error: "link" } }; }
  const team = req.tid ? ((await db.ref(`teams/${req.tid}/info/shortName`).get()).val() || (await db.ref(`teams/${req.tid}/info/brand`).get()).val()) : null;
  const msg = signinEmail(link, req.lang, team);
  try {
    const info = await mailer().sendMail({ from: { name: team ? `${String(team).slice(0, 40)} via RostiQ` : "RostiQ", address: SIGNIN_FROM },
      to: req.email, subject: msg.subject, text: msg.text, html: msg.html });
    if (process.env.INVITE_TRANSPORT === "stream") console.log(info.message.toString());
  } catch (e) { console.error("signin: email failed", (e && (e.responseCode || e.code)) || "error"); return { status: 502, body: { error: "send" } }; }
  console.log("signin: email sent");
  return { status: 200, body: { ok: true } };
}
