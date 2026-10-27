using System.Buffers.Binary;
using MatterFlow.SharedKernel.Results;

namespace MatterFlow.Configuration.Domain.Settings;

/// <summary>The kinds of application icon that are accepted.</summary>
public enum IconKind
{
    Png,
    Ico,
    Svg,
}

/// <summary>What the inspector found. <paramref name="Width"/> and <paramref name="Height"/> are pixels; 0 for an SVG (a vector has no pixel size).</summary>
public sealed record IconInfo(IconKind Kind, string ContentType, int Width, int Height)
{
    /// <summary>Short code used by the public branding endpoint (<c>png</c>, <c>ico</c>, <c>svg</c>).</summary>
    public string KindCode => Kind switch { IconKind.Png => "png", IconKind.Ico => "ico", _ => "svg" };
}

/// <summary>
/// Decides what an uploaded icon is by its content (magic bytes), never by file name or the client's content type, and checks size and shape
/// without an image library (design section 6.2). Nothing is decoded or re-encoded: PNG sizes come from the IHDR chunk, ICO sizes from the
/// directory, SVG from <see cref="SvgSafety"/>. Pure function, no I/O.
/// </summary>
public static class IconInspector
{
    public const string Field = "file";

    /// <summary>Largest accepted icon (256 KB).</summary>
    public const int MaxBytes = 262_144;

    /// <summary>The request reader stops here, so an oversized upload is never held in memory (300 KB).</summary>
    public const int HardStopBytes = 307_200;

    public const int MinPixels = 64;

    public const int MaxPngPixels = 1024;

    public const string PngContentType = "image/png";

    public const string IcoContentType = "image/x-icon";

    public const string SvgContentType = "image/svg+xml";

    private static ReadOnlySpan<byte> PngSignature => [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    public static Result<IconInfo> Inspect(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length > MaxBytes)
            return Fail(ErrorCodes.BrandingIconTooLarge, "The icon is larger than 256 KB.");
        if (bytes.StartsWith(PngSignature))
            return InspectPng(bytes);
        if (bytes.Length >= 4 && bytes[0] == 0 && bytes[1] == 0 && bytes[2] == 1 && bytes[3] == 0)
            return InspectIco(bytes);
        if (SvgSafety.LooksLikeXml(bytes))
            return SvgSafety.Inspect(bytes);

        return Fail(ErrorCodes.BrandingIconTypeUnsupported, "Use a PNG, SVG or ICO file.");
    }

    private static Result<IconInfo> InspectPng(ReadOnlySpan<byte> bytes)
    {
        // Signature (8) + IHDR chunk: length 4, type 4, data 13, crc 4.
        if (bytes.Length < 33
            || BinaryPrimitives.ReadUInt32BigEndian(bytes[8..]) != 13
            || !bytes.Slice(12, 4).SequenceEqual("IHDR"u8))
        {
            return Fail(ErrorCodes.BrandingIconCorrupt, "The PNG file is damaged.");
        }

        var width = BinaryPrimitives.ReadUInt32BigEndian(bytes[16..]);
        var height = BinaryPrimitives.ReadUInt32BigEndian(bytes[20..]);
        if (width == 0 || height == 0 || width > int.MaxValue || height > int.MaxValue)
            return Fail(ErrorCodes.BrandingIconCorrupt, "The PNG file is damaged.");

        // Walk the chunks: each must fit in the file and the file must reach IEND (a truncated upload is refused).
        var pos = 8;
        var sawEnd = false;
        while (pos + 12 <= bytes.Length)
        {
            var length = BinaryPrimitives.ReadUInt32BigEndian(bytes[pos..]);
            var isEnd = bytes.Slice(pos + 4, 4).SequenceEqual("IEND"u8);
            if (length > (uint)(bytes.Length - pos - 12))
                return Fail(ErrorCodes.BrandingIconCorrupt, "The PNG file is damaged.");
            pos += 12 + (int)length;
            if (isEnd)
            {
                sawEnd = true;
                break;
            }
        }

        if (!sawEnd)
            return Fail(ErrorCodes.BrandingIconCorrupt, "The PNG file is damaged.");
        if (width != height)
            return Fail(ErrorCodes.BrandingIconNotSquare, "The icon must be square.");
        if (width < MinPixels)
            return Fail(ErrorCodes.BrandingIconTooSmall, "The icon must be at least 64 x 64 pixels.");
        if (width > MaxPngPixels)
            return Fail(ErrorCodes.BrandingIconTooLarge, "The icon can be at most 1024 x 1024 pixels.");

        return new IconInfo(IconKind.Png, PngContentType, (int)width, (int)height);
    }

    private static Result<IconInfo> InspectIco(ReadOnlySpan<byte> bytes)
    {
        const int headerSize = 6;
        const int entrySize = 16;
        var count = bytes.Length >= headerSize ? BinaryPrimitives.ReadUInt16LittleEndian(bytes[4..]) : 0;
        var directoryEnd = headerSize + (count * entrySize);
        if (count == 0 || directoryEnd > bytes.Length)
            return Fail(ErrorCodes.BrandingIconCorrupt, "The ICO file is damaged.");

        var bestWidth = 0;
        var bestHeight = 0;
        for (var i = 0; i < count; i++)
        {
            var entry = bytes.Slice(headerSize + (i * entrySize), entrySize);
            var width = entry[0] == 0 ? 256 : entry[0];
            var height = entry[1] == 0 ? 256 : entry[1];
            var size = BinaryPrimitives.ReadUInt32LittleEndian(entry[8..]);
            var offset = BinaryPrimitives.ReadUInt32LittleEndian(entry[12..]);
            if (size == 0 || offset < directoryEnd || (long)offset + size > bytes.Length)
                return Fail(ErrorCodes.BrandingIconCorrupt, "The ICO file is damaged.");

            if ((width * height) > (bestWidth * bestHeight) || ((width * height) == (bestWidth * bestHeight) && width > bestWidth))
            {
                bestWidth = width;
                bestHeight = height;
            }
        }

        if (bestWidth != bestHeight)
            return Fail(ErrorCodes.BrandingIconNotSquare, "The icon must be square.");
        if (bestWidth < MinPixels)
            return Fail(ErrorCodes.BrandingIconTooSmall, "The largest image in the ICO file must be at least 64 x 64 pixels.");

        return new IconInfo(IconKind.Ico, IcoContentType, bestWidth, bestHeight);
    }

    internal static Error Fail(string code, string message) => Error.Validation(Field, code, message, code);
}
