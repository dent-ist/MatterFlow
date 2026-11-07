using MatterFlow.Reports.Application;
using MatterFlow.SharedKernel.Identity;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>The list a person who may run reports sees: grouping, order, parameter counts from what the SQL uses, no SQL anywhere (issue #718).</summary>
public class ReportBrowseServiceTests
{
    private sealed class FakeUser(int? id) : ICurrentUser
    {
        public int? UserId => id;

        public bool IsAuthenticated => id is not null;
    }

    private sealed class FakeCatalog(params RunnableListItem[] items) : IReportCatalog
    {
        public Task<RunnableReport?> FindRunnableAsync(int reportId, int userId, CancellationToken cancellationToken) => Task.FromResult<RunnableReport?>(null);

        public Task<IReadOnlyList<RunnableListItem>> ListRunnableAsync(int userId, CancellationToken cancellationToken) => Task.FromResult<IReadOnlyList<RunnableListItem>>(items);
    }

    private const string TwoParameters =
        """[{"name":"FROM","type":"date","label":"From"},{"name":"MATTER","type":"lookup","label":"Matter","lookupKind":"matter"},{"name":"UNUSED","type":"text","label":"Not in the SQL"}]""";

    private static RunnableListItem Item(int id, string name, string category, int categorySort, int sort, string sql = "SELECT 1 AS one", string parameters = "[]", int? categoryId = null) =>
        new(id, name, null, sort, categoryId ?? categorySort * 10 + 1, category, categorySort, 1, sql, parameters, null);

    private static ReportBrowseService Service(int? user, params RunnableListItem[] items) => new(new FakeCatalog(items), new FakeUser(user));

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
}
