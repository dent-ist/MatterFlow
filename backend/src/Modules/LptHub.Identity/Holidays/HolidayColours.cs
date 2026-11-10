namespace LptHub.Identity.Holidays;

/// <summary>
/// The colour keys a holiday calendar may use: the tag palette of <c>contracts/task-type-colours.json</c> (Identity may not read the Configuration module, so the ten names are repeated here;
/// <c>HolidayColoursTests</c> keeps the two in step).
/// </summary>
public static class HolidayColours
{
    public static IReadOnlyList<string> Keys { get; } = ["slate", "blue", "teal", "green", "amber", "orange", "red", "rose", "violet", "indigo"];

    public static bool IsValid(string? key) => key is not null && Keys.Contains(key);
}
