using System.Buffers.Binary;
using LptHub.Notes.Application;
using LptHub.Notes.Infrastructure;
using Shouldly;

namespace LptHub.UnitTests.Notes;

/// <summary>The server's own look at an upload (epic #1405, issue #1409): the type is found by the bytes, the size is read from the header, anything else is refused. No image library.</summary>
public sealed class NoteImageInspectorTests
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
        var typed = System.Text.Encoding.ASCII.GetBytes(type).Concat(data).ToArray();
        var bytes = new byte[12 + data.Length];
        BinaryPrimitives.WriteUInt32BigEndian(bytes, (uint)data.Length);
        typed.CopyTo(bytes, 4);
        BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(8 + data.Length), Crc(typed));
        return bytes;
    }

    /// <summary>A real, tiny, decodable PNG (not just a header): width x height pixels is claimed by IHDR; the data is a valid zlib stream of one empty scanline only when the size is 1 x 1.</summary>
    internal static byte[] Png(int width = 1, int height = 1, byte colour = 2, byte depth = 8, bool animated = false, bool badCrc = false, bool trailing = false)
    {
        var ihdr = new byte[13];
        BinaryPrimitives.WriteUInt32BigEndian(ihdr, (uint)width);
        BinaryPrimitives.WriteUInt32BigEndian(ihdr.AsSpan(4), (uint)height);
        ihdr[8] = depth;
        ihdr[9] = colour;
        var idat = new byte[] { 0x78, 0x9C, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01 };
        var parts = new List<byte[]> { new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }, Chunk("IHDR", ihdr) };
        if (animated)
            parts.Add(Chunk("acTL", new byte[8]));
        parts.Add(Chunk("IDAT", idat));
        parts.Add(Chunk("IEND", []));
        var bytes = parts.SelectMany(p => p).ToArray();
        if (badCrc)
            bytes[^1] ^= 0xFF;
        return trailing ? [.. bytes, 0x00, 0x01] : bytes;
    }

    internal static byte[] Jpeg(int width = 1, int height = 1, byte precision = 8, byte components = 3, byte sof = 0xC0, bool eoi = true)
    {
        var sofData = new List<byte> { precision, (byte)(height >> 8), (byte)height, (byte)(width >> 8), (byte)width, components };
        for (var i = 0; i < components; i++)
            sofData.AddRange([(byte)(i + 1), 0x11, 0x00]);
        var bytes = new List<byte> { 0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, (byte)'J', (byte)'F', (byte)'I', (byte)'F', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0 };
        bytes.AddRange([0xFF, sof, (byte)((sofData.Count + 2) >> 8), (byte)(sofData.Count + 2)]);
        bytes.AddRange(sofData);
        bytes.AddRange([0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x7F, 0xFF, 0x00, 0x12]);
        if (eoi)
            bytes.AddRange([0xFF, 0xD9]);
        return [.. bytes];
    }

    [Theory]
    [InlineData(1, 1)]
    [InlineData(1600, 900)]
    [InlineData(8000, 8000)]
    public void A_PNG_is_recognised_by_its_bytes_and_measured(int width, int height)
    {
        var info = NoteImageInspector.Inspect(Png(width, height));

        info.IsValid.ShouldBeTrue();
        (info.ContentType, info.Width, info.Height).ShouldBe(("image/png", width, height));
    }

    [Theory]
    [InlineData(1, 1)]
    [InlineData(1600, 1200)]
    [InlineData(8000, 8000)]
    public void A_JPEG_is_recognised_by_its_bytes_and_measured(int width, int height)
    {
        var info = NoteImageInspector.Inspect(Jpeg(width, height));

        info.IsValid.ShouldBeTrue();
        (info.ContentType, info.Width, info.Height).ShouldBe(("image/jpeg", width, height));
        NoteImageInspector.Inspect(Jpeg(sof: 0xC2)).IsValid.ShouldBeTrue(); // progressive
        NoteImageInspector.Inspect(Jpeg(components: 1)).IsValid.ShouldBeTrue(); // grey
        NoteImageInspector.Inspect([.. Jpeg(), 0, 0, 0]).IsValid.ShouldBeTrue(); // padding after the end marker
    }

    [Fact]
    public void More_than_8000_pixels_on_a_side_is_too_many()
    {
        NoteImageInspector.Inspect(Png(8001, 10)).Problem.ShouldBe(NoteImageProblem.TooManyPixels);
        NoteImageInspector.Inspect(Png(10, 8001)).Problem.ShouldBe(NoteImageProblem.TooManyPixels);
        NoteImageInspector.Inspect(Jpeg(8001, 10)).Problem.ShouldBe(NoteImageProblem.TooManyPixels);
    }

    public static TheoryData<string, byte[]> Foreign() => new()
    {
        { "svg", System.Text.Encoding.UTF8.GetBytes("<svg xmlns=\"http://www.w3.org/2000/svg\" onload=\"alert(1)\"/>") },
        { "gif", System.Text.Encoding.ASCII.GetBytes("GIF89a\u0001\0\u0001\0\0\0\0;") },
        { "webp", [.. System.Text.Encoding.ASCII.GetBytes("RIFF\0\0\0\0WEBPVP8 "), .. new byte[20]] },
        { "bmp", [.. System.Text.Encoding.ASCII.GetBytes("BM"), .. new byte[60]] },
        { "html", System.Text.Encoding.UTF8.GetBytes("<html><script>alert(1)</script></html>") },
        { "text", System.Text.Encoding.UTF8.GetBytes("hello") },
        { "pdf", System.Text.Encoding.ASCII.GetBytes("%PDF-1.7 ...") },
        { "exe", [0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00] },
        { "empty", [] },
        { "animated png", Png(animated: true) },
        { "jpeg with arithmetic coding", Jpeg(sof: 0xC9) },
        { "jpeg lossless", Jpeg(sof: 0xC3) },
        { "cmyk jpeg", Jpeg(components: 4) },
        { "12 bit jpeg", Jpeg(precision: 12) },
    };

    [Theory]
    [MemberData(nameof(Foreign))]
    public void Anything_that_is_not_a_plain_PNG_or_JPEG_is_unsupported(string name, byte[] bytes) =>
        NoteImageInspector.Inspect(bytes).Problem.ShouldBe(NoteImageProblem.Unsupported, name);

    public static TheoryData<string, byte[]> Damaged() => new()
    {
        { "png header only", Png()[..8] },
        { "png truncated", Png()[..40] },
        { "png without IEND", Png()[..^12] },
        { "png bad crc", Png(badCrc: true) },
        { "png trailing data", Png(trailing: true) },
        { "png zero size", Png(0, 1) },
        { "png bad colour format", Png(colour: 3, depth: 16) },
        { "png wrong colour type", Png(colour: 5) },
        { "jpeg only the start", [0xFF, 0xD8, 0xFF] },
        { "jpeg without end marker", Jpeg(eoi: false) },
        { "jpeg zero height", Jpeg(10, 0) },
        { "jpeg segment longer than the file", [0xFF, 0xD8, 0xFF, 0xE0, 0xFF, 0xF0, 0, 0, 0xFF, 0xD9] },
        { "jpeg no frame header", [0xFF, 0xD8, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0xFF, 0xD9] },
    };

    [Theory]
    [MemberData(nameof(Damaged))]
    public void A_file_that_starts_like_one_but_is_damaged_is_corrupt(string name, byte[] bytes) =>
        NoteImageInspector.Inspect(bytes).Problem.ShouldBe(NoteImageProblem.Corrupt, name);

    [Fact]
    public void The_nightly_sweep_runs_at_02_20_UTC()
    {
        NoteImageSweeper.DelayUntilNextRun(new DateTime(2026, 11, 18, 1, 0, 0, DateTimeKind.Utc)).ShouldBe(TimeSpan.FromMinutes(80));
        NoteImageSweeper.DelayUntilNextRun(new DateTime(2026, 11, 18, 2, 20, 0, DateTimeKind.Utc)).ShouldBe(TimeSpan.FromHours(24));
        NoteImageSweeper.DelayUntilNextRun(new DateTime(2026, 11, 18, 23, 20, 0, DateTimeKind.Utc)).ShouldBe(TimeSpan.FromHours(3));
    }
}
