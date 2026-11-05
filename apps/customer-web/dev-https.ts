import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

/**
 * A self-signed certificate for the dev server, so phones on the same Wi-Fi open the app over https:
 * browsers only share the device's location on secure pages. It covers localhost and every IPv4 address
 * this machine has right now, and is made again when that list changes (a new network, a new IP).
 * Lives in `.certs/` next to this file, which keeps itself out of git.
 */
export function devCertificate(root: string) {
  const dir = join(root, '.certs');
  const key = join(dir, 'dev-key.pem');
  const cert = join(dir, 'dev-cert.pem');
  const stamp = join(dir, 'hosts.txt');
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((row) => row && row.family === 'IPv4')
    .map((row) => row!.address);
  const hosts = ['DNS:localhost', ...[...new Set(['127.0.0.1', ...ips])].map((ip) => `IP:${ip}`)].join(',');

  const current = existsSync(stamp) ? readFileSync(stamp, 'utf8') : '';
  if (!existsSync(key) || !existsSync(cert) || current !== hosts) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.gitignore'), '*\n');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
      '-keyout', key, '-out', cert,
      '-subj', '/CN=Alliva dev',
      '-addext', `subjectAltName=${hosts}`,
    ], { stdio: 'ignore' });
    writeFileSync(stamp, hosts);
  }
  return { key: readFileSync(key), cert: readFileSync(cert), ips };
}
