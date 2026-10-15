using System.Text.Json;

namespace MatterFlow.Audit.Application;

/// <summary>
/// Words a task assignment event the way the Task activity timeline does ("Assigned to Dana P. (Pod A)", "Reassigned from Pod A (pod) to
/// Dana P. (Pod A)", "Unassigned from Dana P. (Pod A)"). The stored old and new values are <c>{"podId":2,"userId":9}</c> documents. Pure.
/// </summary>
internal static class AuditAssignmentText
{
    /// <summary>User and Pod ids named by an assignment value, so the caller can look the names up once for a page.</summary>
    public static (int? PodId, int? UserId) Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return (null, null);

        try
        {
            using var doc = JsonDocument.Parse(json);
            int? Read(string name) =>
                doc.RootElement.ValueKind == JsonValueKind.Object
                && doc.RootElement.TryGetProperty(name, out var p)
                && p.ValueKind == JsonValueKind.Number
                && p.TryGetInt32(out var v)
                    ? v
                    : null;
            return (Read("podId"), Read("userId"));
        }
        catch (JsonException)
        {
            return (null, null);
        }
    }

    public static string Describe(string? oldValue, string? newValue, IReadOnlyDictionary<int, string> users, IReadOnlyDictionary<int, string> pods)
    {
        var from = Who(Parse(oldValue), users, pods);
        var to = Who(Parse(newValue), users, pods);
        if (to is null)
            return from is null ? "Assignment cleared" : $"Unassigned from {from}";
        return from is null ? $"Assigned to {to}" : $"Reassigned from {from} to {to}";
    }

    private static string? Who((int? PodId, int? UserId) value, IReadOnlyDictionary<int, string> users, IReadOnlyDictionary<int, string> pods)
    {
        var user = value.UserId is { } u ? (users.TryGetValue(u, out var n) ? n : "an unknown user") : null;
        var pod = value.PodId is { } p ? (pods.TryGetValue(p, out var pn) ? pn : "an unknown pod") : null;
        return (user, pod) switch
        {
            (null, null) => null,
            (not null, null) => user,
            (null, not null) => $"{pod} (pod)",
            _ => $"{user} ({pod})",
        };
    }
}
