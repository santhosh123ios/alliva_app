import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';

export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
};

let app: FirebaseApp | undefined;
let verifier: RecaptchaVerifier | undefined;
let sending: Promise<ConfirmationResult> | undefined;

function authFor(config: FirebaseWebConfig) {
  app ??= initializeApp(config);
  return getAuth(app);
}

function freshRecaptchaContainer() {
  const host = document.createElement('div');
  host.id = 'firebase-recaptcha-host';
  document.body.appendChild(host);
  const container = document.createElement('div');
  host.appendChild(container);
  return container;
}

export function clearFirebaseRecaptcha() {
  try {
    verifier?.clear();
  } catch {
    // A failed send can leave the widget already destroyed.
  }
  verifier = undefined;
  document.getElementById('firebase-recaptcha-host')?.remove();
}

export async function sendFirebaseCode(config: FirebaseWebConfig, phone: string, locale: 'en' | 'ar') {
  if (sending) return sending;
  const auth = authFor(config);
  auth.languageCode = locale;
  clearFirebaseRecaptcha();
  verifier = new RecaptchaVerifier(auth, freshRecaptchaContainer(), { size: 'invisible' });
  sending = signInWithPhoneNumber(auth, phone, verifier).finally(() => {
    sending = undefined;
  });
  try {
    return await sending;
  } catch (error) {
    clearFirebaseRecaptcha();
    throw error;
  }
}

export async function confirmFirebaseCode(confirmation: ConfirmationResult, code: string) {
  const credential = await confirmation.confirm(code);
  return credential.user.getIdToken();
}
