import { createPublicKey, createVerify } from 'node:crypto';

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const BAHRAIN_MOBILE = /^\+973\d{8}$/;

type Certs = Record<string, string>;
type Claims = {
  aud?: string;
  iss?: string;
  exp?: number;
  sub?: string;
  phone_number?: string;
  firebase?: { sign_in_provider?: string };
};

let cached: { certs: Certs; expiresAt: number } | undefined;

export function firebaseWebConfig() {
  const apiKey = process.env.FIREBASE_API_KEY;
  const authDomain = process.env.FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const appId = process.env.FIREBASE_APP_ID;
  if (!apiKey || !authDomain || !projectId || !appId) return { enabled: false as const };
  return { enabled: true as const, apiKey, authDomain, projectId, appId };
}

export async function verifyFirebasePhoneToken(
  idToken: string,
  projectId: string,
  loadCerts: () => Promise<Certs> = loadGoogleCerts,
): Promise<{ phone: string; uid: string }> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('The code is not valid');
  const [encodedHeader, encodedClaims, encodedSignature] = parts as [string, string, string];
  const header = parseJson(encodedHeader) as { alg?: string; kid?: string };
  const claims = parseJson(encodedClaims) as Claims;
  if (header.alg !== 'RS256' || !header.kid) throw new Error('The code is not valid');
  const certs = await loadCerts();
  const pem = certs[header.kid];
  if (!pem) throw new Error('The code is not valid');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${encodedHeader}.${encodedClaims}`);
  verifier.end();
  const signature = Buffer.from(encodedSignature, 'base64url');
  if (!verifier.verify(createPublicKey(pem), signature)) throw new Error('The code is not valid');
  const now = Date.now();
  if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('The code is not valid');
  }
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now - 60_000) throw new Error('The code is not valid');
  if (claims.firebase?.sign_in_provider && claims.firebase.sign_in_provider !== 'phone') {
    throw new Error('The code is not valid');
  }
  if (!claims.sub || !claims.phone_number || !BAHRAIN_MOBILE.test(claims.phone_number)) {
    throw new Error('Use a Bahrain mobile number (+973)');
  }
  return { phone: claims.phone_number, uid: claims.sub };
}

async function loadGoogleCerts(): Promise<Certs> {
  if (cached && cached.expiresAt > Date.now()) return cached.certs;
  const response = await fetch(CERTS_URL);
  if (!response.ok) throw new Error('The code is not valid');
  const certs = (await response.json()) as Certs;
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  cached = { certs, expiresAt: Date.now() + maxAge * 1000 };
  return certs;
}

function parseJson(segment: string) {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new Error('The code is not valid');
  }
}
