using System.Text.RegularExpressions;
using Shouldly;

namespace MatterFlow.ArchitectureTests;

/// <summary>
/// Sensitive-matter epic #788 (SM-16, README 12.3 a, b, d): a read path that touches the matter, task, project or asset tables, or the audit and notification tables, must go
/// through the visibility rule. These tests list EVERY source file that does so with the reason it is safe; a new file (or a new use of <c>IgnoreQueryFilters</c>) fails the build
/// until somebody has reviewed it and added it here. The rule's behaviour itself is proven by the persona walk (<c>SensitivePersonaWalkTests</c>).
/// </summary>
public class VisibilitySourceRulesTests
{
    private static IEnumerable<string> ProductSources()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "global.json")))
            dir = dir.Parent;

        dir.ShouldNotBeNull();
        return Directory.EnumerateFiles(Path.Combine(dir.FullName, "backend", "src"), "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                && !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal));
    }

    /// <summary>Files that read <c>Set&lt;Matter|WorkTask|Project|Asset&gt;()</c> directly, and why each is safe.</summary>
    private static readonly Dictionary<string, string> SetAllowList = new()
    {
        // the sources the rule itself is built on
        ["MatterTeamService.cs"] = "team endpoints check the matter through IMatterVisibility.WhereMatterRowVisible (404 for a hidden matter); the pick-list usage counts are aggregate numbers for the admin lists, no matter content (epic #1298)",
        ["MatterAccessSource.cs"] = "the unfiltered matter source behind IMatterVisibility",
        ["TaskAccessSource.cs"] = "the unfiltered task source behind IMatterVisibility",
        ["TaskAccess.cs"] = "the one place WorkManagement reads tasks through the rule (Visible, CanSeeAsset)",
        ["VisibleTasks.cs"] = "the one place WorkViews reads tasks through the rule",
        ["AssetService.cs"] = "reads go through AssetAccess.Visible, writes through AssetAccess.OfVisibleMatters; Add for create",
        ["AssetTypeService.cs"] = "asset counts through AssetAccess.Visible",
        ["AssetNumberingService.cs"] = "reads only the highest assigned number per matter of matters already filtered by IMatterVisibility (the counter list) or checked by AssetAccess.CanSeeMatterAsync (one counter, set next number); no asset data is returned",
        ["AssetScope.cs"] = "the scope's matters come from IManagedMatterScope.WhereManagedBy / IMatterVisibility.WhereMatterVisible (the sensitive-matter rule, epic #851); its assets are those matters' assets by subquery",
        ["AssetDataService.cs"] = "assets of the AssetScope (visible matters by construction); matter and client names only for matters that hold counted assets",
        ["AssetReportRunService.cs"] = "assets of the AssetScope (visible matters by construction); group labels (matter, client) only for the matters of counted groups",
        ["AssetReferenceValidator.cs"] = "through AssetAccess.Visible",
        ["AssetDirectory.cs"] = "internal lookup for other modules (R13): callers apply their own mode",
        ["Directories.cs"] = "internal IMatterDirectory / IProjectDirectory lookups (R13): callers gate",
        ["ClientService.cs"] = "client rows; matter counts through WhereMatterRowVisible",
        ["MatterService.cs"] = "matters through MatterSet (WhereMatterRowVisible); the answer to a write is read once unrestricted",
        ["ProjectService.cs"] = "projects through WhereMatterVisible; the answer to a write is read once unrestricted",
        ["SearchService.cs"] = "every type applies its rule (VisibleMatters, WhereTaskRowVisible, WhereMatterRowVisibleOr)",
        ["TaskAssetLinkReader.cs"] = "links joined to TaskAccess.Visible",
        ["TaskBulkService.cs"] = "the task list of a bulk goes through TaskAccess.Visible",
        ["TaskDirectory.cs"] = "internal ITaskDirectory lookups (R13/R45): integrity checks and audit display",
        ["TaskPresenter.cs"] = "reads through TaskAccess.Visible; afterWrite reads the answer to a command once unrestricted",
        ["TaskService.cs"] = "creates tasks; every read goes through TaskAccess",
        ["TaskTransactions.cs"] = "LockTaskAsync is gated by CanSeeTaskAsync before the lock",
        ["ConfigurationTaskCounts.cs"] = "counts over VisibleTasks; the true load of the ranker is read separately on purpose (owner decision Q5)",
        ["CapacityService.cs"] = "Dashboard v4 capacity battery (decision AS item 12): the DELIBERATE aggregate exception. A worker's New and In progress tasks are counted unfiltered, as a bare integer per person, and the last-hour count is one integer; no task, matter, title or id is selected or returned",
        ["CalendarService.cs"] = "Dashboard Calendar (epic #1074, decision AT item 21, an extension of AS item 12 to be confirmed by the security review): New and In progress tasks of the workers in view are counted unfiltered, as a bare integer per person (the day panel) and as one total for the forecast; no task, matter, title or id is selected or returned; the answers carry people and availability only",
        ["DashboardService.cs"] = "tasks through VisibleTasks; the caller's own tasks are always visible",
        ["MyMattersActivityService.cs"] = "events of the scope's visible matters; stamped history only for managers",
        ["MatterEventService.cs"] = "calendar events join matters through WhereMatterRowVisible (the sensitive-matter rule); writes load the visible matter first (404 otherwise)",
        ["MyMattersFeedService.cs"] = "assets, tasks and audit events of the scope's visible matters; names loaded by the ids of the page",
        ["MyMattersTreeService.cs"] = "assets of the scope's visible matters (grouped by matter)",
        ["MyMattersAssetsService.cs"] = "assets of the scope's visible matters; linked tasks through VisibleTasks",
        ["MatterOverviewService.cs"] = "the matter header after the visibility check of that one matter (CanSeeMatterAsync, 404 otherwise); the tasks come from VisibleTasks",
        ["MyMattersAttentionService.cs"] = "rows of the scope's visible matters, loaded by id",
        ["MyMattersTaskFacts.cs"] = "type, priority, age and hold facts of the few task ids a My Matters call already returned (loaded by id)",
        ["SectionSorts.cs"] = "a one-row lookup of the matter reference as a sort key of tasks that are already in the scope's visible set",
        ["MyMattersBreakdownService.cs"] = "names of the page's matters, which are in the scope (visible by construction)",
        ["MyMattersSinceLastVisitService.cs"] = "names of the scope's matters (visible by construction) for the few items shown",
        ["MyMattersWorkloadService.cs"] = "names of the scope's matters (visible by construction) for the per-person split",
        ["MyMattersScope.cs"] = "tasks of the scope's matters, which are visible by construction (IManagedMatterScope)",
        ["OrganizationTaskCounts.cs"] = "counts through WhereTaskRowVisible / visible matters",
        ["SwimlaneService.cs"] = "cards are loaded by the ids of the visible set",
        ["TaskQueueService.cs"] = "Tasks() is the visible base; detail rows are loaded by the ids of the page",
    };

    /// <summary>Files with raw SQL text that names the matter, task, project, asset, audit or notification table, and why each is safe.</summary>
    private static readonly Dictionary<string, string> RawSqlAllowList = new()
    {
        ["AuditStoreGuard.cs"] = "guards the audit table against truncation; no read for a person",
        ["AuditSaveChangesInterceptor.cs"] = "the audit writer's stamp lookup: system, writes only",
        ["AuditSearchService.cs"] = "facet skip scan with the visibility predicate (AuditVisibility.FacetFilterAsync)",
        ["AuditEvent.cs"] = "documentation text",
        ["AuditEventConfiguration.cs"] = "table mapping",
        ["NotificationRetentionJob.cs"] = "age-based delete of notifications",
        ["TaskDueJob.cs"] = "system candidate scan; each recipient is checked as themselves (RecipientVisibility)",
        ["TaskStalledJob.cs"] = "system candidate scan; each recipient is checked as themselves (RecipientVisibility)",
        ["MatterService.cs"] = "row lock of the matter for writes",
        ["ReportAudit.cs"] = "Reports are undecided (README section 15, issue #808)",
        ["ReportLookupStore.cs"] = "report parameter lookup (owner decision 13): id and label of non-sensitive matters only (IsSensitive = 0 in the one fixed statement, for the search and for the resolve by id), for anybody who may run the report; the persona walk and ReportLookupApiTests prove no sensitive matter is ever returned",
        ["ReportAuditSql.cs"] = "Reports are undecided (README section 15, issue #808)",
        ["TaskTransactions.cs"] = "row locks; the task lock is gated by CanSeeTaskAsync",
        ["MyMattersActivityService.cs"] = "audit window read restricted to the scope's visible matters",
        ["UserHistory.cs"] = "first IN_PROGRESS audit time read only as a correlated minimum for tasks that already come from VisibleTasks (never returned, no content columns; #1092)",
    };

    [Fact]
    public void Direct_reads_of_matter_task_project_and_asset_sets_are_only_in_reviewed_files()
    {
        var pattern = new Regex(@"Set<(Matter|WorkTask|Project|Asset)>", RegexOptions.CultureInvariant);
        var found = ProductSources().Where(f => pattern.IsMatch(File.ReadAllText(f))).Select(Path.GetFileName).Distinct().Order(StringComparer.Ordinal).ToList();
        var unreviewed = found.Where(f => !SetAllowList.ContainsKey(f!)).ToList();
        unreviewed.ShouldBeEmpty("These files read Set<Matter|WorkTask|Project|Asset> directly. Route the read through IMatterVisibility / TaskAccess / AssetAccess, or review it and add it to VisibilitySourceRulesTests with a reason: " + string.Join(", ", unreviewed));
        SetAllowList.Keys.Where(k => !found.Contains(k)).ShouldBeEmpty("Stale allow-list entries (the file no longer reads these sets).");
    }

    [Fact]
    public void Raw_sql_on_the_matter_task_project_asset_audit_and_notification_tables_is_only_in_reviewed_files()
    {
        var pattern = new Regex(@"dbo\.(Matter|Task|Project|Asset|AuditEvent|Notification)\b", RegexOptions.CultureInvariant);
        var found = ProductSources().Where(f => pattern.IsMatch(File.ReadAllText(f))).Select(Path.GetFileName).Distinct().Order(StringComparer.Ordinal).ToList();
        var unreviewed = found.Where(f => !RawSqlAllowList.ContainsKey(f!)).ToList();
        unreviewed.ShouldBeEmpty("These files contain raw SQL on rule-protected tables. Use the visibility functions or the port, or review it and add it to VisibilitySourceRulesTests with a reason: " + string.Join(", ", unreviewed));
        RawSqlAllowList.Keys.Where(k => !found.Contains(k)).ShouldBeEmpty("Stale allow-list entries (the file no longer contains such SQL).");
    }

    [Fact]
    public void Global_query_filters_are_not_used_the_rule_is_explicit_in_every_read()
    {
        // README section 4: the EF global filter was decided against (spike in SM-02), so there is no IgnoreQueryFilters allow-list to maintain.
        var offenders = ProductSources().Where(f => File.ReadAllText(f).Contains("IgnoreQueryFilters", StringComparison.Ordinal)).Select(Path.GetFileName).ToList();
        offenders.ShouldBeEmpty();
    }
}
