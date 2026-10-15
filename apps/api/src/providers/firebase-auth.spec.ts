import { createSign, generateKeyPairSync } from 'node:crypto';
import { verifyFirebasePhoneToken } from './firebase-auth';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function token(claims: Record<string, unknown>, kid = 'test') {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const data = `${header}.${body}`;
  const signature = createSign('RSA-SHA256').update(data).sign(privateKey).toString('base64url');
  return `${data}.${signature}`;
}

const loadCerts = async () => ({ test: publicPem });

function claims(overrides: Record<string, unknown> = {}) {
  return {
    aud: 'alliva-test',
    iss: 'https://securetoken.google.com/alliva-test',
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: 'firebase-user',
    phone_number: '+97336000001',
    firebase: { sign_in_provider: 'phone' },
    ...overrides,
  };
}

describe('firebase phone token', () => {
  it('accepts a signed Bahrain phone token', async () => {
    await expect(verifyFirebasePhoneToken(token(claims()), 'alliva-test', loadCerts)).resolves.toEqual({
      phone: '+97336000001',
      uid: 'firebase-user',
    });
  });

  it('rejects another project, a non-Bahrain number, and a bad signature', async () => {
    await expect(verifyFirebasePhoneToken(token(claims({ aud: 'other' })), 'alliva-test', loadCerts)).rejects.toThrow(
      'The code is not valid',
    );
    await expect(
      verifyFirebasePhoneToken(token(claims({ phone_number: '+966500000000' })), 'alliva-test', loadCerts),
    ).rejects.toThrow('Use a Bahrain mobile number');
    await expect(verifyFirebasePhoneToken(`${token(claims())}x`, 'alliva-test', loadCerts)).rejects.toThrow(
      'The code is not valid',
    );
  });
});
