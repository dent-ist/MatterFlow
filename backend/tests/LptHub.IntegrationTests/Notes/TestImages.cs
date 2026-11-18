using System.Buffers.Binary;
using System.Text;

namespace LptHub.IntegrationTests.Notes;

/// <summary>Tiny PNG and JPEG byte arrays the server's header check accepts (the pixel data is not decoded by the server, so it is a minimal stream).</summary>
internal static class TestImages
{
    private static uint Crc(byte[] data)
    {
        var c = 0xFFFFFFFFu;
        foreach (var b in data)
        {
            c ^= b;
            for (var k = 0; k < 8; k++)
                c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
        }

        return c ^ 0xFFFFFFFFu;
    }

    private static byte[] Chunk(string type, byte[] data)
    {
        var typed = Encoding.ASCII.GetBytes(type).Concat(data).ToArray();
        var bytes = new byte[12 + data.Length];
        BinaryPrimitives.WriteUInt32BigEndian(bytes, (uint)data.Length);
        typed.CopyTo(bytes, 4);
        BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(8 + data.Length), Crc(typed));
        return bytes;
    }

    public static byte[] Png(int width = 1, int height = 1, int padding = 0)
    {
        var ihdr = new byte[13];
        BinaryPrimitives.WriteUInt32BigEndian(ihdr, (uint)width);
        BinaryPrimitives.WriteUInt32BigEndian(ihdr.AsSpan(4), (uint)height);
        ihdr[8] = 8;
        ihdr[9] = 2;
        var parts = new List<byte[]> { new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }, Chunk("IHDR", ihdr) };
        if (padding > 0)
            parts.Add(Chunk("tEXt", [.. Encoding.ASCII.GetBytes("pad\0"), .. new byte[padding]]));
        parts.Add(Chunk("IDAT", [0x78, 0x9C, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]));
        parts.Add(Chunk("IEND", []));
        return [.. parts.SelectMany(p => p)];
    }

    /// <summary>A valid PNG of exactly <paramref name="size"/> bytes (a text chunk pads it).</summary>
    public static byte[] PngOfSize(int size)
    {
        var plain = Png().Length;
        return Png(padding: size - plain - 12 - 4);
    }

    public static byte[] Jpeg(int width = 1, int height = 1)
    {
        var sof = new List<byte> { 8, (byte)(height >> 8), (byte)height, (byte)(width >> 8), (byte)width, 3 };
        for (var i = 0; i < 3; i++)
            sof.AddRange([(byte)(i + 1), 0x11, 0x00]);
        var bytes = new List<byte> { 0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, (byte)'J', (byte)'F', (byte)'I', (byte)'F', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0 };
        bytes.AddRange([0xFF, 0xC0, (byte)((sof.Count + 2) >> 8), (byte)(sof.Count + 2)]);
        bytes.AddRange(sof);
        bytes.AddRange([0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x7F, 0xFF, 0x00, 0x12, 0xFF, 0xD9]);
        return [.. bytes];
    }
}
