using LptHub.SharedKernel.Availability;

namespace LptHub.SharedKernel.Tasks;

/// <summary>
/// The capacity states of a person (Dashboard v4, decision AS items 5 and 6). The first four come from the number of open assigned Tasks that are not On hold;
/// the last two are the availability of the person (out of office, outside work hours) and win over the load.
/// </summary>
public static class CapacityStates
{
    public const string Available = "AVAILABLE";
    public const string Occupied = "OCCUPIED";
    public const string Busy = "BUSY";
    public const string Overloaded = "OVERLOADED";
    public const string OutOfOffice = "OUT_OF_OFFICE";
    public const string OffHours = "OFF_HOURS";

    /// <summary>All six states in the fixed order of the capacity answer (also the severity order of the People list: most constrained last is not implied; see <see cref="Severity"/>).</summary>
    public static IReadOnlyList<string> All { get; } = [Available, Occupied, Busy, Overloaded, OutOfOffice, OffHours];

    /// <summary>Sort rank of the People list: the most loaded first (Overloaded, Busy, Occupied, Available), then Out of office, then Off hours.</summary>
    public static int Severity(string state) => state switch
    {
        Overloaded => 0,
        Busy => 1,
        Occupied => 2,
        Available => 3,
        OutOfOffice => 4,
        OffHours => 5,
        _ => 6,
    };
}

/// <summary>
/// Pure capacity rules shared by the Dashboard battery, the People list and the assignee picker, so they cannot disagree. <c>load</c> is the number of open assigned Tasks
/// that are New or In progress (On hold does not count). A person has <see cref="DefaultSlotsPerPerson"/> slots unless configured otherwise.
/// </summary>
public static class CapacityRules
{
    public const int DefaultSlotsPerPerson = 3;

    /// <summary>The state: out of office and off hours win; otherwise 0 Available, 1 Occupied, 2 Busy, 3 or more Overloaded.</summary>
    public static string State(int load, string availabilityState) => availabilityState switch
    {
        AvailabilityStates.OutOfOffice => CapacityStates.OutOfOffice,
        AvailabilityStates.OffHours => CapacityStates.OffHours,
        _ => load switch
        {
            <= 0 => CapacityStates.Available,
            1 => CapacityStates.Occupied,
            2 => CapacityStates.Busy,
            _ => CapacityStates.Overloaded,
        },
    };

    /// <summary>True when the person can take work now: in work hours, not out of office (the state is a load state).</summary>
    public static bool IsPresent(string state) => state is not (CapacityStates.OutOfOffice or CapacityStates.OffHours);

    /// <summary>Free slots of one person: zero when out of office or off hours, otherwise slots minus load (never below zero).</summary>
    public static int FreeSlots(string state, int load, int slots) => IsPresent(state) ? Math.Max(0, slots - Math.Max(0, load)) : 0;
}
