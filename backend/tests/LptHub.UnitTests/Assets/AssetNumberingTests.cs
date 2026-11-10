using System.Text.Json;
using LptHub.Assets.Domain;
using Shouldly;

namespace LptHub.UnitTests.Assets;

/// <summary>The Asset Number tail rules (issue #1297): the shared vectors of contracts/asset-numbering/pattern-vectors.json plus the rendering edge cases.</summary>
public class AssetNumberingTests
{
    public static TheoryData<string> VectorNames()
    {
        var data = new TheoryData<string>();
        foreach (var vector in Vectors().EnumerateArray())
            data.Add(vector.GetProperty("name").GetString()!);
        return data;
    }

    private static JsonElement Vectors() =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Assets", "pattern-vectors.json"))).RootElement.GetProperty("vectors");

    [Theory]
    [MemberData(nameof(VectorNames))]
    public void The_shared_vector_gives_the_expected_number_or_error(string name)
    {
        var vector = Vectors().EnumerateArray().Single(v => v.GetProperty("name").GetString() == name);
        var tail = vector.GetProperty("tail").GetString()!;
        var parsed = AssetNumbering.Parse(tail);

        if (vector.TryGetProperty("expectedError", out var error))
        {
            parsed.IsValid.ShouldBeFalse();
            parsed.Code.ShouldBe(error.GetString());
            parsed.Message.ShouldNotBeNullOrWhiteSpace();
        }
        else
        {
            parsed.IsValid.ShouldBeTrue(parsed.Message);
            parsed.Pattern!.Render(vector.GetProperty("cmNumber").GetString()!, vector.GetProperty("counter").GetInt32()).ShouldBe(vector.GetProperty("expected").GetString());
        }
    }

    [Fact]
    public void The_vectors_cover_every_error_code()
    {
        var codes = Vectors().EnumerateArray().Where(v => v.TryGetProperty("expectedError", out _)).Select(v => v.GetProperty("expectedError").GetString()).ToHashSet();
        codes.ShouldBe(
            [AssetNumbering.NoCounter, AssetNumbering.TwoCounters, AssetNumbering.UnknownToken, AssetNumbering.ForbiddenChar, AssetNumbering.EdgeSpace, AssetNumbering.TrailingDot, AssetNumbering.TooLong, AssetNumbering.CounterWidth],
            ignoreOrder: true);
    }

    [Fact]
    public void A_tail_ending_with_a_dot_is_refused_with_its_own_code_and_message()
    {
        var parsed = AssetNumbering.Parse("_{###}.");
        parsed.Code.ShouldBe("PATTERN_TRAILING_DOT");
        parsed.Message.ShouldBe("The pattern cannot end with a dot: a folder name cannot end with a dot.");
        AssetNumbering.Parse(".{###}").IsValid.ShouldBeTrue();
    }

    [Fact]
    public void The_default_tail_is_valid_and_numbers_media_like_the_issue()
    {
        var parsed = AssetNumbering.Parse(AssetNumbering.DefaultPattern);
        parsed.IsValid.ShouldBeTrue();
        parsed.Pattern!.Width.ShouldBe(3);
        parsed.Pattern.Render("90003-80008", 1).ShouldBe("90003-80008_001");
        parsed.Pattern.Render("90003-80008", 2).ShouldBe("90003-80008_002");
    }

    [Theory]
    [InlineData(999, "_999")]
    [InlineData(1000, "_1000")]
    [InlineData(1_000_000, "_1000000")]
    [InlineData(999_999_999, "_999999999")]
    public void The_counter_widens_past_its_width_and_never_fails(int counter, string tail) =>
        AssetNumbering.Parse("_{###}").Pattern!.Render("00343-00012", counter).ShouldBe("00343-00012" + tail);

    [Theory]
    [InlineData("")]
    [InlineData(" 90003-80008")]
    [InlineData("90003-80008 ")]
    [InlineData("90003/80008")]
    [InlineData("90003-8000|")]
    [InlineData("90003-8000\n")]
    public void Rendering_refuses_a_cm_number_that_is_not_a_safe_folder_name(string cm) =>
        Should.Throw<ArgumentException>(() => AssetNumbering.Parse("_{###}").Pattern!.Render(cm, 1));

    [Fact]
    public void Rendering_refuses_a_counter_below_one() =>
        Should.Throw<ArgumentOutOfRangeException>(() => AssetNumbering.Parse("_{###}").Pattern!.Render("90003-80008", 0));

    [Fact]
    public void The_longest_valid_tail_with_the_widest_counter_stays_inside_the_column()
    {
        var parsed = AssetNumbering.Parse("_" + new string('x', 38) + "{#########}");
        parsed.IsValid.ShouldBeTrue(parsed.Message);
        parsed.Pattern!.Render("123456-123444", AssetNumbering.MaxNextNumber).Length.ShouldBeLessThanOrEqualTo(AssetNumbering.MaxNumberLength);
    }

    [Fact]
    public void Text_that_looks_like_sql_is_only_ever_literal_text()
    {
        var parsed = AssetNumbering.Parse("_';DROP TABLE dbo.Asset--_{###}");
        parsed.IsValid.ShouldBeTrue();
        parsed.Pattern!.Render("90003-80008", 1).ShouldBe("90003-80008_';DROP TABLE dbo.Asset--_001");
    }

    [Fact]
    public void Scope_names_are_matter_only_for_now()
    {
        AssetNumbering.IsMatterScopeName("matter").ShouldBeTrue();
        AssetNumbering.IsMatterScopeName("CLIENT").ShouldBeFalse();
        AssetNumbering.ScopeName(AssetNumbering.ScopeMatter).ShouldBe("MATTER");
        AssetNumbering.ScopeName(2).ShouldBeNull();
    }
}
