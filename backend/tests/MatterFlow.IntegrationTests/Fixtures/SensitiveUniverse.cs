using MatterFlow.IntegrationTests.Tasks;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Fixtures;

/// <summary>
/// The "universe" of the sensitive-matter tests (epic #788, README 12.1): users, matters and tasks for the six personas, with a sentinel
/// (<c>ZZSENS-{matterId}</c>) in the name of every sensitive matter, its project and its task titles so a response sweep can prove nothing leaked.
/// <list type="bullet">
/// <item>Personas: <c>PmPrimaryClient</c> (P1), <c>PmSecondaryClient</c> (P2), <c>AssigneeClient</c> (P3, one task on S3), <c>ViewerClient</c> (P4, holds Matter.ViewSensitive),
/// <c>UnrelatedClient</c> (P5), <c>NoPermClient</c> (P6b: authenticated, Client.View only); the administrator is <c>H.Admin</c>. P1 to P5 hold the same broad
/// permissions (view, edit, number, active, managers, projects, tasks), so any difference between them comes from the sensitive-matter rule alone.</item>
/// <item>Matters: <c>S1</c> sensitive, Primary P1 and Secondary P2; <c>S2</c> sensitive, no manager; <c>S3</c> sensitive, no manager, a task assigned to P3; <c>N1</c> normal. Each has a project and a task.</item>
/// </list>
/// </summary>
public sealed class SensitiveUniverse
{
    public const string SentinelPrefix = "ZZSENS-";

    public TaskHarness H { get; private set; } = null!;

    public TaskHarness.World World { get; private set; } = null!;

    public int S1 { get; private set; }

    public int S2 { get; private set; }

    public int S3 { get; private set; }

    public int N1 { get; private set; }

    public long TS1 { get; private set; }

    public long TS2 { get; private set; }

    public long TS3 { get; private set; }

    public long TN1 { get; private set; }

    public int PS1 { get; private set; }

    public int PS2 { get; private set; }

    public int PS3 { get; private set; }

    public int PN1 { get; private set; }

    public int PmPrimary { get; private set; }

    public int PmSecondary { get; private set; }

    public int Assignee { get; private set; }

    public int Viewer { get; private set; }

    public int Unrelated { get; private set; }

    public HttpClient PmPrimaryClient { get; private set; } = null!;

    public HttpClient PmSecondaryClient { get; private set; } = null!;

    public HttpClient AssigneeClient { get; private set; } = null!;

    public HttpClient ViewerClient { get; private set; } = null!;

    public HttpClient UnrelatedClient { get; private set; } = null!;

    public HttpClient NoPermClient { get; private set; } = null!;

    public int[] SensitiveMatters => [S1, S2, S3];

    public int[] AllMatters => [N1, S1, S2, S3];

    /// <summary>The sentinel text of a sensitive matter.</summary>
    public static string Sentinel(int matterId) => SentinelPrefix + matterId;

    public static async Task<SensitiveUniverse> BuildAsync(SqlServerFixture sql, bool enabled)
    {
        var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { ExtraSettings = [("Features:SensitiveMatterAccess", enabled ? "true" : "false")] };
        var u = new SensitiveUniverse { H = new TaskHarness(factory) };
        await u.InitAsync();
        return u;
    }

    private async Task InitAsync()
    {
        var h = H;
        World = await h.CreateWorldAsync(); // matter "343-12", used as N1
        N1 = World.MatterId;
        S1 = await h.CreateMatterAsync("343", "21");
        S2 = await h.CreateMatterAsync("343", "22");
        S3 = await h.CreateMatterAsync("343", "23");

        string[] broad =
        [
            "Task.View", "Task.Create", "Task.Edit", "Task.Assign", "Task.Comment", "Matter.View", "Matter.Create", "Matter.Edit", "Matter.EditNumber", "Matter.SetActive",
            "Matter.AssignManagers", "Matter.BeManager", "Project.View", "Project.Create", "Project.Edit", "Client.View", "Asset.View", "Asset.Link", "Asset.Create", "Asset.Edit", "Task.SetPriority", "Task.ChangeStatus", "Task.Complete", "Task.Cancel",
            "Task.Reopen", "Workflow.Execute", "Workflow.StepReopen", "Pod.View", "Dashboard.View", "Dashboard.ViewSwimlane", "Dashboard.ViewSummary", "Dashboard.ViewBreakdowns", "Dashboard.ViewTrends", "Dashboard.ViewUsers", "Dashboard.ViewCoverage",
        ];
        PmPrimaryClient = await h.UserWithAsync(@"KE\pmprimary", broad);
        PmSecondaryClient = await h.UserWithAsync(@"KE\pmsecondary", broad);
        AssigneeClient = await h.UserWithAsync(@"KE\assignee", broad);
        UnrelatedClient = await h.UserWithAsync(@"KE\unrelated", broad);
        ViewerClient = await h.UserWithAsync(@"KE\viewer", [.. broad, "Matter.ViewSensitive"]);
        NoPermClient = await h.UserWithAsync(@"KE\noperm", "Client.View");
        PmPrimary = await h.UserIdAsync(@"KE\pmprimary");
        PmSecondary = await h.UserIdAsync(@"KE\pmsecondary");
        Assignee = await h.UserIdAsync(@"KE\assignee");
        Unrelated = await h.UserIdAsync(@"KE\unrelated");
        Viewer = await h.UserIdAsync(@"KE\viewer");

        async Task<long> TaskOn(int matterId, int projectId, int? assignee = null)
        {
            var extra = new Dictionary<string, object?> { ["matterId"] = matterId, ["projectId"] = projectId };
            if (assignee is { } a)
                extra["assignedUserId"] = a;
            return TaskId(await h.CreateTaskAsync(World, false, extra));
        }

        PN1 = await h.CreateProjectAsync(N1, "Normal project");
        PS1 = await h.CreateProjectAsync(S1, "Project S1");
        PS2 = await h.CreateProjectAsync(S2, "Project S2");
        PS3 = await h.CreateProjectAsync(S3, "Project S3");
        TN1 = await TaskOn(N1, PN1);
        TS1 = await TaskOn(S1, PS1);
        TS2 = await TaskOn(S2, PS2);
        TS3 = await TaskOn(S3, PS3, Assignee);

        foreach (var (matter, project, task) in new[] { (S1, PS1, TS1), (S2, PS2, TS2), (S3, PS3, TS3) })
        {
            await h.ExecuteAsync($"UPDATE dbo.Matter SET IsSensitive = 1, Name = N'{Sentinel(matter)} matter' WHERE MatterId = {matter}");
            await h.ExecuteAsync($"UPDATE dbo.Project SET Name = N'{Sentinel(matter)} project' WHERE ProjectId = {project}");
            await h.ExecuteAsync($"UPDATE dbo.Task SET Title = N'{Sentinel(matter)} task' WHERE TaskId = {task}");
        }

        await h.ExecuteAsync($"UPDATE dbo.Matter SET PrimaryManagerId = {PmPrimary}, SecondaryManagerId = {PmSecondary} WHERE MatterId = {S1}");
        h.Factory.InvalidateAll();
    }
}
