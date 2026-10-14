using System.Globalization;
using MatterFlow.Audit.Contracts;
using MatterFlow.SharedKernel.Tasks;

namespace MatterFlow.Audit.Application;

/// <summary>
/// One readable sentence per audit event for the browser, in the wording of the Task activity timeline ("Status changed from In Progress to
/// On Hold", "Priority changed from Normal to High", "Step Intake review completed (bulk)"). Pure; never repeats a value that was masked.
/// </summary>
internal static class AuditSummaryComposer
{
    private const int ValueClip = 80;

    public static string Compose(string eventType, string? fieldKey, string? oldValue, string? newValue, string? summary, bool valuesHidden)
    {
        switch (eventType)
        {
            case AuditEventTypes.TaskStatusChanged when !valuesHidden:
                {
                    var from = StatusLabel(oldValue);
                    var to = StatusLabel(newValue);
                    return from is null ? $"Status set to {to}" : $"Status changed from {from} to {to}";
                }

            case AuditEventTypes.FieldChanged:
                return FieldChange(fieldKey, oldValue, newValue, valuesHidden);
            case AuditEventTypes.TaskAssigned:
                return "Task assignment changed";
        }

        if (!string.IsNullOrWhiteSpace(summary))
            return Sentence(summary.Replace("(bulk=true)", "(bulk)", StringComparison.Ordinal).Replace(" (bulk=false)", string.Empty, StringComparison.Ordinal));

        return Humanize(eventType);
    }

    /// <summary>"form:billing_code" becomes "Billing code"; "ClientNumber" becomes "Client number".</summary>
    public static string FieldLabel(string? key)
    {
        if (string.IsNullOrWhiteSpace(key))
            return "Field";

        var name = key.StartsWith("form:", StringComparison.Ordinal) ? key[5..] : key;
        var words = new System.Text.StringBuilder();
        for (var i = 0; i < name.Length; i++)
        {
            var c = name[i];
            if (c == '_')
                words.Append(' ');
            else if (char.IsUpper(c) && i > 0 && char.IsLower(name[i - 1]))
                words.Append(' ').Append(char.ToLowerInvariant(c));
            else
                words.Append(i == 0 ? c : char.ToLowerInvariant(c));
        }

        var text = words.ToString().Trim();
        return text.Length == 0 ? "Field" : char.ToUpper(text[0], CultureInfo.InvariantCulture) + text[1..];
    }

    private static string FieldChange(string? key, string? oldValue, string? newValue, bool valuesHidden)
    {
        var label = FieldLabel(key);
        if (valuesHidden)
            return $"{label} changed";
        if (key == "description")
            return "Description changed";
        if (string.IsNullOrEmpty(oldValue) && !string.IsNullOrEmpty(newValue))
            return $"{label} set to {Clip(newValue)}";
        if (!string.IsNullOrEmpty(oldValue) && string.IsNullOrEmpty(newValue))
            return $"{label} cleared";
        return $"{label} changed from {Clip(oldValue)} to {Clip(newValue)}";
    }

    private static string? StatusLabel(string? code) =>
        code is null
            ? null
            : TaskStatusCodeExtensions.TryParse(code, out var status)
                ? status switch
                {
                    TaskStatusCode.New => "New",
                    TaskStatusCode.InProgress => "In Progress",
                    TaskStatusCode.OnHold => "On Hold",
                    TaskStatusCode.Completed => "Completed",
                    _ => "Cancelled",
                }
                : code;

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
        return words.Length == 0 ? "Event" : char.ToUpper(words[0], CultureInfo.InvariantCulture) + words[1..];
    }
}
