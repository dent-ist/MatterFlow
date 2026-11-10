using LptHub.SharedKernel.Tasks;
using LptHub.WorkViews.Application.Queries;
using Shouldly;

namespace LptHub.UnitTests.WorkViews;

/// <summary>Decision AV (issue #1103): the capacity battery counts by absence, not by the clock.</summary>
public class CapacitySummaryTests
{
    private static CapacityWorkerFact Free(int load = 0) => new(CapacityRules.State(load, "AVAILABLE"), load, false);

    private static CapacityWorkerFact Off(int load = 0, bool holiday = false) => new(CapacityStates.OffHours, load, holiday);

    private static CapacityWorkerFact Out() => new(CapacityStates.OutOfOffice, 0, false);

    [Fact]
    public void People_outside_work_hours_count_with_their_slots_and_load()
    {
        var t = CapacitySummary.Compute([Free(1), Off(2), Off(0)], 3, countOffHours: true);
        t.SummaryState.ShouldBe(CapacitySummaryStates.Ok);
        t.Counted.ShouldBe(3);
        t.TotalSlots.ShouldBe(9);
        t.FreeSlots.ShouldBe(2 + 1 + 3);
        t.CanTakeWork.ShouldBe(3);
        t.FreePercent.ShouldBe(67);
    }

    [Fact]
    public void A_holiday_or_an_absence_never_counts()
    {
        var t = CapacitySummary.Compute([Free(0), Off(0, holiday: true), Out()], 3, countOffHours: true);
        t.Counted.ShouldBe(1);
        t.TotalSlots.ShouldBe(3);
        t.FreeSlots.ShouldBe(3);
    }

    [Fact]
    public void With_the_setting_off_people_outside_work_hours_are_left_out_as_before()
    {
        var t = CapacitySummary.Compute([Free(1), Off(0), Off(0)], 3, countOffHours: false);
        t.Counted.ShouldBe(1);
        t.TotalSlots.ShouldBe(3);
        t.FreeSlots.ShouldBe(2);
        t.SummaryState.ShouldBe(CapacitySummaryStates.Ok);
    }

    [Fact]
    public void With_the_setting_off_nobody_present_is_after_hours_and_a_holiday_only_is_holiday()
    {
        CapacitySummary.Compute([Off(), Off(), Out()], 3, countOffHours: false).SummaryState.ShouldBe(CapacitySummaryStates.AfterHours);
        CapacitySummary.Compute([Off(), Off(0, true)], 3, countOffHours: false).SummaryState.ShouldBe(CapacitySummaryStates.AfterHours);
        CapacitySummary.Compute([Off(0, true), Off(0, true), Out()], 3, countOffHours: false).SummaryState.ShouldBe(CapacitySummaryStates.Holiday);
        CapacitySummary.Compute([Off(), Off()], 3, countOffHours: false).FreePercent.ShouldBeNull();
    }

    [Fact]
    public void With_the_setting_on_evening_with_everybody_off_hours_is_still_ok()
    {
        var t = CapacitySummary.Compute([Off(1), Off(2), Off(3)], 3, countOffHours: true);
        t.SummaryState.ShouldBe(CapacitySummaryStates.Ok);
        t.TotalSlots.ShouldBe(9);
        t.FreeSlots.ShouldBe(2 + 1 + 0);
        t.FreePercent.ShouldBe(33);
    }

    [Fact]
    public void Everybody_out_of_office_is_all_out_and_a_firm_holiday_is_holiday_even_with_the_setting_on()
    {
        var allOut = CapacitySummary.Compute([Out(), Out()], 3, countOffHours: true);
        allOut.SummaryState.ShouldBe(CapacitySummaryStates.AllOut);
        allOut.FreePercent.ShouldBeNull();
        allOut.TotalSlots.ShouldBe(0);

        CapacitySummary.Compute([Off(0, true), Off(0, true)], 3, countOffHours: true).SummaryState.ShouldBe(CapacitySummaryStates.Holiday);
        CapacitySummary.Compute([Off(0, true), Out()], 3, countOffHours: true).SummaryState.ShouldBe(CapacitySummaryStates.Holiday);
    }

    [Fact]
    public void No_workers_is_no_workers_whatever_the_setting()
    {
        foreach (var flag in new[] { true, false })
        {
            var t = CapacitySummary.Compute([], 3, flag);
            t.SummaryState.ShouldBe(CapacitySummaryStates.NoWorkers);
            t.TotalSlots.ShouldBe(0);
            t.OverCapacityTasks.ShouldBe(0);
            t.FreePercent.ShouldBeNull();
        }
    }

    [Fact]
    public void Over_capacity_tasks_are_the_tasks_above_the_slots_of_counted_workers_and_slack_does_not_hide_them()
    {
        // 5 and 4 tasks on 3 slots = 2 + 1 over; the idle worker's 3 free slots keep the used percent low, but the overload is still counted.
        var t = CapacitySummary.Compute([Free(5), Free(4), Free(0), Out(), Off(7, holiday: true)], 3, countOffHours: true);
        t.OverCapacityTasks.ShouldBe(3);
        t.FreeSlots.ShouldBe(3);
        t.TotalSlots.ShouldBe(9);
        t.CanTakeWork.ShouldBe(1);

        // An overloaded person outside work hours counts when the setting is on and not when it is off.
        CapacitySummary.Compute([Off(6)], 3, countOffHours: true).OverCapacityTasks.ShouldBe(3);
        CapacitySummary.Compute([Free(0), Off(6)], 3, countOffHours: false).OverCapacityTasks.ShouldBe(0);
    }
}
