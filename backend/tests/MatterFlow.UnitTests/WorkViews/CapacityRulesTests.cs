using MatterFlow.SharedKernel.Availability;
using MatterFlow.SharedKernel.Tasks;
using Shouldly;

namespace MatterFlow.UnitTests.WorkViews;

/// <summary>Dashboard v4 (issue #1065): the shared capacity states and free slots.</summary>
public class CapacityRulesTests
{
    [Theory]
    [InlineData(0, CapacityStates.Available)]
    [InlineData(1, CapacityStates.Occupied)]
    [InlineData(2, CapacityStates.Busy)]
    [InlineData(3, CapacityStates.Overloaded)]
    [InlineData(9, CapacityStates.Overloaded)]
    public void The_load_decides_the_state_of_a_person_who_can_take_work(int load, string expected)
    {
        CapacityRules.State(load, AvailabilityStates.Available).ShouldBe(expected);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(3)]
    public void Out_of_office_and_off_hours_win_over_the_load(int load)
    {
        CapacityRules.State(load, AvailabilityStates.OutOfOffice).ShouldBe(CapacityStates.OutOfOffice);
        CapacityRules.State(load, AvailabilityStates.OffHours).ShouldBe(CapacityStates.OffHours);
    }

    [Fact]
    public void Free_slots_are_slots_minus_load_and_zero_when_away()
    {
        CapacityRules.FreeSlots(CapacityStates.Available, 0, 3).ShouldBe(3);
        CapacityRules.FreeSlots(CapacityStates.Busy, 2, 3).ShouldBe(1);
        CapacityRules.FreeSlots(CapacityStates.Overloaded, 5, 3).ShouldBe(0);
        CapacityRules.FreeSlots(CapacityStates.OutOfOffice, 0, 3).ShouldBe(0);
        CapacityRules.FreeSlots(CapacityStates.OffHours, 1, 3).ShouldBe(0);
    }

    [Fact]
    public void The_six_states_come_in_the_fixed_order_and_the_people_list_sorts_by_severity()
    {
        CapacityStates.All.ShouldBe([CapacityStates.Available, CapacityStates.Occupied, CapacityStates.Busy, CapacityStates.Overloaded, CapacityStates.OutOfOffice, CapacityStates.OffHours]);
        CapacityStates.All.OrderBy(CapacityStates.Severity).ShouldBe([CapacityStates.Overloaded, CapacityStates.Busy, CapacityStates.Occupied, CapacityStates.Available, CapacityStates.OutOfOffice, CapacityStates.OffHours]);
    }
}
