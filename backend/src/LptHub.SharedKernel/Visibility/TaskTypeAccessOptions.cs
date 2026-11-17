namespace LptHub.SharedKernel.Visibility;

/// <summary>
/// The go-live switch of the Task Type access rule (<c>Features:TaskTypeAccess</c>, default false; epic #1397, design docs/ux/task-type-access/README.md).
/// While it is off nothing is enforced: behaviour is exactly the behaviour before the epic. The role lists of a Task Type can still be edited and stored
/// while it is off (the administrator prepares them before go-live); they only take effect once the owner turns the switch on. Issue #1399 only
/// stores the lists and exposes this switch (the admin API reports it as <c>enforced</c>); the read-path filtering is issue #1400 and the edit and
/// assign rules are issue #1401. Read at start (recycle the app pool after a change).
/// </summary>
public sealed class TaskTypeAccessOptions
{
    public const string Section = "Features";

    /// <summary>True when the rule is enforced.</summary>
    public bool TaskTypeAccess { get; set; }
}
