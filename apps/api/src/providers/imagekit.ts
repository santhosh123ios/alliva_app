import { Logger } from '../common/logger';
import type { StorageProvider } from './interfaces';
import { LocalStorageProvider, S3StorageProvider } from './mock.providers';

export class ImageKitStorageProvider implements StorageProvider {
  private readonly logger = new Logger('ImageKit');

  async save(input: { filename: string; mimeType: string; bytes: Buffer }): Promise<{ url: string }> {
    const key = process.env.IMAGEKIT_PRIVATE_KEY;
    if (!key) throw new Error('ImageKit is not configured');
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), input.filename);
    form.append('fileName', input.filename.replace(/[^a-zA-Z0-9._-]/g, ''));
    form.append('folder', process.env.IMAGEKIT_FOLDER || '/alliva');
    form.append('useUniqueFileName', 'true');
    const response = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      this.logger.error(`ImageKit rejected ${input.filename} (${response.status}): ${detail.slice(0, 500)}`);
      throw new Error(`ImageKit rejected the upload (${response.status})`);
    }
    const saved = (await response.json()) as { url: string };
    return { url: saved.url };
  }
}

export function createStorageProvider(): StorageProvider {
  const driver = process.env.STORAGE_DRIVER;
  if (driver === 's3') return new S3StorageProvider();
  if (driver === 'local') return new LocalStorageProvider();
  if (process.env.IMAGEKIT_PRIVATE_KEY) return new ImageKitStorageProvider();
  return new LocalStorageProvider();
}
