// RostiQ: weather warnings for outdoor matches (Open-Meteo, free, no key). The daily job checks tomorrow's matches at
// their venue and tells the team's admins when the weather could stop play; the app shows the same warning on the card
// (index.html has its own copy of wxAlerts). Teams switch it on or off (settings/wx); by default it's on for outdoor sports.
export const WX_OUTDOOR = ["golf", "hockey", "football", "tennis"];
export const wxOn = settings => (settings && typeof settings.wx === "boolean") ? settings.wx : WX_OUTDOOR.includes((settings || {}).sport || "golf");

/** Tomorrow-style daily forecast for one day at one place: { code, max, min, rain (% chance), rainSum (mm), gust (km/h) }. */
export async function forecast(lat, lon, date) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_gusts_10m_max" +
    `&timezone=Europe%2FBrussels&start_date=${date}&end_date=${date}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const d = (await r.json()).daily;
  if (!d || !d.time || !d.time.length || d.temperature_2m_max[0] == null) return null;
  return { code: d.weather_code[0], max: Math.round(d.temperature_2m_max[0]), min: Math.round(d.temperature_2m_min[0]),
    rain: d.precipitation_probability_max[0], rainSum: d.precipitation_sum[0], gust: Math.round(d.wind_gusts_10m_max[0] || 0) };
}

/** What could stop play: a list of { k: "storm" | "wind" | "rain" | "snow" | "frost" | "heat", v }. Empty = nothing. */
export function wxAlerts(wx) {
  if (!wx) return [];
  const out = [];
  if (wx.code >= 95) out.push({ k: "storm", v: wx.rain });
  if (wx.gust >= 70) out.push({ k: "wind", v: wx.gust });
  if (wx.rainSum >= 15 || ([65, 67, 82].includes(wx.code) && wx.rain >= 70)) out.push({ k: "rain", v: Math.round(wx.rainSum || 0) });
  if ((wx.code >= 71 && wx.code <= 77) || wx.code === 85 || wx.code === 86) out.push({ k: "snow" });
  if (wx.min <= -3) out.push({ k: "frost", v: wx.min });
  if (wx.max >= 32) out.push({ k: "heat", v: wx.max });
  return out;
}

const TEXT = {
  nl: { storm: v => `onweer${v != null ? ` (${v}% kans op neerslag)` : ""}`, wind: v => `rukwinden tot ${v} km/u`, rain: v => `veel regen (${v} mm)`,
        snow: () => "sneeuw", frost: v => `vorst (${v}°)`, heat: v => `hitte (${v}°)`,
        msg: (opp, list) => `⚠️ Morgen tegen ${opp}: ${list}. Afgelasten of verplaatsen?`, train: list => `⚠️ Morgen training: ${list}. Afgelasten?` },
  fr: { storm: v => `orage${v != null ? ` (${v}% de risque de pluie)` : ""}`, wind: v => `rafales jusqu'à ${v} km/h`, rain: v => `fortes pluies (${v} mm)`,
        snow: () => "neige", frost: v => `gel (${v}°)`, heat: v => `canicule (${v}°)`,
        msg: (opp, list) => `⚠️ Demain contre ${opp} : ${list}. Annuler ou déplacer ?`, train: list => `⚠️ Entraînement demain : ${list}. Annuler ?` },
  en: { storm: v => `thunderstorms${v != null ? ` (${v}% chance of rain)` : ""}`, wind: v => `gusts up to ${v} km/h`, rain: v => `heavy rain (${v} mm)`,
        snow: () => "snow", frost: v => `frost (${v}°)`, heat: v => `heat (${v}°)`,
        msg: (opp, list) => `⚠️ Tomorrow against ${opp}: ${list}. Call it off or move it?`, train: list => `⚠️ Training tomorrow: ${list}. Call it off?` },
};
/** The admins' notification text; opp null = a training. */
export function wxMessage(alerts, lang, opp) {
  const T = TEXT[TEXT[lang] ? lang : "nl"], list = alerts.map(a => T[a.k](a.v)).join(", ");
  return opp == null ? T.train(list) : T.msg(opp, list);
}
