using MatterFlow.Identity.Contracts;
using MatterFlow.Reports.Application;
using MatterFlow.SharedKernel.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>What a person who may run reports sees: the list (grouping, order, parameter counts from what the SQL uses) and one definition, with no SQL anywhere (issues #718, #719).</summary>
public class ReportBrowseServiceTests
{
    private sealed class FakeUser(int? id) : ICurrentUser
    {
        public int? UserId => id;

        public bool IsAuthenticated => id is not null;
    }

    private sealed class FakeCatalog(RunnableListItem[] items, params RunnableDetail[] details) : IReportCatalog
    {
        public Task<RunnableReport?> FindRunnableAsync(int reportId, int userId, CancellationToken cancellationToken) => Task.FromResult<RunnableReport?>(null);

        public Task<RunnableDetail?> FindRunnableDetailAsync(int reportId, int userId, CancellationToken cancellationToken) => Task.FromResult(details.FirstOrDefault(d => d.ReportId == reportId));

        public Task<IReadOnlyList<RunnableListItem>> ListRunnableAsync(int userId, CancellationToken cancellationToken) => Task.FromResult<IReadOnlyList<RunnableListItem>>(items);
    }

    private sealed class FakePods : IPodDirectory
    {
        public Task<PodInfo?> FindAsync(int podId, CancellationToken cancellationToken = default) => Task.FromResult<PodInfo?>(null);

        public Task<bool> IsAvailableForAssignmentAsync(int podId, CancellationToken cancellationToken = default) => Task.FromResult(false);

        public Task<IReadOnlyList<UserPodInfo>> GetUserPodsAsync(int userId, bool includeInactive = false, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<UserPodInfo>>([]);

        public Task<PodInfo?> GetPrimaryPodAsync(int userId, CancellationToken cancellationToken = default) => Task.FromResult<PodInfo?>(null);

        public Task<IReadOnlyList<int>> GetMemberUserIdsAsync(int podId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<int>>([]);
    }

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private const string TwoParameters =
        """[{"name":"FROM","type":"date","label":"From"},{"name":"MATTER","type":"lookup","label":"Matter","lookupKind":"matter"},{"name":"UNUSED","type":"text","label":"Not in the SQL"}]""";

    private static RunnableListItem Item(int id, string name, string category, int categorySort, int sort, string sql = "SELECT 1 AS one", string parameters = "[]", int? categoryId = null) =>
        new(id, name, null, sort, categoryId ?? categorySort * 10 + 1, category, categorySort, 1, sql, parameters, null);

    private static ReportBrowseService Service(int? user, params RunnableListItem[] items) => Service(user, items, []);

    private static ReportBrowseService Service(int? user, RunnableListItem[] items, RunnableDetail[] details)
    {
        var current = new FakeUser(user);
        var builtIns = new BuiltInContextFactory(current, new FakePods(), new ConfigurationBuilder().Build(), new FixedTime(new DateTimeOffset(2026, 11, 7, 12, 0, 0, TimeSpan.Zero)));
        return new ReportBrowseService(new FakeCatalog(items, details), current, builtIns, Options.Create(new ReportsOptions()));
    }

    private static RunnableDetail Detail(int id, string sql = "SELECT 1 AS one", string parameters = "[]", int? timeout = null, int? maxRows = null) =>
        new(id, "Report " + id, "Short line", "Longer help", 4, "Tasks", 3, sql, parameters, timeout, maxRows);

    [Fact]
    public async Task Categories_follow_their_sort_order_and_reports_follow_theirs_then_the_name()
    {
        var service = Service(
            7,
            Item(1, "Zeta", "Billing", 2, 0),
            Item(2, "Beta", "Tasks", 1, 5),
            Item(3, "alpha", "Tasks", 1, 5),
            Item(4, "First", "Tasks", 1, 0),
            Item(5, "Only", "Billing", 2, 0, categoryId: 21));

        var result = await service.ListAsync(CancellationToken.None);

        result.Problem.ShouldBeNull();
        result.Value!.Select(c => c.Name).ShouldBe(["Tasks", "Billing"]);
        result.Value![0].Reports.Select(r => r.Name).ShouldBe(["First", "alpha", "Beta"]);
        result.Value![1].Reports.Select(r => r.Name).ShouldBe(["Only", "Zeta"]);
    }

    [Fact]
    public async Task Only_the_parameters_the_sql_uses_are_counted_and_labelled()
    {
        var service = Service(7, Item(1, "Tasks", "Tasks", 1, 0, "SELECT * FROM dbo.Task WHERE DueDate >= :FROM AND MatterId = :MATTER", TwoParameters));

        var report = (await service.ListAsync(CancellationToken.None)).Value![0].Reports[0];

        report.ParameterCount.ShouldBe(2);
        report.ParameterLabels.ShouldBe(["From", "Matter"]);
    }

    [Fact]
    public async Task A_date_range_counts_as_one_parameter_and_a_report_without_parameters_has_none()
    {
        var service = Service(
            7,
            Item(1, "Range", "Tasks", 1, 0, "SELECT 1 AS one WHERE :WHEN_FROM IS NOT NULL AND :WHEN_TO IS NOT NULL", """[{"name":"WHEN","type":"dateRange","label":"When"}]"""),
            Item(2, "Plain", "Tasks", 1, 1));

        var reports = (await service.ListAsync(CancellationToken.None)).Value![0].Reports;

        reports[0].ParameterCount.ShouldBe(1);
        reports[0].ParameterLabels.ShouldBe(["When"]);
        reports[1].ParameterCount.ShouldBe(0);
        reports[1].ParameterLabels.ShouldBeEmpty();
    }

    [Fact]
    public async Task A_parameter_without_a_label_is_shown_by_its_name_and_unreadable_definitions_count_as_none()
    {
        var service = Service(
            7,
            Item(1, "Named", "Tasks", 1, 0, "SELECT :CUTOFF AS c", """[{"name":"CUTOFF","type":"text","label":""}]"""),
            Item(2, "Broken", "Tasks", 1, 1, "SELECT 1 AS one", "not json"));

        var reports = (await service.ListAsync(CancellationToken.None)).Value![0].Reports;

        reports[0].ParameterLabels.ShouldBe(["CUTOFF"]);
        reports[1].ParameterCount.ShouldBe(0);
    }

    [Fact]
    public async Task Nothing_assigned_is_an_empty_list_and_nobody_signed_in_is_401()
    {
        (await Service(7).ListAsync(CancellationToken.None)).Value.ShouldBeEmpty();

        var anonymous = await Service(null, Item(1, "Tasks", "Tasks", 1, 0)).ListAsync(CancellationToken.None);

        anonymous.Problem!.Status.ShouldBe(401);
        anonymous.Value.ShouldBeNull();
    }

    [Fact]
    public void The_summary_type_has_no_member_that_could_carry_sql()
    {
        var names = typeof(RunnableReportSummary).GetProperties().Concat(typeof(RunnableCategory).GetProperties()).Select(p => p.Name).ToList();

        names.ShouldNotContain(n => n.Contains("Sql", StringComparison.OrdinalIgnoreCase));
    }

    // ---- one definition (issue #719) ----

    [Fact]
    public async Task A_definition_has_the_details_the_effective_limits_and_only_the_parameters_the_sql_uses()
    {
        var service = Service(7, [], [Detail(10, "SELECT * FROM dbo.Task WHERE DueDate >= :FROM AND MatterId = :MATTER", TwoParameters, timeout: 20, maxRows: 500)]);

        var result = await service.GetAsync(10, CancellationToken.None);

        result.Problem.ShouldBeNull();
        var report = result.Value!;
        (report.ReportId, report.Name, report.Description, report.HelpText, report.CategoryId, report.CategoryName, report.VersionNo).ShouldBe((10, "Report 10", "Short line", "Longer help", 4, "Tasks", 3));
        (report.TimeoutSeconds, report.MaxRows).ShouldBe((20, 500));
        report.Parameters.Select(p => p.Name).ShouldBe(["FROM", "MATTER"]);
    }

    [Fact]
    public async Task Limits_that_the_report_does_not_set_come_from_the_module_defaults_and_ceilings()
    {
        var defaults = new ReportsOptions();
        var service = Service(7, [], [Detail(10), Detail(11, timeout: 100000, maxRows: int.MaxValue)]);

        var plain = (await service.GetAsync(10, CancellationToken.None)).Value!;
        var capped = (await service.GetAsync(11, CancellationToken.None)).Value!;

        plain.TimeoutSeconds.ShouldBe(defaults.EffectiveTimeout(null));
        plain.MaxRows.ShouldBe(defaults.EffectiveMaxRows(null));
        capped.TimeoutSeconds.ShouldBe(defaults.EffectiveTimeout(100000));
        capped.MaxRows.ShouldBe(defaults.EffectiveMaxRows(int.MaxValue));
    }

    [Fact]
    public async Task Defaults_are_resolved_with_the_firm_day_and_the_person()
    {
        var service = Service(7, [], [Detail(10, "SELECT :DAY AS d, :WHO AS w", """[{"name":"DAY","type":"date","label":"Day","default":"today"},{"name":"WHO","type":"lookup","label":"Who","lookupKind":"user","default":"me"}]""")]);

        var parameters = (await service.GetAsync(10, CancellationToken.None)).Value!.Parameters;

        parameters[0].Default!.Value.GetString().ShouldBe("2026-11-07");
        parameters[1].Default!.Value.GetInt32().ShouldBe(7);
    }

    [Fact]
    public async Task An_unknown_report_is_404_and_nobody_signed_in_is_401()
    {
        var missing = await Service(7, [], [Detail(10)]).GetAsync(99, CancellationToken.None);
        var anonymous = await Service(null, [], [Detail(10)]).GetAsync(10, CancellationToken.None);

        missing.Problem!.Status.ShouldBe(404);
        missing.Problem.Code.ShouldBe("NOT_FOUND");
        missing.Problem.Message.ShouldBe(ReportRunService.NotAvailableMessage);
        anonymous.Problem!.Status.ShouldBe(401);
    }
}
