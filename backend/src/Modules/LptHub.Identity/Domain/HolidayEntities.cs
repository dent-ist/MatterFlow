using LptHub.SharedKernel.Audit;
using LptHub.SharedKernel.Entities;

namespace LptHub.Identity.Domain;

/// <summary>A holiday calendar (script 59): a named set of holiday rules. <see cref="AppliesToEveryone"/> makes it a firm closure calendar that counts for every person.</summary>
[Audited(ObjectType = "HolidayCalendar")]
public class HolidayCalendar : AuditedEntity<int>
{
    public string Name { get; set; } = string.Empty;

    public string ColourKey { get; set; } = "slate";

    public string? RegionNote { get; set; }

    public bool AppliesToEveryone { get; set; }

    public int SortOrder { get; set; }

    public bool IsActive { get; set; } = true;
}

/// <summary>One holiday rule of a calendar (script 59); expanded for any year by <c>HolidayRulesEngine</c>.</summary>
[Audited(ObjectType = "Holiday")]
public class Holiday : AuditedEntity<int>
{
    public int CalendarId { get; set; }

    public string Name { get; set; } = string.Empty;

    public string RuleKind { get; set; } = "FIXED";

    public int? Month { get; set; }

    public int? Day { get; set; }

    public int? Nth { get; set; }

    public int? Weekday { get; set; }

    public int PlusDays { get; set; }

    public int? EasterOffset { get; set; }

    public DateOnly? OnceDate { get; set; }

    public int? RangeEndMonth { get; set; }

    public int? RangeEndDay { get; set; }

    public DateOnly? RangeEndDate { get; set; }

    public bool Yearly { get; set; } = true;

    public string WeekendRule { get; set; } = "NONE";

    public string? RegionNote { get; set; }
}
