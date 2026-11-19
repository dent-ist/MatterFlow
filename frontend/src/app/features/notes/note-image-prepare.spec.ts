import { ImagePrepareError, PrepareDeps, prepareImage } from './note-image-prepare';
import { IMAGE_MAX_BYTES } from './note-image-size';

const blobOf = (bytes: number) => new Blob([new Uint8Array(bytes)]);

function deps(png: number | null, jpeg: number | null, size = { width: 3200, height: 1600 }) {
  const calls: { w: number; h: number; type: string; q: number }[] = [];
  const d: PrepareDeps = {
    decode: async () => ({ ...size, source: {} }),
    encode: async (_dec, s, type, q) => {
      calls.push({ w: s.width, h: s.height, type, q });
      const n = type === 'image/png' ? png : jpeg;
      return n === null ? null : blobOf(n);
    },
  };
  return { d, calls };
}

describe('prepareImage', () => {
  it('re-draws at 1,600 px on the long side as a PNG', async () => {
    const { d, calls } = deps(500_000, null);
    const p = await prepareImage(new Blob(['x']), 'shot.PNG', d);
    expect(calls).toEqual([{ w: 1600, h: 800, type: 'image/png', q: 1 }]);
    expect(p.contentType).toBe('image/png');
    expect(p.width).toBe(1600);
    expect(p.fileName).toBe('shot.png');
  });

  it('falls back to a JPEG at 0.85 when the PNG is over 2 MB', async () => {
    const { d, calls } = deps(IMAGE_MAX_BYTES + 1, 900_000);
    const p = await prepareImage(new Blob(['x']), 'photo.webp', d);
    expect(calls.map((c) => c.type)).toEqual(['image/png', 'image/jpeg']);
    expect(calls[1].q).toBe(0.85);
    expect(p.contentType).toBe('image/jpeg');
    expect(p.fileName).toBe('photo.jpg');
  });

  it('fails with size when the JPEG is still over 2 MB', async () => {
    const { d } = deps(IMAGE_MAX_BYTES + 1, IMAGE_MAX_BYTES + 5);
    await expect(prepareImage(new Blob(['x']), '', d)).rejects.toMatchObject({ problem: 'size' });
  });

  it('fails with type when the browser cannot read the file or draw it', async () => {
    const bad: PrepareDeps = {
      decode: async () => {
        throw new Error('no');
      },
      encode: async () => null,
    };
    await expect(prepareImage(new Blob(['x']), 'a.svg', bad)).rejects.toBeInstanceOf(
      ImagePrepareError,
    );
    const { d } = deps(null, null);
    await expect(prepareImage(new Blob(['x']), 'a', d)).rejects.toMatchObject({ problem: 'type' });
  });
});
