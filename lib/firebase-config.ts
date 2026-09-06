/**
 * Firebase web configuration.
 *
 * These values are public identifiers. They are shipped to every browser inside
 * the client bundle, and Firebase's security model never treats them as secrets
 * — access is controlled by Authentication and by the server-side ID token
 * verification in `lib/firebase-auth.ts`. Keeping them in source (instead of an
 * environment variable) avoids depending on a hosting-level env mechanism.
 *
 * A service account key is deliberately absent: token verification uses Google's
 * public signing keys, so no private credential belongs in this project.
 */
export const firebaseConfig = {
  apiKey: "AIzaSyBDL5Ax9dofn9dzn0Hkwg3x7tFnws7wQC4",
  authDomain: "portfolio-7c0d0.firebaseapp.com",
  projectId: "portfolio-7c0d0",
  storageBucket: "portfolio-7c0d0.firebasestorage.app",
  messagingSenderId: "102035937741",
  appId: "1:102035937741:web:ac6846499ce7b551eb0c84",
} as const;

/** Audience and issuer suffix for Firebase ID tokens issued to this project. */
export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
