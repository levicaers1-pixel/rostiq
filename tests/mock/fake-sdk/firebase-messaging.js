// Test stand-in for Firebase Messaging: push is never available in tests.
export const getMessaging = () => ({});
export const getToken = async () => { throw new Error("push not available in tests"); };
export const deleteToken = async () => true;
