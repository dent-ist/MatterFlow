namespace MatterFlow.Configuration.Contracts.Forms;

/// <summary>What owns a form definition (the <c>Scope</c> of the form, docs/erd.md section 6).</summary>
public enum FormOwnerKind
{
    /// <summary>The request form of a Task Type; <c>OwnerId</c> is the Task Type id.</summary>
    TaskType,

    /// <summary>The input form of a Step Definition; <c>OwnerId</c> is the Step Definition id.</summary>
    Step,

    /// <summary>The type-specific fields of an Asset Type; <c>OwnerId</c> is the Asset Type id.</summary>
    AssetType,

    /// <summary>The singleton custom-field form of Clients (no owner id).</summary>
    Client,

    /// <summary>The singleton custom-field form of Matters (no owner id).</summary>
    Matter,

    /// <summary>The singleton custom-field form of Projects (no owner id).</summary>
    Project,
}

/// <summary>Lifecycle of one form version.</summary>
public enum FormVersionStatus
{
    /// <summary>Editable; at most one per definition.</summary>
    Draft,

    /// <summary>Immutable and in use by new submissions; at most one per definition.</summary>
    Published,

    /// <summary>Immutable and superseded; still readable forever.</summary>
    Retired,
}

/// <summary>The kind of object whose submitted values are stored with a form version.</summary>
public enum FormValueOwnerKind
{
    /// <summary>A Task (request form).</summary>
    Task,

    /// <summary>A Step Instance (step inputs; not filter-indexed).</summary>
    StepInstance,

    /// <summary>A Client.</summary>
    Client,

    /// <summary>A Matter.</summary>
    Matter,

    /// <summary>A Project.</summary>
    Project,

    /// <summary>An Asset (type-specific fields).</summary>
    Asset,
}

/// <summary>Whether REQUIRED is enforced when validating submitted values.</summary>
public enum FormSubmissionMode
{
    /// <summary>Full validation (default).</summary>
    Submit,

    /// <summary>Same, except REQUIRED is not reported (work in progress).</summary>
    Draft,
}
