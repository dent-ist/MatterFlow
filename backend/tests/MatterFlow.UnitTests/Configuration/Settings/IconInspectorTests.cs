using System.Buffers.Binary;
using System.Text;
using MatterFlow.Configuration.Domain.Settings;
using MatterFlow.SharedKernel.Results;
using Shouldly;

namespace MatterFlow.UnitTests.Configuration.Settings;

public class IconInspectorTests
{
    internal static byte[] Png(uint width, uint height, bool withEnd = true, int extraDataBytes = 0)
    {
        var bytes = new List<byte> { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
        void Chunk(string type, byte[] data)
        {
            var len = new byte[4];
            BinaryPrimitives.WriteUInt32BigEndian(len, (uint)data.Length);
            bytes.AddRange(len);
            bytes.AddRange(Encoding.ASCII.GetBytes(type));
            bytes.AddRange(data);
            bytes.AddRange(new byte[4]); // CRC is not checked
        }

        var ihdr = new byte[13];
        BinaryPrimitives.WriteUInt32BigEndian(ihdr.AsSpan(0), width);
        BinaryPrimitives.WriteUInt32BigEndian(ihdr.AsSpan(4), height);
        ihdr[8] = 8;
        ihdr[9] = 6;
        Chunk("IHDR", ihdr);
        Chunk("IDAT", new byte[10 + extraDataBytes]);
        if (withEnd)
            Chunk("IEND", []);
        return [.. bytes];
    }

    internal static byte[] Ico(params (int W, int H, uint Size, uint Offset)[] entries)
    {
        var bytes = new List<byte> { 0, 0, 1, 0, (byte)entries.Length, 0 };
        foreach (var e in entries)
        {
            bytes.Add((byte)(e.W == 256 ? 0 : e.W));
            bytes.Add((byte)(e.H == 256 ? 0 : e.H));
            bytes.AddRange(new byte[] { 0, 0, 1, 0, 32, 0 });
            bytes.AddRange(BitConverter.GetBytes(e.Size));
            bytes.AddRange(BitConverter.GetBytes(e.Offset));
        }

        var dataStart = bytes.Count;
        var end = entries.Length == 0 ? dataStart : entries.Max(e => (int)(e.Offset + e.Size));
        bytes.AddRange(new byte[Math.Max(0, end - dataStart)]);
        return [.. bytes];
    }

    [Theory]
    [InlineData(64u)]
    [InlineData(256u)]
    [InlineData(1024u)]
    public void A_square_png_in_range_passes(uint size)
    {
        var info = IconInspector.Inspect(Png(size, size)).Value;
        info.Kind.ShouldBe(IconKind.Png);
        info.ContentType.ShouldBe("image/png");
        info.Width.ShouldBe((int)size);
        info.KindCode.ShouldBe("png");
    }

    [Fact]
    public void A_png_that_is_not_square_is_refused() =>
        IconInspector.Inspect(Png(128, 64)).Error!.Code.ShouldBe(ErrorCodes.BrandingIconNotSquare);

    [Fact]
    public void A_png_smaller_than_64_is_refused() =>
        IconInspector.Inspect(Png(48, 48)).Error!.Code.ShouldBe(ErrorCodes.BrandingIconTooSmall);

    [Fact]
    public void A_png_larger_than_1024_is_refused() =>
        IconInspector.Inspect(Png(2048, 2048)).Error!.Code.ShouldBe(ErrorCodes.BrandingIconTooLarge);

    [Fact]
    public void A_bomb_like_png_header_is_refused_without_decoding() =>
        IconInspector.Inspect(Png(uint.MaxValue, uint.MaxValue)).Error!.Code.ShouldBe(ErrorCodes.BrandingIconCorrupt);

    [Fact]
    public void A_png_with_zero_size_is_corrupt() =>
        IconInspector.Inspect(Png(0, 0)).Error!.Code.ShouldBe(ErrorCodes.BrandingIconCorrupt);

    [Fact]
    public void A_png_without_iend_is_corrupt_as_a_truncated_upload() =>
        IconInspector.Inspect(Png(64, 64, withEnd: false)).Error!.Code.ShouldBe(ErrorCodes.BrandingIconCorrupt);

    [Fact]
    public void A_png_cut_in_the_middle_of_a_chunk_is_corrupt()
    {
        var full = Png(64, 64);
        IconInspector.Inspect(full.AsSpan(0, full.Length - 20)).Error!.Code.ShouldBe(ErrorCodes.BrandingIconCorrupt);
    }

    [Fact]
    public void A_png_with_only_a_signature_is_corrupt() =>
        IconInspector.Inspect(Png(64, 64).AsSpan(0, 12)).Error!.Code.ShouldBe(ErrorCodes.BrandingIconCorrupt);

    [Fact]
    public void A_png_chunk_longer_than_the_file_is_corrupt()
    {
        var bytes = Png(64, 64);
        BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(33), 0x7FFFFFFF); // IDAT length
        IconInspector.Inspect(bytes).Error!.Code.ShouldBe(ErrorCodes.BrandingIconCorrupt);
    }

    [Fact]
    public void A_file_over_256_KB_is_refused_before_anything_else()
    {
        var big = Png(64, 64, extraDataBytes: IconInspector.MaxBytes);
        IconInspector.Inspect(big).Error!.Code.ShouldBe(ErrorCodes.BrandingIconTooLarge);
        IconInspector.Inspect(new byte[IconInspector.MaxBytes + 1]).Error!.Code.ShouldBe(ErrorCodes.BrandingIconTooLarge);
    }

    [Fact]
    public void A_png_exactly_at_the_limit_is_not_refused_for_size() =>
        IconInspector.Inspect(Png(64, 64, extraDataBytes: IconInspector.MaxBytes - Png(64, 64).Length)).IsSuccess.ShouldBeTrue();

    [Fact]
    public void An_ico_uses_its_largest_image()
    {
        var bytes = Ico((16, 16, 100, 54), (32, 32, 100, 154), (128, 128, 100, 254));
        var info = IconInspector.Inspect(bytes).Value;
        info.Kind.ShouldBe(IconKind.Ico);
        info.ContentType.ShouldBe("image/x-icon");
        info.Width.ShouldBe(128);
    }

    [Fact]
    public void An_ico_with_a_256_pixel_entry_encoded_as_zero_passes() =>
        IconInspector.Inspect(Ico((256, 256, 50, 22))).Value.Width.ShouldBe(256);

    [Fact]
    public void An_ico_whose_largest_image_is_small_is_refused() =>
        IconInspector.Inspect(Ico((16, 16, 50, 54), (32, 32, 50, 104), (48, 48, 50, 154))).Error!.Code.ShouldBe(ErrorCodes.BrandingIconTooSmall);

    [Fact]
    public void An_ico_whose_largest_image_is_not_square_is_refused() =>
        IconInspector.Inspect(Ico((128, 64, 50, 22))).Error!.Code.ShouldBe(ErrorCodes.BrandingIconNotSquare);

    [Fact]
    public void An_ico_with_zero_images_is_corrupt() =>
        IconInspector.Inspect(Ico()).Error!.Code.ShouldBe(ErrorCodes.BrandingIconCorrupt);

    [Fact]
    public void An_ico_whose_directory_is_cut_off_is_corrupt() =>
        IconInspector.Inspect(Ico((64, 64, 50, 22)).AsSpan(0, 12)).Error!.Code.ShouldBe(ErrorCodes.BrandingIconCorrupt);

    [Fact]
    public void An_ico_whose_data_range_is_outside_the_file_is_corrupt()
    {
        var bytes = Ico((64, 64, 50, 22));
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(6 + 8), 5000); // size
        IconInspector.Inspect(bytes).Error!.Code.ShouldBe(ErrorCodes.BrandingIconCorrupt);
    }

    [Fact]
    public void An_ico_whose_data_starts_inside_the_directory_is_corrupt() =>
        IconInspector.Inspect(Ico((64, 64, 50, 4))).Error!.Code.ShouldBe(ErrorCodes.BrandingIconCorrupt);

    [Fact]
    public void An_ico_entry_with_size_zero_is_corrupt() =>
        IconInspector.Inspect(Ico((64, 64, 0, 22))).Error!.Code.ShouldBe(ErrorCodes.BrandingIconCorrupt);

    [Fact]
    public void A_cursor_file_is_not_an_icon() =>
        IconInspector.Inspect(new byte[] { 0, 0, 2, 0, 1, 0, 0, 0 }).Error!.Code.ShouldBe(ErrorCodes.BrandingIconTypeUnsupported);

    [Theory]
    [InlineData(new byte[] { 0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46 })] // JPEG
    [InlineData(new byte[] { 0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0 })] // GIF
    [InlineData(new byte[] { 0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50 })] // WebP
    [InlineData(new byte[] { 0x25, 0x50, 0x44, 0x46, 0x2D, 0x31 })] // PDF
    [InlineData(new byte[] { })]
    [InlineData(new byte[] { 0 })]
    public void Other_formats_and_empty_files_are_unsupported(byte[] bytes) =>
        IconInspector.Inspect(bytes).Error!.Code.ShouldBe(ErrorCodes.BrandingIconTypeUnsupported);

    [Fact]
    public void An_html_page_is_unsupported_even_when_named_svg() =>
        IconInspector.Inspect("<html><body>hi</body></html>"u8).Error!.Code.ShouldBe(ErrorCodes.BrandingIconTypeUnsupported);

    [Fact]
    public void A_png_renamed_svg_is_decided_by_content()
    {
        // The inspector never sees a file name: the PNG signature wins, whatever the client called the file.
        IconInspector.Inspect(Png(64, 64)).Value.Kind.ShouldBe(IconKind.Png);
    }

    [Fact]
    public void Plain_text_is_unsupported() =>
        IconInspector.Inspect("hello world"u8).Error!.Code.ShouldBe(ErrorCodes.BrandingIconTypeUnsupported);

    [Fact]
    public void Every_rejection_is_a_validation_error_on_the_file_field()
    {
        var error = IconInspector.Inspect(Png(10, 10)).Error!;
        error.Type.ShouldBe(ErrorType.Validation);
        error.FieldErrors!["file"][0].Code.ShouldBe(error.Code);
    }
}
