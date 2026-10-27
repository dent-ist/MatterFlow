import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { request } from '@playwright/test';
import { ADMIN_USER, Api, BASE_URL, Json } from './api';

/** A real, square, solid-colour PNG (`size` pixels, RGB) so the browser can draw it as the tab icon and the header mark. */
export function makePng(size: number, rgb: [number, number, number] = [11, 95, 255]): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: size }, () => rgb).flat()),
  ]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const GOOD_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0B5FFF"/><circle cx="32" cy="32" r="16" fill="#fff"/></svg>';

export const UNSAFE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><script>alert(1)</script><rect width="64" height="64"/></svg>';

/** Writes `content` to a temp file and returns its path (for `setInputFiles` and the multipart upload). */
export function tempFile(name: string, content: Buffer | string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-branding-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

/** Puts the branding back to the built-in name and icon (the spec's cleanup; safe to call when nothing is set). */
export async function resetBranding(admin: Api): Promise<void> {
  const view = await admin.get<Json>('/api/v1/admin/settings/branding');
  if (view.iconUrl)
    await admin.call(
      'DELETE',
      `/api/v1/admin/settings/branding/icon?rowVersion=${encodeURIComponent(view.iconRowVersion)}`,
    );
  if (view.appNameIsCustom)
    await admin.call(
      'DELETE',
      `/api/v1/admin/settings/branding/name?rowVersion=${encodeURIComponent(view.appNameRowVersion)}`,
    );
}

/** Sets the application name through the API (a setup shortcut for specs that are not about the form). */
export async function setBrandingName(admin: Api, appName: string): Promise<void> {
  const view = await admin.get<Json>('/api/v1/admin/settings/branding');
  await admin.put('/api/v1/admin/settings/branding/name', {
    appName,
    rowVersion: view.appNameRowVersion,
  });
}

/** `PUT` of one icon file as the administrator (multipart, the way the page sends it); returns the status and the parsed body. */
export async function putIcon(
  file: string,
  rowVersion = '',
): Promise<{ status: number; body: Json }> {
  const ctx = await request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { 'X-Dev-User': ADMIN_USER, 'X-MatterFlow-Client': 'web' },
  });
  try {
    const response = await ctx.put('/api/v1/admin/settings/branding/icon', {
      multipart: {
        file: { name: path.basename(file), mimeType: 'image/png', buffer: fs.readFileSync(file) },
        rowVersion,
      },
    });
    const text = await response.text();
    return { status: response.status(), body: text ? JSON.parse(text) : null };
  } finally {
    await ctx.dispose();
  }
}
