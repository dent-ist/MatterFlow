using MatterFlow.Reports.Application;
using Microsoft.Extensions.Options;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>One running report per person, a global cap and an hourly budget (spec 6.5; issue #702).</summary>
public class ReportRunGateTests
{
    private sealed class ManualTime : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 10, 22, 12, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow() => Now;
    }

    private static ReportRunGate Gate(ManualTime time, int global = 4, int perHour = 30) =>
        new(Options.Create(new ReportsOptions { GlobalConcurrency = global, RunsPerUserPerHour = perHour }), time);

    [Fact]
    public void A_second_run_by_the_same_person_is_refused_until_the_first_ends()
    {
        var gate = Gate(new ManualTime());
        var (first, d1) = gate.TryEnter(1, CancellationToken.None);

        d1.ShouldBe(GateDenial.None);
        gate.TryEnter(1, CancellationToken.None).Denial.ShouldBe(GateDenial.AlreadyRunning);
        gate.TryEnter(2, CancellationToken.None).Denial.ShouldBe(GateDenial.None); // somebody else may run

        first!.Dispose();
        gate.TryEnter(1, CancellationToken.None).Denial.ShouldBe(GateDenial.None);
    }

    [Fact]
    public void The_global_cap_refuses_with_busy_and_frees_up_on_release()
    {
        var gate = Gate(new ManualTime(), global: 2);
        var a = gate.TryEnter(1, CancellationToken.None).Lease!;
        gate.TryEnter(2, CancellationToken.None).Lease.ShouldNotBeNull();

        gate.TryEnter(3, CancellationToken.None).Denial.ShouldBe(GateDenial.Busy);
        gate.RunningCount.ShouldBe(2);

        a.Dispose();
        gate.TryEnter(3, CancellationToken.None).Denial.ShouldBe(GateDenial.None);
    }

    [Fact]
    public void A_busy_refusal_does_not_count_against_the_hourly_budget_or_hold_a_slot()
    {
        var gate = Gate(new ManualTime(), global: 1, perHour: 2);
        using var holder = gate.TryEnter(1, CancellationToken.None).Lease!;

        for (var i = 0; i < 5; i++)
            gate.TryEnter(2, CancellationToken.None).Denial.ShouldBe(GateDenial.Busy);

        holder.Dispose();
        gate.TryEnter(2, CancellationToken.None).Denial.ShouldBe(GateDenial.None);
    }

    [Fact]
    public void The_hourly_budget_is_per_person_and_slides()
    {
        var time = new ManualTime();
        var gate = Gate(time, perHour: 3);
        for (var i = 0; i < 3; i++)
            gate.TryEnter(1, CancellationToken.None).Lease!.Dispose();

        gate.TryEnter(1, CancellationToken.None).Denial.ShouldBe(GateDenial.RateLimited);
        gate.TryEnter(2, CancellationToken.None).Denial.ShouldBe(GateDenial.None);

        time.Now = time.Now.AddMinutes(61);
        gate.TryEnter(1, CancellationToken.None).Denial.ShouldBe(GateDenial.None);
    }

    [Fact]
    public void Cancel_stops_the_running_report_of_that_person_only()
    {
        var gate = Gate(new ManualTime());
        var mine = gate.TryEnter(1, CancellationToken.None).Lease!;
        var other = gate.TryEnter(2, CancellationToken.None).Lease!;

        gate.Cancel(1).ShouldBeTrue();

        mine.Token.IsCancellationRequested.ShouldBeTrue();
        other.Token.IsCancellationRequested.ShouldBeFalse();
        gate.Cancel(99).ShouldBeFalse();
    }

    [Fact]
    public void An_aborted_request_cancels_the_lease()
    {
        var gate = Gate(new ManualTime());
        using var request = new CancellationTokenSource();
        var lease = gate.TryEnter(1, request.Token).Lease!;

        request.Cancel();

        lease.Token.IsCancellationRequested.ShouldBeTrue();
    }

    [Fact]
    public void Disposing_twice_releases_once()
    {
        var gate = Gate(new ManualTime(), global: 1);
        var lease = gate.TryEnter(1, CancellationToken.None).Lease!;

        lease.Dispose();
        lease.Dispose();

        gate.TryEnter(2, CancellationToken.None).Lease.ShouldNotBeNull();
        gate.TryEnter(3, CancellationToken.None).Denial.ShouldBe(GateDenial.Busy); // a double release would have opened a second slot
    }

    [Fact]
    public void Racing_requests_of_one_person_let_exactly_one_through()
    {
        var gate = Gate(new ManualTime(), global: 100, perHour: 10_000);
        var winners = 0;

        Parallel.For(0, 200, _ =>
        {
            var (lease, _) = gate.TryEnter(7, CancellationToken.None);
            if (lease is not null)
                Interlocked.Increment(ref winners);
        });

        winners.ShouldBe(1);
        gate.RunningCount.ShouldBe(1);
    }

    [Fact]
    public void Effective_limits_use_the_report_setting_within_the_ceilings()
    {
        var o = new ReportsOptions();

        o.EffectiveTimeout(null).ShouldBe(60);
        o.EffectiveTimeout(10).ShouldBe(10);
        o.EffectiveTimeout(9999).ShouldBe(300);
        o.EffectiveTimeout(0).ShouldBe(1);
        o.EffectiveMaxRows(null).ShouldBe(50_000);
        o.EffectiveMaxRows(100).ShouldBe(100);
        o.EffectiveMaxRows(9_999_999).ShouldBe(200_000);
    }
}
