using System.Globalization;
using System.Text;

namespace MatterFlow.Notifications.Contracts;

/// <summary>
/// The wording of every notification (README section 3.1), built by the server at creation time as a snapshot: English, at most
/// <see cref="MaxLength"/> characters, plain text without HTML or line breaks. Titles longer than <see cref="TitleLimit"/> characters are cut with an
/// ellipsis. The actor of a system event (due, overdue, stalled) is never named. Pure functions, no lookups.
/// </summary>
public static class NotificationMessages
{
    public const int MaxLength = 300;
    public const int TitleLimit = 60;
    public const int ExcerptLimit = 80;

    private const string Ellipsis = "…";

    /// <summary>1. <c>Ann Lee assigned you TSK-1042 "Review privilege log" (Acme v. Smith).</c></summary>
    public static string TaskAssigned(string actorName, string taskNumber, string title, string matterName) =>
        Finish($"{Name(actorName)} assigned you {taskNumber} \"{Title(title)}\" ({Name(matterName)}).");

    /// <summary>2 soon. <c>TSK-1042 "Review privilege log" is due tomorrow (Oct 23).</c> or <c>... is due today.</c></summary>
    public static string TaskDueSoon(string taskNumber, string title, DateOnly dueDate, DateOnly today) =>
        dueDate <= today
            ? Finish($"{taskNumber} \"{Title(title)}\" is due today.")
            : Finish($"{taskNumber} \"{Title(title)}\" is due tomorrow ({ShortDate(dueDate)}).");

    /// <summary>2 overdue. <c>TSK-1042 "Review privilege log" is overdue (due Oct 20).</c></summary>
    public static string TaskOverdue(string taskNumber, string title, DateOnly dueDate) =>
        Finish($"{taskNumber} \"{Title(title)}\" is overdue (due {ShortDate(dueDate)}).");

    /// <summary>3 comment. <c>Ann Lee commented on TSK-1042: "Please re-run the search with the new terms..."</c> (excerpt as in the task Activity).</summary>
    public static string TaskComment(string actorName, string taskNumber, string excerpt) =>
        Finish($"{Name(actorName)} commented on {taskNumber}: \"{Excerpt(excerpt)}\"");

    /// <summary>3 mention. <c>Ann Lee mentioned you in TSK-1042: "...@Bo Chen can you confirm..."</c></summary>
    public static string TaskMention(string actorName, string taskNumber, string excerpt) =>
        Finish($"{Name(actorName)} mentioned you in {taskNumber}: \"{Excerpt(excerpt)}\"");

    /// <summary>4. <c>TSK-1042 "Review privilege log" on Acme v. Smith is overdue (due Oct 20, assigned to Bo Chen).</c> (<c>not assigned</c> when none)</summary>
    public static string MatterTaskOverdue(string taskNumber, string title, string matterName, DateOnly dueDate, string? assigneeName) =>
        Finish($"{taskNumber} \"{Title(title)}\" on {Name(matterName)} is overdue (due {ShortDate(dueDate)}, {(string.IsNullOrWhiteSpace(assigneeName) ? "not assigned" : "assigned to " + Name(assigneeName))}).");

    /// <summary>5. <c>Ann Lee created TSK-1051 "Load production volume 3" on Acme v. Smith.</c></summary>
    public static string MatterTaskCreated(string actorName, string taskNumber, string title, string matterName) =>
        Finish($"{Name(actorName)} created {taskNumber} \"{Title(title)}\" on {Name(matterName)}.");

    /// <summary>6 unassigned. <c>TSK-1042 "Review privilege log" on Acme v. Smith has been unassigned for 2 days.</c></summary>
    public static string MatterTaskUnassigned(string taskNumber, string title, string matterName, int days) =>
        Finish($"{taskNumber} \"{Title(title)}\" on {Name(matterName)} has been unassigned for {days.ToString(CultureInfo.InvariantCulture)} days.");

    /// <summary>6 on hold. <c>TSK-1042 "Review privilege log" on Acme v. Smith has been on hold for 5 days.</c></summary>
    public static string MatterTaskOnHold(string taskNumber, string title, string matterName, int days) =>
        Finish($"{taskNumber} \"{Title(title)}\" on {Name(matterName)} has been on hold for {days.ToString(CultureInfo.InvariantCulture)} days.");

    /// <summary>7. <c>Ann Lee made you Primary manager of Acme v. Smith.</c> (<c>Secondary manager</c>)</summary>
    public static string MatterManagerSet(string actorName, bool primary, string matterName) =>
        Finish($"{Name(actorName)} made you {(primary ? "Primary" : "Secondary")} manager of {Name(matterName)}.");

    /// <summary>8. <c>TSK-1042 "Review privilege log" in Demo Processing Pod is unassigned.</c></summary>
    public static string PodTaskUnassigned(string taskNumber, string title, string podName) =>
        Finish($"{taskNumber} \"{Title(title)}\" in {Name(podName)} is unassigned.");

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
