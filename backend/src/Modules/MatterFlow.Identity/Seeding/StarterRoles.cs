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
        // Matter detail redesign (epic #1001): everyone works with productions, reads specs and writes notes.
        Permissions.Production.View, Permissions.Production.Edit, Permissions.Production.Comment, Permissions.ProductionSpec.View,
        Permissions.MatterNote.View, Permissions.MatterNote.Edit,
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

    /// <summary>Who maintains the specs of a matter and may delete its notes: Director, Project Manager and Pod Lead.</summary>
    private static readonly string[] MatterContentManage = [Permissions.ProductionSpec.Edit, Permissions.MatterNote.Delete];

    /// <summary>Technicians: open the Dashboard and the unassigned queue on its Summary tab (to pick work from), not the department-wide counts. Everything else on it is for leads and directors.</summary>
    private static readonly string[] DashboardUnassignedOnly = [Permissions.Dashboard.View, Permissions.Dashboard.ViewUnassigned];

    /// <summary>Dashboard Calendar (epic #1074): Director and Pod Lead open the Calendar, see absence types and manage the Out of office entries of their people.</summary>
    private static readonly string[] CalendarAccess =
        [Permissions.Dashboard.ViewCalendar, Permissions.Dashboard.ViewAbsenceReasons, Permissions.User.ManageAvailability];

    public static IReadOnlyList<StarterRole> All { get; } =
    [
        new("Director", "Department head: full operational access plus oversight.",
            [..Everyone, ..ClientMatterEdit, ..NumbersAndActivation, ..ProjectManage, ..AssignManagers, ..MatterContentManage, Permissions.Matter.ViewSensitive, Permissions.Asset.Dispose, Permissions.Pod.Manage, Permissions.Pod.ManageMembers,
                Permissions.User.View, Permissions.Audit.View,
                Permissions.Dashboard.View, Permissions.Dashboard.ViewSummary, Permissions.Dashboard.ViewBreakdowns, Permissions.Dashboard.ViewTrends,
                Permissions.Dashboard.ViewSwimlane, Permissions.Dashboard.ViewUsers, Permissions.Dashboard.ViewCoverage,
                ..CalendarAccess]),
        new("Project Manager", "Manages clients, matters and projects, can be named as a matter's project manager; works from My Matters.",
            [..Everyone, ..ClientMatterEdit, ..NumbersAndActivation, ..ProjectManage, Permissions.Matter.BeManager, ..AssignManagers, ..MatterContentManage, Permissions.Asset.Dispose]),
        new("Pod Lead", "Leads a pod: manages pod members; sees the Dashboard summary, swimlane and team workload.",
            [..Everyone, ..ClientMatterEdit, ..ProjectManage, ..MatterContentManage, Permissions.Pod.Manage, Permissions.Pod.ManageMembers,
                Permissions.Dashboard.View, Permissions.Dashboard.ViewSummary, Permissions.Dashboard.ViewSwimlane, Permissions.Dashboard.ViewUsers,
                Permissions.Dashboard.ViewCoverage, ..CalendarAccess]),
        new("Data Technician", "Works tasks and manages projects.",
            [..Everyone, ..ProjectManage, ..DashboardUnassignedOnly]),
        new("Data Scientist", "Works tasks; read access to projects.",
            [..Everyone, ..DashboardUnassignedOnly]),
    ];
}
