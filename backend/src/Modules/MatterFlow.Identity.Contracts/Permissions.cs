namespace MatterFlow.Identity.Contracts;

/// <summary>
/// Permission codes. The catalog lives in <c>contracts/permissions.json</c> (source of truth, architecture 6.3);
/// a unit test fails when this file and the JSON disagree. Use these constants with <c>[RequirePermission]</c>.
/// </summary>
public static class Permissions
{
    /// <summary>Client permissions.</summary>
    public static class Client
    {
        /// <summary>View clients.</summary>
        public const string View = "Client.View";

        /// <summary>Create clients.</summary>
        public const string Create = "Client.Create";

        /// <summary>Edit client details.</summary>
        public const string Edit = "Client.Edit";

        /// <summary>Change a client number.</summary>
        public const string EditNumber = "Client.EditNumber";
    }

    /// <summary>Matter permissions.</summary>
    public static class Matter
    {
        /// <summary>View matters.</summary>
        public const string View = "Matter.View";

        /// <summary>Create matters.</summary>
        public const string Create = "Matter.Create";

        /// <summary>Edit matter details.</summary>
        public const string Edit = "Matter.Edit";

        /// <summary>Change a matter number.</summary>
        public const string EditNumber = "Matter.EditNumber";

        /// <summary>Activate or deactivate matters.</summary>
        public const string SetActive = "Matter.SetActive";
    }

    /// <summary>Project permissions.</summary>
    public static class Project
    {
        /// <summary>View projects.</summary>
        public const string View = "Project.View";

        /// <summary>Create projects.</summary>
        public const string Create = "Project.Create";

        /// <summary>Edit projects.</summary>
        public const string Edit = "Project.Edit";

        /// <summary>Archive and unarchive projects.</summary>
        public const string Archive = "Project.Archive";
    }

    /// <summary>Task permissions.</summary>
    public static class Task
    {
        /// <summary>View tasks.</summary>
        public const string View = "Task.View";

        /// <summary>Create tasks.</summary>
        public const string Create = "Task.Create";

        /// <summary>Edit task details.</summary>
        public const string Edit = "Task.Edit";

        /// <summary>Assign or reassign tasks to pods and users.</summary>
        public const string Assign = "Task.Assign";

        /// <summary>Set task priority.</summary>
        public const string SetPriority = "Task.SetPriority";

        /// <summary>Change task status (start, hold, resume).</summary>
        public const string ChangeStatus = "Task.ChangeStatus";

        /// <summary>Complete tasks.</summary>
        public const string Complete = "Task.Complete";

        /// <summary>Cancel tasks.</summary>
        public const string Cancel = "Task.Cancel";

        /// <summary>Reopen completed or cancelled tasks.</summary>
        public const string Reopen = "Task.Reopen";

        /// <summary>Add task comments.</summary>
        public const string Comment = "Task.Comment";
    }

    /// <summary>Workflow permissions.</summary>
    public static class Workflow
    {
        /// <summary>Start, fill in, complete and skip workflow steps.</summary>
        public const string Execute = "Workflow.Execute";

        /// <summary>Reopen a completed workflow step.</summary>
        public const string StepReopen = "Workflow.StepReopen";

        /// <summary>Manage step definitions and workflows.</summary>
        public const string Manage = "Workflow.Manage";
    }

    /// <summary>Asset permissions.</summary>
    public static class Asset
    {
        /// <summary>View assets.</summary>
        public const string View = "Asset.View";

        /// <summary>Create assets.</summary>
        public const string Create = "Asset.Create";

        /// <summary>Edit assets.</summary>
        public const string Edit = "Asset.Edit";

        /// <summary>Link assets to tasks.</summary>
        public const string Link = "Asset.Link";
    }

    /// <summary>Pod permissions.</summary>
    public static class Pod
    {
        /// <summary>View pods.</summary>
        public const string View = "Pod.View";

        /// <summary>Create, edit and deactivate pods.</summary>
        public const string Manage = "Pod.Manage";

        /// <summary>Manage pod membership.</summary>
        public const string ManageMembers = "Pod.ManageMembers";
    }

    /// <summary>User permissions.</summary>
    public static class User
    {
        /// <summary>View the user list and access queue.</summary>
        public const string View = "User.View";

        /// <summary>Activate or disable users and assign roles.</summary>
        public const string Manage = "User.Manage";
    }

    /// <summary>Role permissions.</summary>
    public static class Role
    {
        /// <summary>Create and edit roles and their permissions.</summary>
        public const string Manage = "Role.Manage";
    }

    /// <summary>TaskType permissions.</summary>
    public static class TaskType
    {
        /// <summary>Manage task types and their workflows.</summary>
        public const string Manage = "TaskType.Manage";
    }

    /// <summary>AssetType permissions.</summary>
    public static class AssetType
    {
        /// <summary>Manage asset types and asset link roles.</summary>
        public const string Manage = "AssetType.Manage";
    }

    /// <summary>CustomField permissions.</summary>
    public static class CustomField
    {
        /// <summary>Manage client, matter and project custom fields.</summary>
        public const string Manage = "CustomField.Manage";
    }

    /// <summary>Priority permissions.</summary>
    public static class Priority
    {
        /// <summary>Manage priorities.</summary>
        public const string Manage = "Priority.Manage";
    }

    /// <summary>StatusLabel permissions.</summary>
    public static class StatusLabel
    {
        /// <summary>Manage task status labels.</summary>
        public const string Manage = "StatusLabel.Manage";
    }

    /// <summary>
    /// Dashboard permissions. <see cref="View"/> opens the Dashboard (navigation item and route); each tab permission shows one tab and only has effect together
    /// with <see cref="View"/> (the role editor selects and clears them together, the server requires both).
    /// </summary>
    public static class Dashboard
    {
        /// <summary>Open the Dashboard. Needed for every tab.</summary>
        public const string View = "Dashboard.View";

        /// <summary>Summary tab: the headline counts and tiles, the overdue and due soon lists, and (with Task.Assign) the unassigned queue.</summary>
        public const string ViewSummary = "Dashboard.ViewSummary";

        /// <summary>
        /// Summary tab, unassigned queue only: the list of Tasks nobody is assigned to (to pick work from), without the department-wide counts, the
        /// Needs attention and Overview tiles or the Overdue and Due soon lists, which need <see cref="ViewSummary"/>. Needs <see cref="View"/> too.
        /// </summary>
        public const string ViewUnassigned = "Dashboard.ViewUnassigned";

        /// <summary>Breakdowns tab: open Tasks by priority, task type and status, and their age.</summary>
        public const string ViewBreakdowns = "Dashboard.ViewBreakdowns";

        /// <summary>Trends tab: Tasks created and completed per day.</summary>
        public const string ViewTrends = "Dashboard.ViewTrends";

        /// <summary>Swimlane tab: the board of every open Task by status.</summary>
        public const string ViewSwimlane = "Dashboard.ViewSwimlane";

        /// <summary>Users tab: team workload per person.</summary>
        public const string ViewUsers = "Dashboard.ViewUsers";

        /// <summary>See how many tasks each person completed per task type (training and coverage planning). Needs <see cref="View"/> too.</summary>
        public const string ViewCoverage = "Dashboard.ViewCoverage";
    }

    /// <summary>Audit permissions.</summary>
    public static class Audit
    {
        /// <summary>Browse the audit log.</summary>
        public const string View = "Audit.View";
    }

    /// <summary>Every permission code, in catalog order.</summary>
    public static IReadOnlyList<string> All { get; } =
    [
        Client.View,
        Client.Create,
        Client.Edit,
        Client.EditNumber,
        Matter.View,
        Matter.Create,
        Matter.Edit,
        Matter.EditNumber,
        Matter.SetActive,
        Project.View,
        Project.Create,
        Project.Edit,
        Project.Archive,
        Task.View,
        Task.Create,
        Task.Edit,
        Task.Assign,
        Task.SetPriority,
        Task.ChangeStatus,
        Task.Complete,
        Task.Cancel,
        Task.Reopen,
        Task.Comment,
        Workflow.Execute,
        Workflow.StepReopen,
        Workflow.Manage,
        Asset.View,
        Asset.Create,
        Asset.Edit,
        Asset.Link,
        Pod.View,
        Pod.Manage,
        Pod.ManageMembers,
        User.View,
        User.Manage,
        Role.Manage,
        TaskType.Manage,
        AssetType.Manage,
        CustomField.Manage,
        Priority.Manage,
        StatusLabel.Manage,
        Dashboard.View,
        Dashboard.ViewSummary,
        Dashboard.ViewUnassigned,
        Dashboard.ViewBreakdowns,
        Dashboard.ViewTrends,
        Dashboard.ViewSwimlane,
        Dashboard.ViewUsers,
        Dashboard.ViewCoverage,
        Audit.View,
    ];
}
