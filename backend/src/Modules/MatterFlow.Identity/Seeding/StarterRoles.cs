using MatterFlow.Identity.Contracts;

namespace MatterFlow.Identity.Seeding;

/// <summary>A starter role and its default grants.</summary>
public sealed record StarterRole(string Name, string Description, IReadOnlyList<string> Permissions);

/// <summary>
/// The starter role matrix of docs/architecture.md 6.3. Seeded once (only when no non-system role exists) and editable afterwards;
/// configuration and user management are System Admin only by default.
/// </summary>
public static class StarterRoles
{
    private static readonly string[] ViewAll =
    [
        Permissions.Client.View, Permissions.Matter.View, Permissions.Project.View, Permissions.Asset.View,
    ];

    private static readonly string[] Everyone =
    [
        ..ViewAll,
        Permissions.Asset.Create, Permissions.Asset.Edit, Permissions.Asset.Link,
        Permissions.Task.View, Permissions.Task.Create, Permissions.Task.Comment,
        Permissions.Task.Edit, Permissions.Task.Assign, Permissions.Task.SetPriority, Permissions.Task.ChangeStatus,
        Permissions.Task.Complete, Permissions.Task.Cancel, Permissions.Task.Reopen,
        Permissions.Workflow.Execute, Permissions.Workflow.StepReopen,
        Permissions.Pod.View,
    ];

    private static readonly string[] ClientMatterEdit =
    [
        Permissions.Client.Create, Permissions.Client.Edit, Permissions.Matter.Create, Permissions.Matter.Edit,
    ];

    private static readonly string[] ProjectManage =
    [
        Permissions.Project.Create, Permissions.Project.Edit, Permissions.Project.Archive,
    ];

    /// <summary>Project Manager epic (#667): who may change a matter's managers (Director and Project Manager by default; administrators can take it away).</summary>
    private static readonly string[] AssignManagers = [Permissions.Matter.AssignManagers];

    private static readonly string[] NumbersAndActivation =
    [
        Permissions.Client.EditNumber, Permissions.Matter.EditNumber, Permissions.Matter.SetActive,
    ];

    /// <summary>Technicians: open the Dashboard and the unassigned queue on its Summary tab (to pick work from), not the department-wide counts. Everything else on it is for leads and directors.</summary>
    private static readonly string[] DashboardUnassignedOnly = [Permissions.Dashboard.View, Permissions.Dashboard.ViewUnassigned];

    public static IReadOnlyList<StarterRole> All { get; } =
    [
        new("Director", "Department head: full operational access plus oversight.",
            [..Everyone, ..ClientMatterEdit, ..NumbersAndActivation, ..ProjectManage, ..AssignManagers, Permissions.Matter.ViewSensitive, Permissions.Pod.Manage, Permissions.Pod.ManageMembers,
                Permissions.User.View, Permissions.Audit.View,
                Permissions.Dashboard.View, Permissions.Dashboard.ViewSummary, Permissions.Dashboard.ViewBreakdowns, Permissions.Dashboard.ViewTrends,
                Permissions.Dashboard.ViewSwimlane, Permissions.Dashboard.ViewUsers, Permissions.Dashboard.ViewCoverage]),
        new("Project Manager", "Manages clients, matters and projects, can be named as a matter's project manager; works from My Matters.",
            [..Everyone, ..ClientMatterEdit, ..NumbersAndActivation, ..ProjectManage, Permissions.Matter.BeManager, ..AssignManagers]),
        new("Pod Lead", "Leads a pod: manages pod members; sees the Dashboard summary, swimlane and team workload.",
            [..Everyone, ..ClientMatterEdit, ..ProjectManage, Permissions.Pod.Manage, Permissions.Pod.ManageMembers,
                Permissions.Dashboard.View, Permissions.Dashboard.ViewSummary, Permissions.Dashboard.ViewSwimlane, Permissions.Dashboard.ViewUsers,
                Permissions.Dashboard.ViewCoverage]),
        new("Data Technician", "Works tasks and manages projects.",
            [..Everyone, ..ProjectManage, ..DashboardUnassignedOnly]),
        new("Data Scientist", "Works tasks; read access to projects.",
            [..Everyone, ..DashboardUnassignedOnly]),
    ];
}
