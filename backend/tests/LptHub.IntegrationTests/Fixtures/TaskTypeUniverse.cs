using System.Net;
using System.Net.Http.Json;
using LptHub.IntegrationTests.Tasks;
using Shouldly;
using static LptHub.IntegrationTests.Tasks.TaskHarness;

namespace LptHub.IntegrationTests.Fixtures;

/// <summary>
/// The "universe" of the Task Type access tests (epic #1397, issue #1400, README 12.1). One matter <c>M</c> with a project; two task types, <c>Open</c> (no roles) and
/// <c>Secret</c> (Can View: the role <c>Privilege Reviewers</c>); and the personas, who all hold the same broad permissions, so any difference between them comes from the type rule alone:
/// <list type="bullet">
/// <item><c>Viewer</c> holds the Can View role; <c>Outsider</c> does not, but is the primary project manager of M and the assignee of the Secret task <c>T2</c> (no exception for either);
/// <c>Plain</c> holds nothing special; <c>SensitiveHolder</c> holds <c>Matter.ViewSensitive</c> (which must not lift the type rule); <c>Tech</c> has the Technician's dashboard
/// permissions only and is the assignee of <c>T5</c> (Open) and <c>T6</c> (Secret); the administrator is <c>H.Admin</c> (System Admin).</item>
/// <item>Tasks: <c>T1</c> Open, unassigned; <c>T2</c> Secret, assigned to Outsider; <c>T3</c> Secret, unassigned; <c>T4</c> Open, assigned to Outsider; <c>T5</c> Open and <c>T6</c> Secret, both assigned to Tech.
/// The title of every Secret task and its comment carry the sentinel <see cref="Sentinel"/> so a response sweep can prove nothing leaked.</item>
/// </list>
/// </summary>
public sealed class TaskTypeUniverse
{
    public const string Sentinel = "ZZTYPE";

    /// <summary>The name of the Secret type. It carries no sentinel: the type appears, by name, in configuration and audit screens that are not task data.</summary>
    public const string SecretTypeName = "Privilege Review";

    /// <summary>The body of an error answer without its trace id, so a hidden id and a missing id can be compared byte for byte.</summary>
    public static string WithoutTrace(string body) => System.Text.RegularExpressions.Regex.Replace(body, "\"traceId\":\"[^\"]*\"", string.Empty);

    public TaskHarness H { get; private set; } = null!;

    public TaskHarness.World OpenWorld { get; private set; } = null!;

    public TaskHarness.World SecretWorld { get; private set; } = null!;

    public int Matter { get; private set; }

    public int Project { get; private set; }

    public int SecretTypeId { get; private set; }

    public int ReviewerRole { get; private set; }

    public long T1 { get; private set; }

    public long T2 { get; private set; }

    public long T3 { get; private set; }

    public long T4 { get; private set; }

    public long T5 { get; private set; }

    public long T6 { get; private set; }

    public int ViewerId { get; private set; }

    public int OutsiderId { get; private set; }

    public int PlainId { get; private set; }

    public int TechId { get; private set; }

    public HttpClient Viewer { get; private set; } = null!;

    public HttpClient Outsider { get; private set; } = null!;

    public HttpClient Plain { get; private set; } = null!;

    public HttpClient SensitiveHolder { get; private set; } = null!;

    public HttpClient Tech { get; private set; } = null!;

    public long[] SecretTasks => [T2, T3, T6];

    public long[] AllTasks => [T1, T2, T3, T4, T5, T6];

    public long[] OpenTasks => [T1, T4, T5];

    /// <summary>The permissions every persona but Tech holds: the same on purpose.</summary>
    public static readonly string[] Broad =
    [
        "Task.View", "Task.Create", "Task.Edit", "Task.Assign", "Task.Comment", "Matter.View", "Matter.Create", "Matter.Edit", "Matter.EditNumber", "Matter.SetActive",
        "Matter.AssignManagers", "Matter.BeManager", "Project.View", "Project.Create", "Project.Edit", "Client.View", "Asset.View", "Asset.Link", "Asset.Create", "Asset.Edit",
        "Task.SetPriority", "Task.ChangeStatus", "Task.Complete", "Task.Cancel", "Task.Reopen", "Workflow.Execute", "Workflow.StepReopen", "Pod.View", "User.View", "Audit.View",
        "Dashboard.View", "Dashboard.ViewSwimlane", "Dashboard.ViewSummary", "Dashboard.ViewBreakdowns", "Dashboard.ViewTrends", "Dashboard.ViewUsers", "Dashboard.ViewCoverage",
        "Dashboard.ViewCalendar", "Dashboard.ViewAbsenceReasons", "User.ManageAvailability", "Report.Run",
    ];

    /// <summary>Builds the universe. <paramref name="typeRule"/> is <c>Features:TaskTypeAccess</c>; <paramref name="sensitiveRule"/> is <c>Features:SensitiveMatterAccess</c>; <paramref name="restrict"/> restricts the Secret type at the end.</summary>
    public static async Task<TaskTypeUniverse> BuildAsync(SqlServerFixture sql, bool typeRule, bool sensitiveRule = false, bool restrict = true)
    {
        var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync())
        {
            ExtraSettings = [("Features:TaskTypeAccess", typeRule ? "true" : "false"), ("Features:SensitiveMatterAccess", sensitiveRule ? "true" : "false")],
        };
        var u = new TaskTypeUniverse { H = new TaskHarness(factory) };
        await u.InitAsync(restrict);
        return u;
    }

    private async Task InitAsync(bool restrict)
    {
        var h = H;
        OpenWorld = await h.CreateWorldAsync();
        Matter = OpenWorld.MatterId;
        Project = OpenWorld.ProjectId;
        SecretTypeId = await h.CreateTaskTypeAsync(SecretTypeName, [OpenWorld.OrderedWorkflowId, OpenWorld.UnorderedWorkflowId]);
        SecretWorld = OpenWorld with { TaskTypeId = SecretTypeId };

        ReviewerRole = await h.Factory.CreateRoleAsync("Privilege Reviewers", "Task.View");
        Viewer = await h.UserWithAsync(@"KE\tviewer", Broad);
        Outsider = await h.UserWithAsync(@"KE\toutsider", Broad);
        Plain = await h.UserWithAsync(@"KE\tplain", Broad);
        SensitiveHolder = await h.UserWithAsync(@"KE\tsens", [.. Broad, "Matter.ViewSensitive"]);
        Tech = await h.UserWithAsync(@"KE\ttech", "Task.View", "Matter.View", "Asset.View", "Workflow.Execute", "Dashboard.View", "Dashboard.ViewUnassigned");
        await h.Factory.GrantRoleAsync(@"KE\tviewer", ReviewerRole);
        ViewerId = await h.UserIdAsync(@"KE\tviewer");
        OutsiderId = await h.UserIdAsync(@"KE\toutsider");
        PlainId = await h.UserIdAsync(@"KE\tplain");
        TechId = await h.UserIdAsync(@"KE\ttech");

        async Task<long> NewTask(TaskHarness.World world, string title, int? assignee = null)
        {
            var extra = new Dictionary<string, object?> { ["matterId"] = Matter, ["projectId"] = Project, ["title"] = title };
            if (assignee is { } a)
                extra["assignedUserId"] = a;
            return TaskId(await h.CreateTaskAsync(world, false, extra));
        }

        T1 = await NewTask(OpenWorld, "Open task one");
        T2 = await NewTask(SecretWorld, $"{Sentinel} secret assigned", OutsiderId);
        T3 = await NewTask(SecretWorld, $"{Sentinel} secret unassigned");
        T4 = await NewTask(OpenWorld, "Open task four", OutsiderId);
        T5 = await NewTask(OpenWorld, "Open task five", TechId);
        T6 = await NewTask(SecretWorld, $"{Sentinel} secret for the technician", TechId);
        await h.ExecuteAsync($"UPDATE dbo.Matter SET PrimaryManagerId = {OutsiderId} WHERE MatterId = {Matter}");
        (await h.Admin.PostAsJsonAsync($"/api/v1/tasks/{T3}/comments", new { bodyHtml = $"<p>{Sentinel} comment</p>" })).StatusCode.ShouldBeOneOf(HttpStatusCode.Created, HttpStatusCode.OK);

        if (restrict)
            await RestrictAsync([ReviewerRole]);

        h.Factory.InvalidateAll();
    }

    /// <summary>Replaces the Can View list of the Secret type (an empty list opens the type again), through the admin API of issue #1399.</summary>
    public Task RestrictAsync(int[] canView) => RestrictAsync(canView, [], []);

    /// <summary>Replaces the three lists of the Secret type (issue #1401): Can View, Can Edit and Can Be Assigned. An empty Edit or Assign list means no extra limit.</summary>
    public async Task RestrictAsync(int[] canView, int[] canEdit, int[] canAssign)
    {
        var current = await OkAsync(await H.Admin.GetAsync($"/api/v1/task-types/{SecretTypeId}/access"));
        await OkAsync(await H.Admin.PutAsJsonAsync($"/api/v1/task-types/{SecretTypeId}/access", new { canView, canEdit, canAssign, rowVersion = current.GetProperty("rowVersion").GetString() }));
        H.Factory.InvalidateAll();
    }
}
