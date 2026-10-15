using System.Reflection;

namespace MatterFlow.SharedKernel.Results;

/// <summary>Stable error code strings (architecture section 11). Part of the public API contract and OpenAPI document.</summary>
public static class ErrorCodes
{
    public const string ValidationFailed = "VALIDATION_FAILED";
    public const string FormValidationFailed = "FORM_VALIDATION_FAILED";
    public const string InvalidNumberFormat = "INVALID_NUMBER_FORMAT";
    public const string Unauthenticated = "UNAUTHENTICATED";
    public const string AccessPending = "ACCESS_PENDING";
    public const string AccountDisabled = "ACCOUNT_DISABLED";
    public const string PermissionDenied = "PERMISSION_DENIED";
    public const string NotFound = "NOT_FOUND";
    public const string ConcurrencyConflict = "CONCURRENCY_CONFLICT";
    public const string DuplicateNumber = "DUPLICATE_NUMBER";
    public const string DuplicateName = "DUPLICATE_NAME";
    public const string MatterInactive = "MATTER_INACTIVE";
    public const string MatterHasOpenTasks = "MATTER_HAS_OPEN_TASKS";
    public const string ClientInactive = "CLIENT_INACTIVE";
    public const string ProjectInactive = "PROJECT_INACTIVE";
    public const string PodInactive = "POD_INACTIVE";
    public const string TaskNotEditable = "TASK_NOT_EDITABLE";
    public const string InvalidStatusTransition = "INVALID_STATUS_TRANSITION";
    public const string CompletionBlocked = "COMPLETION_BLOCKED";
    public const string CancelCommentRequired = "CANCEL_COMMENT_REQUIRED";
    public const string StepOrderViolation = "STEP_ORDER_VIOLATION";
    public const string StepNotSkippable = "STEP_NOT_SKIPPABLE";
    public const string SkipCommentRequired = "SKIP_COMMENT_REQUIRED";
    public const string CrossMatterReference = "CROSS_MATTER_REFERENCE";
    public const string ImmutableField = "IMMUTABLE_FIELD";
    public const string WorkflowNotEligible = "WORKFLOW_NOT_ELIGIBLE";
    public const string WorkflowNotPublished = "WORKFLOW_NOT_PUBLISHED";
    public const string FormNotPublished = "FORM_NOT_PUBLISHED";
    public const string PublishValidationFailed = "PUBLISH_VALIDATION_FAILED";
    public const string LastAdmin = "LAST_ADMIN";
    public const string RoleInUse = "ROLE_IN_USE";
    public const string EmailParseFailed = "EMAIL_PARSE_FAILED";
    public const string PayloadTooLarge = "PAYLOAD_TOO_LARGE";

    /// <summary>Addendum O: On Hold requires a comment (reason).</summary>
    public const string HoldCommentRequired = "HOLD_COMMENT_REQUIRED";

    /// <summary>A configuration item that tasks or links still reference cannot be deleted; deactivate it instead.</summary>
    public const string InUse = "IN_USE";

    /// <summary>The default configuration item cannot be deactivated or deleted; choose another default first.</summary>
    public const string DefaultRequired = "DEFAULT_REQUIRED";
    /// <summary>A form definition already has an open draft.</summary>
    public const string FormDraftExists = "FORM_DRAFT_EXISTS";

    /// <summary>A published or retired form version cannot be edited (create a new draft instead).</summary>
    public const string FormVersionImmutable = "FORM_VERSION_IMMUTABLE";


    /// <summary>A workflow already has an open draft version.</summary>
    public const string WorkflowDraftExists = "WORKFLOW_DRAFT_EXISTS";

    /// <summary>A published or retired workflow version cannot be edited (create a new draft instead).</summary>
    public const string WorkflowVersionImmutable = "WORKFLOW_VERSION_IMMUTABLE";

    /// <summary>A step tag is longer than 40 characters.</summary>
    public const string TagTooLong = "TAG_TOO_LONG";

    /// <summary>A step carries more than 20 tags.</summary>
    public const string TooManyTags = "TOO_MANY_TAGS";

    /// <summary>A step tag is empty after trimming or contains a control character.</summary>
    public const string TagInvalid = "TAG_INVALID";

    /// <summary>A new Asset cannot use an inactive Asset Type.</summary>
    public const string AssetTypeInactive = "ASSET_TYPE_INACTIVE";

    /// <summary>An inactive Asset cannot be edited; reactivate it first.</summary>
    public const string AssetInactive = "ASSET_INACTIVE";

    /// <summary>Transport-level codes for responses not produced by a feature.</summary>
    public const string UnsupportedMediaType = "UNSUPPORTED_MEDIA_TYPE";

    public const string InternalError = "INTERNAL_ERROR";
    public const string TooManyRequests = "TOO_MANY_REQUESTS";

    /// <summary>A read query ran longer than the read command timeout and was cancelled (503); narrow the filters and retry.</summary>
    public const string QueryTimeout = "QUERY_TIMEOUT";
    public const string MethodNotAllowed = "METHOD_NOT_ALLOWED";

    /// <summary>Every code, in declaration order. Used to emit the OpenAPI enum.</summary>
    public static IReadOnlyList<string> All { get; } =
        typeof(ErrorCodes)
            .GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(f => f.IsLiteral && f.FieldType == typeof(string))
            .OrderBy(f => f.MetadataToken)
            .Select(f => (string)f.GetRawConstantValue()!)
            .ToArray();
}
