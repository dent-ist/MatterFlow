using Shouldly;

namespace LptHub.IntegrationTests.Security;

/// <summary>
/// The catalogue guard of the Task Type access rule (epic #1397, issue #1400, README 12.2): every list, resource by id and aggregate of <see cref="SensitiveAccessCatalog"/> is also
/// classified in <see cref="TaskTypeAccessCatalog"/>. The sensitive catalogue already fails the build for an endpoint nobody classified; this one fails it for an endpoint that is not
/// neutral and not yet decided against the type rule, so a new read path of tasks cannot be added without being registered.
/// </summary>
public sealed class TaskTypeAccessCatalogTests
{
    [Fact]
    public void Every_endpoint_that_serves_data_is_classified_against_the_type_rule_and_the_catalogue_has_no_stale_entry()
    {
        var required = TaskTypeAccessCatalog.Required().ToList();
        var unclassified = required.Where(k => !TaskTypeAccessCatalog.All.ContainsKey(k)).Order(StringComparer.Ordinal).ToList();
        unclassified.ShouldBeEmpty("Classify these endpoints in TaskTypeAccessCatalog (Port, ById, Exception, Deferred or NotTaskData with a reason): " + string.Join("; ", unclassified));

        var stale = TaskTypeAccessCatalog.All.Keys.Where(k => !required.Contains(k)).Order(StringComparer.Ordinal).ToList();
        stale.ShouldBeEmpty("These entries are not (or no longer) lists, resources by id or aggregates of SensitiveAccessCatalog: " + string.Join("; ", stale));
        TaskTypeAccessCatalog.All.Values.ShouldAllBe(e => e.Reason.Length > 0 && e.Area.Length > 0);
    }

    [Fact]
    public void Every_task_reading_endpoint_of_the_sensitive_catalogue_has_calls_for_the_walk()
    {
        var withoutCalls = TaskTypeAccessCatalog.All
            .Where(kv => kv.Value.Handling is TypeHandling.Port or TypeHandling.ById && kv.Key.StartsWith("GET ", StringComparison.Ordinal) && SensitiveAccessCatalog.All[kv.Key].Calls.Length == 0)
            .Select(kv => kv.Key).Order(StringComparer.Ordinal).ToList();

        // Closed list, on purpose: the same code path as an endpoint that is walked (workflow version counts: ConfigurationTaskCounts, walked through GET api/v1/workflows), or a saved asset report
        // that needs data the walk does not create (AssetReport tests walk it). A new task endpoint without a call fails here.
        withoutCalls.ShouldBe(
        [
            "GET api/v1/asset-reports/{assetReportId:int}/run",
            "GET api/v1/workflows/published",
            "GET api/v1/workflows/{id:int}",
            "GET api/v1/workflows/{id:int}/published",
            "GET api/v1/workflows/{id:int}/versions/{versionId:int}",
        ]);
    }

    [Fact]
    public void Only_the_owner_named_gaps_are_exceptions_or_deferred_to_the_pickers()
    {
        TaskTypeAccessCatalog.All.Where(kv => kv.Value.Handling == TypeHandling.Exception).Select(kv => kv.Key).Order(StringComparer.Ordinal).ToList().ShouldBe(
        [
            "GET api/v1/dashboard/calendar/day",
            "GET api/v1/dashboard/calendar/days",
            "GET api/v1/dashboard/calendar/summary",
            "GET api/v1/dashboard/capacity",
            "GET api/v1/dashboard/capacity/people",
            "GET api/v1/reports/{id:int}/lookups/{parameter}",
        ]);
        TaskTypeAccessCatalog.All.Where(kv => kv.Value.Handling == TypeHandling.Deferred).Select(kv => kv.Key).Order(StringComparer.Ordinal).ToList().ShouldBe(
        [
            "GET api/v1/task-types",
            "GET api/v1/task-types/{id:int}",
            "GET api/v1/users/lookup",
        ]);
    }

    [Fact]
    public void Every_inventory_area_of_the_read_side_is_covered_by_at_least_one_endpoint()
    {
        var areas = TaskTypeAccessCatalog.All.Values.SelectMany(e => e.Area.Split(',')).ToHashSet();
        foreach (var area in new[] { "K1", "K2", "K3", "K4", "K5", "K6", "K7", "K11", "K12", "Q1", "Q2", "Q4", "Q5", "Q7", "D1", "D2", "D4", "D5", "D7", "D8", "D9", "D12", "M1", "M2", "M3", "M4", "M5", "O1", "O2", "O3", "O4", "O5", "O6", "S1", "S2", "S4", "S5", "N1", "F1" })
            areas.ShouldContain(area, "inventory row " + area + " has no endpoint in the catalogue");
    }
}
