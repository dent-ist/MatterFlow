using System.Globalization;
using System.Text;

namespace MatterFlow.Notifications.Contracts;

/// <summary>
/// The wording of every notification (README section 3.1), built by the server at creation time as a snapshot: English, at most
/// <see cref="MaxLength"/> characters, plain text without HTML or line breaks. Titles longer than <see cref="TitleLimit"/> characters are cut with an
/// ellipsis. Every message is reason first, <c>reason - TSK-n "title" on matter</c>, with no trailing full stop (owner request: the bell shows the first
/// words, so the reason is what a person reads first). A person is named only where the reason is about a person (a comment or a mention). Pure functions, no lookups.
/// </summary>
public static class NotificationMessages
{
    public const int MaxLength = 300;
    public const int TitleLimit = 60;
    public const int ExcerptLimit = 80;

    private const string Ellipsis = "…";

    /// <summary>1. <c>Assigned to you - TSK-1042 "Review privilege log" on Acme v. Smith</c> (<c>Reassigned to you</c> when the task had another assignee).</summary>
    public static string TaskAssigned(string taskNumber, string title, string matterName, bool reassigned = false) =>
        Finish($"{(reassigned ? "Reassigned to you" : "Assigned to you")} - {Subject(taskNumber, title, matterName)}");

    /// <summary>2 soon. <c>Due tomorrow - TSK-1042 "Review privilege log" on Acme v. Smith</c> or <c>Due today - ...</c></summary>
    public static string TaskDueSoon(string taskNumber, string title, string matterName, DateOnly dueDate, DateOnly today) =>
        Finish($"{(dueDate <= today ? "Due today" : "Due tomorrow")} - {Subject(taskNumber, title, matterName)}");

    /// <summary>2 overdue. <c>Overdue by 3 days - TSK-1042 "Review privilege log" on Acme v. Smith</c> (<c>Overdue</c> alone when it became overdue today, by its time).</summary>
    public static string TaskOverdue(string taskNumber, string title, string matterName, DateOnly dueDate, DateOnly today) =>
        Finish($"{OverdueReason(dueDate, today)} - {Subject(taskNumber, title, matterName)}");

    /// <summary>3 comment. <c>New comment from Ann Lee - TSK-1042 "Review privilege log" on Acme v. Smith</c> (the comment text is not repeated; the task Activity has it).</summary>
    public static string TaskComment(string actorName, string taskNumber, string title, string matterName) =>
        Finish($"New comment from {Name(actorName)} - {Subject(taskNumber, title, matterName)}");

    /// <summary>3 mention. <c>Mentioned by Ann Lee - TSK-1042 "Review privilege log" on Acme v. Smith</c></summary>
    public static string TaskMention(string actorName, string taskNumber, string title, string matterName) =>
        Finish($"Mentioned by {Name(actorName)} - {Subject(taskNumber, title, matterName)}");

    /// <summary>4. <c>Overdue by 3 days - TSK-1042 "Review privilege log" on Acme v. Smith</c> (to the matter's managers).</summary>
    public static string MatterTaskOverdue(string taskNumber, string title, string matterName, DateOnly dueDate, DateOnly today) =>
        Finish($"{OverdueReason(dueDate, today)} - {Subject(taskNumber, title, matterName)}");

    /// <summary>5. <c>New task on your matter - TSK-1051 "Load production volume 3" on Acme v. Smith</c></summary>
    public static string MatterTaskCreated(string taskNumber, string title, string matterName) =>
        Finish($"New task on your matter - {Subject(taskNumber, title, matterName)}");

    /// <summary>6 unassigned. <c>Unassigned for 2 days - TSK-1042 "Review privilege log" on Acme v. Smith</c></summary>
    public static string MatterTaskUnassigned(string taskNumber, string title, string matterName, int days) =>
        Finish($"Unassigned for {Days(days)} - {Subject(taskNumber, title, matterName)}");

    /// <summary>6 on hold. <c>On hold for 5 days - TSK-1042 "Review privilege log" on Acme v. Smith</c></summary>
    public static string MatterTaskOnHold(string taskNumber, string title, string matterName, int days) =>
        Finish($"On hold for {Days(days)} - {Subject(taskNumber, title, matterName)}");

    /// <summary>7. <c>You are now Primary manager - Acme v. Smith</c> (<c>Secondary manager</c>); the matter name takes the place of the task.</summary>
    public static string MatterManagerSet(bool primary, string matterName) =>
        Finish($"You are now {(primary ? "Primary" : "Secondary")} manager - {Name(matterName)}");

    /// <summary>8. <c>Unassigned in Demo Processing Pod - TSK-1042 "Review privilege log" on Acme v. Smith</c></summary>
    public static string PodTaskUnassigned(string taskNumber, string title, string matterName, string podName) =>
        Finish($"Unassigned in {Name(podName)} - {Subject(taskNumber, title, matterName)}");

    /// <summary>The task part every message ends with: <c>TSK-1042 "Review privilege log" on Acme v. Smith</c>.</summary>
    private static string Subject(string taskNumber, string title, string matterName) => $"{taskNumber} \"{Title(title)}\" on {Name(matterName)}";

    private static string OverdueReason(DateOnly dueDate, DateOnly today)
    {
        var late = today.DayNumber - dueDate.DayNumber;
        return late <= 0 ? "Overdue" : $"Overdue by {Days(late)}";
    }

    private static string Days(int days) => days == 1 ? "1 day" : $"{days.ToString(CultureInfo.InvariantCulture)} days";

    /// <summary>Short date used in the messages: <c>Oct 23</c>.</summary>
    public static string ShortDate(DateOnly date) => date.ToString("MMM d", CultureInfo.InvariantCulture);

    /// <summary>A title cut to <see cref="TitleLimit"/> characters with an ellipsis.</summary>
    public static string Title(string? title) => Clip(Plain(title), TitleLimit);

    /// <summary>A comment excerpt: whitespace collapsed, at most <see cref="ExcerptLimit"/> characters with the closing "..." included.</summary>
    public static string Excerpt(string? text)
    {
        var plain = Plain(text);
        return plain.Length <= ExcerptLimit ? plain : plain[..(ExcerptLimit - 3)].TrimEnd() + "...";
    }

    private static string Name(string? value) => Plain(value);

    private static string Clip(string value, int limit) =>
        value.Length <= limit ? value : value[..(limit - 1)].TrimEnd() + Ellipsis;

    /// <summary>Single line: control characters and angle brackets removed, whitespace collapsed (the text is never HTML).</summary>
    private static string Plain(string? value)
    {
        if (string.IsNullOrEmpty(value))
            return string.Empty;

        var sb = new StringBuilder(value.Length);
        var pendingSpace = false;
        foreach (var ch in value)
        {
            if (char.IsWhiteSpace(ch) || char.IsControl(ch))
            {
                pendingSpace = sb.Length > 0;
                continue;
            }

            if (ch is '<' or '>')
                continue;

            if (pendingSpace)
            {
                sb.Append(' ');
                pendingSpace = false;
            }

            sb.Append(ch);
        }

        return sb.ToString();
    }

    private static string Finish(string message) =>
        message.Length <= MaxLength ? message : message[..(MaxLength - 1)].TrimEnd() + Ellipsis;
}
