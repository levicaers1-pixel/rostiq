// Test stand-in for Firebase Auth (only what RostiQ uses).
// The signed-in user comes from localStorage "fakeUser" ({ uid, email, displayName }); the tests set it before a page
// loads. A second app ("quick", the answer-link page) signs in anonymously.
const KEY = "fakeUser";
const listeners = [];
function makeUser(u) {
  return { uid: u.uid, email: u.email || null, displayName: u.displayName || null, photoURL: null, emailVerified: !u.anonymous,
    isAnonymous: !!u.anonymous, providerData: u.anonymous ? [] : [{ providerId: "google.com" }],
    getIdToken: async () => "fake-token-" + u.uid };
}
function stored() { try { const u = JSON.parse(localStorage.getItem(KEY) || "null"); return u && u.uid ? makeUser(u) : null; } catch { return null; } }

export function getAuth(app) {
  const quick = app && app.name === "quick";
  const auth = { quick, currentUser: quick ? null : stored(), authStateReady: async () => {} };
  return auth;
}
export function onAuthStateChanged(auth, cb) {
  listeners.push({ auth, cb });
  setTimeout(() => cb(auth.currentUser), 0);
  return () => {};
}
export const isSignInWithEmailLink = () => false;
export const getRedirectResult = async () => null;
export const signInWithEmailLink = async () => null;
export const sendSignInLinkToEmail = async () => null;
export const signInWithPopup = async () => null;
export const signInWithRedirect = async () => null;
export class GoogleAuthProvider {}
export async function signInAnonymously(auth) {
  auth.currentUser = makeUser({ uid: "anon-test", anonymous: true });
  return { user: auth.currentUser };
}
export async function signOut(auth) {
  try { localStorage.removeItem(KEY); } catch {}
  auth.currentUser = null;
  for (const l of listeners) if (l.auth === auth) l.cb(null);
}
