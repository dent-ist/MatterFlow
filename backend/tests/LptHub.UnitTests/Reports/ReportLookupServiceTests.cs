using LptHub.Reports.Application;
using LptHub.Reports.Domain.Parameters;
using LptHub.Reports.Infrastructure;
using LptHub.SharedKernel.Identity;
using Shouldly;

namespace LptHub.UnitTests.Reports;

/// <summary>The rules of the reports-owned lookup (owner decision 13): only a lookup parameter of a runnable report, a small page, and the text is only ever a value.</summary>
public class ReportLookupServiceTests
{
    private sealed class FakeUser(int? id) : ICurrentUser
    {
        public int? UserId => id;

        public bool IsAuthenticated => id is not null;
    }

    private sealed class FakeCatalog(string parametersJson, bool runnable = true) : IReportCatalog
    {
        public Task<RunnableReport?> FindRunnableAsync(int reportId, int userId, CancellationToken cancellationToken) =>
            Task.FromResult<RunnableReport?>(runnable ? new RunnableReport(reportId, "R", 1, 1, "SELECT 1 AS one", [], parametersJson, null, null) : null);

        public Task<RunnableDetail?> FindRunnableDetailAsync(int reportId, int userId, CancellationToken cancellationToken) => Task.FromResult<RunnableDetail?>(null);

        public Task<IReadOnlyList<RunnableListItem>> ListRunnableAsync(int userId, CancellationToken cancellationToken) => Task.FromResult<IReadOnlyList<RunnableListItem>>([]);
    }

    private sealed class RecordingStore : IReportLookupStore
    {
        public (LookupKind Kind, string? Text, int Take)? Search { get; private set; }

        public (LookupKind Kind, int[] Ids)? Resolve { get; private set; }

        public Task<IReadOnlyList<ReportLookupItem>> SearchAsync(LookupKind kind, string? text, int take, CancellationToken cancellationToken)
        {
            Search = (kind, text, take);
            return Task.FromResult<IReadOnlyList<ReportLookupItem>>([new ReportLookupItem(1, "One")]);
        }

        public Task<IReadOnlyList<ReportLookupItem>> ResolveAsync(LookupKind kind, IReadOnlyCollection<int> ids, CancellationToken cancellationToken)
        {
            Resolve = (kind, [.. ids]);
            return Task.FromResult<IReadOnlyList<ReportLookupItem>>([]);
        }
    }

    private const string Parameters = """[{"name":"M","type":"lookup","label":"Matter","lookupKind":"matter"},{"name":"D","type":"date","label":"Date"},{"name":"K","type":"single","label":"Kind","optionsKind":"fixed","options":[{"value":"a","label":"A"}]}]""";

    private static (ReportLookupService Service, RecordingStore Store) Make(int? user = 5, string parameters = Parameters, bool runnable = true)
    {
        var store = new RecordingStore();
        return (new ReportLookupService(new FakeUser(user), new FakeCatalog(parameters, runnable), store), store);
    }

    [Fact]
    public async Task A_lookup_parameter_is_searched_with_the_kind_of_the_definition_not_of_the_caller()
    {
        var (service, store) = Make();

        var result = await service.GetAsync(1, " m ", "  acme ", 10, null, CancellationToken.None);

        result.Problem.ShouldBeNull();
        store.Search.ShouldBe((LookupKind.Matter, "acme", 10));
    }

    [Theory]
    [InlineData(null, 25)]
    [InlineData(0, 1)]
    [InlineData(-5, 1)]
    [InlineData(50, 50)]
    [InlineData(51, 50)]
    [InlineData(100000, 50)]
    public async Task The_page_is_at_most_fifty_and_at_least_one(int? take, int expected)
    {
        var (service, store) = Make();

        await service.GetAsync(1, "M", null, take, null, CancellationToken.None);

        store.Search!.Value.Take.ShouldBe(expected);
    }

    [Theory]
    [InlineData("D")]
    [InlineData("K")]
    [InlineData("MISSING")]
    [InlineData("CURRENT_USER_ID")]
    [InlineData("")]
    public async Task Anything_but_a_lookup_parameter_of_the_report_is_not_found_with_one_message(string name)
    {
        var (service, store) = Make();

        var result = await service.GetAsync(1, name, null, null, null, CancellationToken.None);

        result.Problem!.Status.ShouldBe(404);
        result.Problem.Message.ShouldBe(ReportLookupService.NoSuchLookupMessage);
        store.Search.ShouldBeNull();
        store.Resolve.ShouldBeNull();
    }

    [Fact]
    public async Task A_report_the_person_may_not_run_and_a_missing_sign_in_never_reach_the_store()
    {
        var (service, store) = Make(runnable: false);
        (await service.GetAsync(1, "M", null, null, null, CancellationToken.None)).Problem!.Status.ShouldBe(404);

        var (anonymous, store2) = Make(user: null);
        (await anonymous.GetAsync(1, "M", null, null, null, CancellationToken.None)).Problem!.Status.ShouldBe(401);

        store.Search.ShouldBeNull();
        store2.Search.ShouldBeNull();
    }

    [Fact]
    public async Task Ids_resolve_instead_of_search_are_distinct_and_limited()
    {
        var (service, store) = Make();

        await service.GetAsync(1, "M", "ignored", 5, [3, 3, 4], CancellationToken.None);

        store.Resolve!.Value.Kind.ShouldBe(LookupKind.Matter);
        store.Resolve!.Value.Ids.ShouldBe([3, 4]);
        store.Search.ShouldBeNull();
        (await service.GetAsync(1, "M", null, null, [.. Enumerable.Range(1, ReportLookupService.MaxIds + 1)], CancellationToken.None)).Problem!.Status.ShouldBe(400);
        (await service.GetAsync(1, "M", new string('x', ReportLookupService.MaxSearchLength + 1), null, null, CancellationToken.None)).Problem!.Status.ShouldBe(400);
    }

    [Theory]
    [InlineData(@"KE\sam", "sam")]
    [InlineData(@"sam", "sam")]
    [InlineData(@"KE\", @"KE\")]
    [InlineData("Dana Smith", "Dana Smith")]
    public void A_user_label_has_no_domain(string stored, string shown) => ReportLookupStore.WithoutDomain(stored).ShouldBe(shown);

    [Theory]
    [InlineData("100%", @"100\%")]
    [InlineData("a_b", @"a\_b")]
    [InlineData("[x]", @"\[x]")]
    [InlineData(@"a\b", @"a\\b")]
    public void The_search_text_is_escaped_so_it_is_a_literal(string text, string escaped) => ReportLookupStore.EscapeLike(text).ShouldBe(escaped);
}
