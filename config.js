// Paste your Firebase Realtime Database URL between the quotes, e.g.
// "https://my-team-default-rtdb.europe-west1.firebasedatabase.app"
window.FIREBASE_DB_URL = "https://wintermidam-default-rtdb.europe-west1.firebasedatabase.app";

// Login: paste the web-app config from Firebase (Project settings → Your apps) here
// to require sign-in. Leave it out to run without accounts.
// Push notifications: the public "Web Push certificate" key from Firebase (Project settings → Cloud Messaging).
// Empty = the "notifications" option doesn't appear.
window.FIREBASE_VAPID_KEY = "BKoBDqp8uzkXXea-Z4AeND7wgXJgkQY44XfPiMAiy59CBZUjv7TjikM0n_6JX7MxWcT2cgcBH8TGdZeZ6JvlAJ8";

// Calendar subscriptions: where the personal calendar feeds are served (functions/, deployed with Firebase).
// Empty = the subscribe dialog doesn't appear and "Add to calendar" downloads a one-off .ics file.
window.CAL_BASE = "https://wintermidam.web.app/cal/";

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCUyqCemJncGy0tWRUi6JXfrclAGWePzto",
  // Sign-in helper is self-hosted on this site (/__/auth, copied from wintermidam.firebaseapp.com),
  // so phones don't block it as a third-party site.
  authDomain: "app.rostiq.be",
  databaseURL: "https://wintermidam-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "wintermidam",
  messagingSenderId: "354856091940", // needed for push notifications
  appId: "1:354856091940:web:25d894cffb78f312feb3b1",
};
