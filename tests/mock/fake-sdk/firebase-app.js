// Test stand-in for the Firebase app module (only what RostiQ uses).
export function initializeApp(config, name = "[DEFAULT]") { return { config, name }; }
