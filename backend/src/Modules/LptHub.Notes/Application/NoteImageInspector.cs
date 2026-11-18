using System.Buffers.Binary;

namespace LptHub.Notes.Application;

/// <summary>What <see cref="NoteImageInspector"/> found out about a byte array.</summary>
internal enum NoteImageProblem
{
    None,

    /// <summary>Not a PNG or a JPEG that browsers show everywhere (SVG, GIF, WebP, BMP, TIFF, HEIC, an animated PNG, a JPEG with arithmetic coding or four colour channels, text, anything else).</summary>
    Unsupported,

    /// <summary>Starts like a PNG or a JPEG but is truncated, damaged or carries data after its end.</summary>
    Corrupt,

    /// <summary>More than <see cref="NoteImageInspector.MaxPixels"/> on a side.</summary>
    TooManyPixels,
}

internal readonly record struct NoteImageInfo(NoteImageProblem Problem, string ContentType, int Width, int Height)
{
    public bool IsValid => Problem == NoteImageProblem.None;
}

/// <summary>
/// Finds the type of an uploaded image by its bytes (never by the declared content type or the file name) and reads its size from the header, without decoding a pixel and without an image library
/// (design R4: the browser re-draws every image; the server only verifies). PNG: signature, every chunk with its length and CRC-32, <c>IHDR</c> first, an <c>IDAT</c>, <c>IEND</c> last, no animation chunk.
/// JPEG: <c>SOI</c>, every marker segment inside the file up to the scan, one baseline, extended or progressive frame header (8 bits, 1 or 3 components), <c>EOI</c> at the end.
/// </summary>
internal static class NoteImageInspector
{
    public const string Png = "image/png";
    public const string Jpeg = "image/jpeg";

    /// <summary>Largest width or height accepted, in pixels (8,000 x 8,000 stops at about 64 megapixels).</summary>
    public const int MaxPixels = 8000;

    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    public static NoteImageInfo Inspect(ReadOnlySpan<byte> bytes)
    {
        if (bytes.StartsWith(PngSignature))
            return Check(Png, InspectPng(bytes, out var pw, out var ph), pw, ph);
        if (bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF)
            return Check(Jpeg, InspectJpeg(bytes, out var jw, out var jh), jw, jh);

        return new NoteImageInfo(NoteImageProblem.Unsupported, string.Empty, 0, 0);
    }

    private static NoteImageInfo Check(string contentType, NoteImageProblem problem, int width, int height)
    {
        if (problem != NoteImageProblem.None)
            return new NoteImageInfo(problem, contentType, 0, 0);
        if (width < 1 || height < 1)
            return new NoteImageInfo(NoteImageProblem.Corrupt, contentType, 0, 0);
        if (width > MaxPixels || height > MaxPixels)
            return new NoteImageInfo(NoteImageProblem.TooManyPixels, contentType, width, height);

        return new NoteImageInfo(NoteImageProblem.None, contentType, width, height);
    }

    private static NoteImageProblem InspectPng(ReadOnlySpan<byte> bytes, out int width, out int height)
    {
        width = height = 0;
        var pos = PngSignature.Length;
        var first = true;
        var sawData = false;
        while (true)
        {
            if (bytes.Length - pos < 12)
                return NoteImageProblem.Corrupt;

            var length = BinaryPrimitives.ReadUInt32BigEndian(bytes[pos..]);
            if (length > int.MaxValue || length > (uint)(bytes.Length - pos - 12))
                return NoteImageProblem.Corrupt;

            var type = bytes.Slice(pos + 4, 4);
            var data = bytes.Slice(pos + 8, (int)length);
            var crc = BinaryPrimitives.ReadUInt32BigEndian(bytes[(pos + 8 + (int)length)..]);
            if (Crc32(bytes.Slice(pos + 4, 4 + (int)length)) != crc)
                return NoteImageProblem.Corrupt;

            if (first)
            {
                if (!type.SequenceEqual("IHDR"u8) || length != 13)
                    return NoteImageProblem.Corrupt;

                var w = BinaryPrimitives.ReadUInt32BigEndian(data);
                var h = BinaryPrimitives.ReadUInt32BigEndian(data[4..]);
                if (w == 0 || h == 0 || w > int.MaxValue || h > int.MaxValue)
                    return NoteImageProblem.Corrupt;
                if (!ValidColourFormat(data[8], data[9]) || data[10] != 0 || data[11] != 0 || data[12] > 1)
                    return NoteImageProblem.Corrupt;

                width = (int)w;
                height = (int)h;
                first = false;
            }
            else if (type.SequenceEqual("acTL"u8) || type.SequenceEqual("fcTL"u8) || type.SequenceEqual("fdAT"u8))
            {
                return NoteImageProblem.Unsupported; // an animated PNG
            }
            else if (type.SequenceEqual("IDAT"u8))
            {
                sawData = true;
            }
            else if (type.SequenceEqual("IEND"u8))
            {
                return length == 0 && sawData && pos + 12 == bytes.Length ? NoteImageProblem.None : NoteImageProblem.Corrupt;
            }

            pos += 12 + (int)length;
        }
    }

    private static bool ValidColourFormat(byte bitDepth, byte colourType) => colourType switch
    {
        0 => bitDepth is 1 or 2 or 4 or 8 or 16,
        2 or 4 or 6 => bitDepth is 8 or 16,
        3 => bitDepth is 1 or 2 or 4 or 8,
        _ => false,
    };

    private static NoteImageProblem InspectJpeg(ReadOnlySpan<byte> bytes, out int width, out int height)
    {
        width = height = 0;
        var end = bytes.Length;
        while (end > 0 && bytes[end - 1] == 0)
            end--; // padding after the end marker is harmless
        if (end < 4 || bytes[end - 2] != 0xFF || bytes[end - 1] != 0xD9)
            return NoteImageProblem.Corrupt;

        var pos = 2;
        var sawFrame = false;
        while (pos < end)
        {
            if (bytes[pos] != 0xFF)
                return NoteImageProblem.Corrupt;
            while (pos < end && bytes[pos] == 0xFF)
                pos++; // fill bytes
            if (pos >= end)
                return NoteImageProblem.Corrupt;

            var marker = bytes[pos++];
            if (marker is 0x01 or (>= 0xD0 and <= 0xD7))
                continue; // no length
            if (marker == 0xD9)
                return sawFrame ? NoteImageProblem.None : NoteImageProblem.Corrupt;
            if (marker == 0xD8 || marker == 0x00)
                return NoteImageProblem.Corrupt;
            if (end - pos < 2)
                return NoteImageProblem.Corrupt;

            var length = BinaryPrimitives.ReadUInt16BigEndian(bytes[pos..]);
            if (length < 2 || pos + length > end)
                return NoteImageProblem.Corrupt;

            var segment = bytes.Slice(pos + 2, length - 2);
            if (marker is 0xC0 or 0xC1 or 0xC2)
            {
                if (sawFrame || segment.Length < 6)
                    return NoteImageProblem.Corrupt;

                var components = segment[5];
                if (segment[0] != 8 || components is not (1 or 3))
                    return NoteImageProblem.Unsupported; // 12-bit samples, CMYK
                if (segment.Length < 6 + (3 * components))
                    return NoteImageProblem.Corrupt;

                height = BinaryPrimitives.ReadUInt16BigEndian(segment[1..]);
                width = BinaryPrimitives.ReadUInt16BigEndian(segment[3..]);
                sawFrame = true;
            }
            else if (marker is 0xC3 or (>= 0xC5 and <= 0xC7) or (>= 0xC9 and <= 0xCB) or (>= 0xCD and <= 0xCF))
            {
                return NoteImageProblem.Unsupported; // lossless, hierarchical or arithmetic coding
            }
            else if (marker == 0xDA)
            {
                // The scan: entropy-coded data follows up to the end marker (checked above); the headers were all read.
                return sawFrame ? NoteImageProblem.None : NoteImageProblem.Corrupt;
            }

            pos += length;
        }

        return NoteImageProblem.Corrupt;
    }

    private static readonly uint[] CrcTable = BuildCrcTable();

    private static uint[] BuildCrcTable()
    {
        var table = new uint[256];
        for (uint n = 0; n < 256; n++)
        {
            var c = n;
            for (var k = 0; k < 8; k++)
                c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            table[n] = c;
        }

        return table;
    }

    private static uint Crc32(ReadOnlySpan<byte> bytes)
    {
        var c = 0xFFFFFFFFu;
        foreach (var b in bytes)
            c = CrcTable[(c ^ b) & 0xFF] ^ (c >> 8);
        return c ^ 0xFFFFFFFFu;
    }
}
