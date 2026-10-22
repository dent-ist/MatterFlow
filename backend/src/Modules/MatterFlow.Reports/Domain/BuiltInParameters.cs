namespace MatterFlow.Reports.Domain;

/// <summary>
/// Values the server supplies to every run (spec 5.3). Their names are reserved: an admin cannot define a parameter with one of them and a
/// request that names one is rejected. They are never shown as inputs.
/// </summary>
public static class BuiltInParameters
{
    public const string CurrentUserId = "CURRENT_USER_ID";
    public const string CurrentUserName = "CURRENT_USER_NAME";
    public const string CurrentUserEmail = "CURRENT_USER_EMAIL";
    public const string Today = "TODAY";
    public const string NowUtc = "NOW_UTC";
    public const string CurrentPodIds = "CURRENT_POD_IDS";
    public const string CurrentPrimaryPodId = "CURRENT_PRIMARY_POD_ID";
    public const string FirmTimeZoneOffsetMinutes = "FIRM_TIME_ZONE_OFFSET_MINUTES";

    /// <summary>All reserved names, upper case.</summary>
    public static IReadOnlySet<string> Names { get; } = new HashSet<string>(StringComparer.Ordinal)
    {
        CurrentUserId, CurrentUserName, CurrentUserEmail, Today, NowUtc, CurrentPodIds, CurrentPrimaryPodId, FirmTimeZoneOffsetMinutes,
    };

    /// <summary>Reserved but not provided in release one (personal data is not needed): a query that uses one is refused with a clear message.</summary>
    public static IReadOnlySet<string> Unavailable { get; } = new HashSet<string>(StringComparer.Ordinal) { CurrentUserEmail };

    public static bool IsBuiltIn(string upperName) => Names.Contains(upperName);
}
