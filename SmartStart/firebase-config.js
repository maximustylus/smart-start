// Firebase web app identifiers for SMART START (project smartstart-careers).
// These are public identifiers, not secrets: access is enforced by Firebase
// Authentication and firestore.rules, not by hiding this file. This file is
// served publicly, so it carries no personal details.
export const firebaseConfig = {
  apiKey: "AIzaSyCpfgP84zpNPGgUZ3cxci46pwXswPoBqDQ",
  // The hosting domain, not firebaseapp.com: Firebase Hosting serves the sign-in
  // handler at /__/auth/, which keeps Google sign-in working in Safari and in the
  // installed (Home Screen) app, where third-party cookies are blocked.
  authDomain: "smartstart-careers.web.app",
  projectId: "smartstart-careers",
  storageBucket: "smartstart-careers.firebasestorage.app",
  messagingSenderId: "968605244748",
  appId: "1:968605244748:web:95e0c670059d57ce1803e9"
};
export const DATA_DOC = ["smartstart", "current"];
// App Check (2.20.1): the public reCAPTCHA Enterprise site key for this web app, from the Firebase console
// (App Check, Apps). Empty means App Check is not started; the functions enforce it only once ENFORCE_APP_CHECK
// is switched on in functions/index.js, after a week of monitoring shows the app's calls carry valid tokens.
export const APP_CHECK_SITE_KEY = "6LdxBQ4uAAAAAMiHeOxrGQF4Ha58iJwpun_Or-g7";
