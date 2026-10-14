using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using MatterFlow.Audit.Contracts;
using MatterFlow.SharedKernel.Tasks;

namespace MatterFlow.WorkManagement.Application;

/// <summary>Display names the narrator needs, loaded by the caller for one page of events.</summary>
internal sealed record ActivityNames(
    IReadOnlyDictionary<int, string> Users,
    IReadOnlyDictionary<int, string> Pods,
    IReadOnlyDictionary<string, string> StatusLabels);

/// <summary>A narrated audit event: category, readable sentence and readable old/new values.</summary>
internal sealed record Narration(string Category, string Summary, string? OldValue, string? NewValue);

/// <summary>
/// Turns the raw audit events of a Task into readable timeline sentences (ticket 45, activity read): "Status changed from In Progress to On Hold",
/// "Priority changed from Normal to High", "Assigned to Dana P. (Pod A)", "Step Intake review completed (bulk)". Pure: all lookups are passed in.
/// </summary>
internal static partial class TaskActivityNarrator
{
    public const string Task = "TASK";
    public const string Status = "STATUS";
    public const string Assignment = "ASSIGNMENT";
    public const string Fields = "FIELDS";
    public const string Workflow = "WORKFLOW";
    public const string Comments = "COMMENTS";
    public const string Assets = "ASSETS";

    private const int ValueClip = 80;

    private static readonly Dictionary<string, string> FieldLabels = new(StringComparer.Ordinal)
    {
        ["title"] = "Title",
        ["description"] = "Description",
        ["requestorName"] = "Requestor name",
        ["requestorEmail"] = "Requestor email",
        ["requestedAt"] = "Requested date",
        ["dueDate"] = "Due date",
        ["dueAtUtc"] = "Due time",
        ["project"] = "Project",
        ["priority"] = "Priority",
    };

    public static Narration Narrate(AuditRecord e, ActivityNames names, bool includeValues = true)
    {
        switch (e.EventType)
        {
            case AuditEventTypes.TaskCreated:
                return new(Task, e.Summary is { Length: > 0 } created ? Sentence(created) : "Task created", null, null);
            case AuditEventTypes.TaskStatusChanged:
                {
                    var from = Label(e.OldValue, names);
                    var to = Label(e.NewValue, names);
                    var text = from is null ? $"Status set to {to}" : $"Status changed from {from} to {to}";
                    return new(Status, text, from, to);
                }

            case AuditEventTypes.TaskAssigned:
                return Assigned(e, names);
            case AuditEventTypes.FieldChanged:
                return FieldChange(e, includeValues);
            case "FORM_VALUES_DROPPED":
                return new(Fields, e.Summary is { Length: > 0 } dropped ? Sentence(dropped) : "Hidden form values were dropped", null, null);
            case TaskSupport.CommentAddedEvent:
                return new(Comments, e.NewValue switch { "CANCEL" => "Cancellation reason added", "ON_HOLD" => "On hold reason added", _ => "Comment added" }, null, null);
            case TaskSupport.CommentEditedEvent:
                return new(Comments, "Comment edited", null, null);
            case TaskSupport.CommentDeletedEvent:
                return new(Comments, "Comment deleted", null, null);
            case TaskSupport.AssetLinkedEvent:
            case TaskSupport.AssetUnlinkedEvent:
            case TaskSupport.AssetRoleChangedEvent:
                return new(Assets, e.Summary is { Length: > 0 } asset ? Sentence(asset) : Humanize(e.EventType), e.OldValue, e.NewValue);
            case AuditEventTypes.StepCompleted:
            case AuditEventTypes.StepSkipped:
            case AuditEventTypes.StepReopened:
            case "STEP_STARTED":
            case "STEP_VALUES_EDITED":
                return new(Workflow, StepSentence(e), null, null);
            default:
                return new(Task, e.Summary is { Length: > 0 } other ? Sentence(other) : Humanize(e.EventType), null, null);
        }
    }

    /// <summary>"Step 'Intake review' completed (bulk=true)" becomes "Step Intake review completed (bulk)".</summary>
    internal static string StepSentence(AuditRecord e)
    {
        var summary = e.Summary;
        if (string.IsNullOrWhiteSpace(summary))
            return Humanize(e.EventType);

        var match = StepPattern().Match(summary);
        var text = match.Success ? $"Step {match.Groups["title"].Value} {match.Groups["rest"].Value}" : summary;
        text = text.Replace("(bulk=true)", "(bulk)", StringComparison.Ordinal).Replace(" (bulk=false)", string.Empty, StringComparison.Ordinal);
        return Sentence(text);
    }

    private static Narration Assigned(AuditRecord e, ActivityNames names)
    {
        var (oldPod, oldUser) = ParseAssignment(e.OldValue);
        var (newPod, newUser) = ParseAssignment(e.NewValue);
        var oldText = Who(oldPod, oldUser, names);
        var newText = Who(newPod, newUser, names);
        string text;
        if (newText is null)
            text = oldText is null ? "Assignment cleared" : $"Unassigned from {oldText}";
        else if (oldText is null)
            text = $"Assigned to {newText}";
        else
            text = $"Reassigned from {oldText} to {newText}";

        return new(Assignment, text, oldText, newText);
    }

    /// <summary>
    /// The sentence of a field change. Without <paramref name="includeValues"/> (the caller lacks Audit.View) it names the field only, so the
    /// always-returned sentence cannot reveal what the value was before (SEC2-06).
    /// </summary>
    private static Narration FieldChange(AuditRecord e, bool includeValues)
    {
        var key = e.FieldKey ?? string.Empty;
        var label = FieldLabel(key);
        string text;
        if (key == "description")
            text = "Description changed";
        else if (!includeValues)
            text = string.IsNullOrEmpty(e.NewValue) ? $"{label} cleared" : string.IsNullOrEmpty(e.OldValue) ? $"{label} set" : $"{label} changed";
        else if (string.IsNullOrEmpty(e.OldValue) && !string.IsNullOrEmpty(e.NewValue))
            text = $"{label} set to {Clip(e.NewValue)}";
        else if (!string.IsNullOrEmpty(e.OldValue) && string.IsNullOrEmpty(e.NewValue))
            text = key == "dueDate" ? "Due date cleared (ASAP)" : $"{label} cleared";
        else
            text = $"{label} changed from {Clip(e.OldValue)} to {Clip(e.NewValue)}";

        return new(Fields, text, e.OldValue, e.NewValue);
    }

    private static string FieldLabel(string key)
    {
        if (FieldLabels.TryGetValue(key, out var label))
            return label;

        var name = key.StartsWith("form:", StringComparison.Ordinal) ? key[5..] : key;
        var words = name.Replace('_', ' ').Trim();
        return words.Length == 0 ? "Field" : char.ToUpper(words[0], CultureInfo.InvariantCulture) + words[1..];
    }

    private static string? Label(string? code, ActivityNames names) =>
        code is null ? null : names.StatusLabels.TryGetValue(code, out var label) ? label : DefaultLabel(code);

    private static string DefaultLabel(string code) =>
        TaskStatusCodeExtensions.TryParse(code, out var status)
            ? status switch
            {
                TaskStatusCode.New => "New",
                TaskStatusCode.InProgress => "In Progress",
                TaskStatusCode.OnHold => "On Hold",
                TaskStatusCode.Completed => "Completed",
                _ => "Cancelled",
            }
            : code;

    private static (int? Pod, int? User) ParseAssignment(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return (null, null);

        try
        {
            using var doc = JsonDocument.Parse(json);
            int? Read(string name) =>
                doc.RootElement.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.Number && p.TryGetInt32(out var v) ? v : null;
            return (Read("podId"), Read("userId"));
        }
        catch (JsonException)
        {
            return (null, null);
        }
    }

    private static string? Who(int? podId, int? userId, ActivityNames names)
    {
        var user = userId is { } u ? (names.Users.TryGetValue(u, out var n) ? n : "an unknown user") : null;
        var pod = podId is { } p ? (names.Pods.TryGetValue(p, out var pn) ? pn : "an unknown pod") : null;
        return (user, pod) switch
        {
            (null, null) => null,
            (not null, null) => user,
            (null, not null) => $"{pod} (pod)",
            _ => $"{user} ({pod})",
        };
    }

    /// <summary>User and Pod ids named by assignment events, so the caller can load their names once.</summary>
    public static (IReadOnlyList<int> UserIds, IReadOnlyList<int> PodIds) AssignmentIds(IEnumerable<AuditRecord> events)
    {
        var users = new HashSet<int>();
        var pods = new HashSet<int>();
        foreach (var e in events.Where(x => x.EventType == AuditEventTypes.TaskAssigned))
        {
            foreach (var json in new[] { e.OldValue, e.NewValue })
            {
                var (pod, user) = ParseAssignment(json);
                if (pod is { } p)
                    pods.Add(p);
                if (user is { } u)
                    users.Add(u);
            }
        }

        return ([.. users], [.. pods]);
    }

    private static string Clip(string? value)
    {
        var text = string.IsNullOrEmpty(value) ? "none" : value.Trim();
        return text.Length <= ValueClip ? text : text[..ValueClip] + "...";
    }

    private static string Sentence(string text)
    {
        var trimmed = text.Trim();
        return trimmed.Length == 0 ? trimmed : char.ToUpper(trimmed[0], CultureInfo.InvariantCulture) + trimmed[1..];
    }

    private static string Humanize(string eventType)
    {
        var words = eventType.Replace('_', ' ').ToLowerInvariant();
        return char.ToUpper(words[0], CultureInfo.InvariantCulture) + words[1..];
    }

    [GeneratedRegex(@"^Step '(?<title>.*)' (?<rest>(started|completed|skipped|reopened|values edited).*)$", RegexOptions.CultureInvariant | RegexOptions.Singleline)]
    private static partial Regex StepPattern();
}
