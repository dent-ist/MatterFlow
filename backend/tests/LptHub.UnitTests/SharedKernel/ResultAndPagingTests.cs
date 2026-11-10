using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using Shouldly;

namespace MatterFlow.UnitTests.SharedKernel;

public class ResultAndPagingTests
{
    [Fact]
    public void Success_exposes_value_and_failure_throws_on_value()
    {
        Result<int> ok = 5;
        Result<int> bad = Error.NotFound("nope");

        ok.IsSuccess.ShouldBeTrue();
        ok.Value.ShouldBe(5);
        bad.IsFailure.ShouldBeTrue();
        bad.Error!.Code.ShouldBe(ErrorCodes.NotFound);
        Should.Throw<InvalidOperationException>(() => bad.Value);
        ok.Map(v => v * 2).Value.ShouldBe(10);
        bad.Map(v => v * 2).Error.ShouldBe(bad.Error);
    }

    [Fact]
    public void Error_codes_are_unique_and_cover_the_architecture_list()
    {
        ErrorCodes.All.Distinct().Count().ShouldBe(ErrorCodes.All.Count);
        ErrorCodes.All.ShouldContain("CONCURRENCY_CONFLICT");
        ErrorCodes.All.ShouldContain("INVALID_NUMBER_FORMAT");
        ErrorCodes.All.ShouldAllBe(c => c == c.ToUpperInvariant() && !c.Contains(' '));
    }

    [Theory]
    [InlineData(null, null, 1, 25)]
    [InlineData(3, 100, 3, 100)]
    public void PageRequest_defaults_and_accepts_valid_values(int? page, int? size, int expectedPage, int expectedSize)
    {
        var r = PageRequest.Create(page, size);

        r.IsSuccess.ShouldBeTrue();
        r.Value.Page.ShouldBe(expectedPage);
        r.Value.PageSize.ShouldBe(expectedSize);
        r.Value.Skip.ShouldBe((expectedPage - 1) * expectedSize);
    }

    [Theory]
    [InlineData(0, 25)]
    [InlineData(1, 0)]
    [InlineData(1, 101)]
    public void PageRequest_rejects_out_of_range_values(int page, int size)
    {
        PageRequest.Create(page, size).Error!.Code.ShouldBe(ErrorCodes.ValidationFailed);
    }

    [Fact]
    public void SortSpec_parses_whitelisted_fields_with_direction()
    {
        var r = SortSpec.Parse("priority,-DueAt, createdAt", ["priority", "dueAt", "createdAt"]);

        r.IsSuccess.ShouldBeTrue();
        r.Value.ShouldBe([new SortField("priority", false), new SortField("dueAt", true), new SortField("createdAt", false)]);
    }

    [Theory]
    [InlineData("bogus")]
    [InlineData("priority,priority")]
    public void SortSpec_rejects_unknown_or_repeated_fields(string sort)
    {
        SortSpec.Parse(sort, ["priority"]).Error!.Code.ShouldBe(ErrorCodes.ValidationFailed);
    }

    [Fact]
    public void Filters_split_comma_lists_and_reject_unknown_keys()
    {
        FilterParsing.SplitList("NEW, IN_PROGRESS,,").ShouldBe(["NEW", "IN_PROGRESS"]);
        FilterParsing.EnsureKnown(["status", "podId"], ["status", "podId"]).IsSuccess.ShouldBeTrue();
        FilterParsing.EnsureKnown(["field.ocr"], ["status"], k => k.StartsWith("field.", StringComparison.Ordinal)).IsSuccess.ShouldBeTrue();
        FilterParsing.EnsureKnown(["nope"], ["status"]).Error!.Code.ShouldBe(ErrorCodes.ValidationFailed);
    }
}
