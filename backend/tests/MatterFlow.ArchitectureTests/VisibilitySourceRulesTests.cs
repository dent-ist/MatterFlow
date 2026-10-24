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
        ["MatterAccessSource.cs"] = "the unfiltered matter source behind IMatterVisibility",
        ["TaskAccessSource.cs"] = "the unfiltered task source behind IMatterVisibility",
        ["TaskAccess.cs"] = "the one place WorkManagement reads tasks through the rule (Visible, CanSeeAsset)",
        ["VisibleTasks.cs"] = "the one place WorkViews reads tasks through the rule",
        ["VisibilityStamp.cs"] = "cache-key fingerprint of what the viewer may see (reads ids only)",
        ["AssetService.cs"] = "reads go through AssetAccess.Visible, writes through AssetAccess.OfVisibleMatters; Add for create",
        ["AssetTypeService.cs"] = "asset counts through AssetAccess.Visible",
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
        ["DashboardService.cs"] = "tasks through VisibleTasks; the caller's own tasks are always visible",
        ["MyMattersActivityService.cs"] = "events of the scope's visible matters; stamped history only for managers",
        ["MyMattersAttentionService.cs"] = "rows of the scope's visible matters, loaded by id",
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
        ["ReportAuditSql.cs"] = "Reports are undecided (README section 15, issue #808)",
        ["TaskTransactions.cs"] = "row locks; the task lock is gated by CanSeeTaskAsync",
        ["MyMattersActivityService.cs"] = "audit window read restricted to the scope's visible matters",
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
