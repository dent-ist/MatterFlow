using System.Collections.Concurrent;
using Microsoft.Extensions.Options;

namespace MatterFlow.Reports.Application;

/// <summary>Why the gate refused a run.</summary>
public enum GateDenial
{
    None,
    /// <summary>The person already has a report running (one per user, previews included): 409 <c>REPORT_ALREADY_RUNNING</c>.</summary>
    AlreadyRunning,
    /// <summary>The application-wide cap of simultaneous reports is reached: 429 <c>REPORT_BUSY</c>.</summary>
    Busy,
    /// <summary>The person started too many runs this hour: 429 <c>REPORT_RATE_LIMITED</c>.</summary>
    RateLimited,
}

/// <summary>A held place at the gate. Dispose releases the person's lock and the global slot; <see cref="Cancel"/> stops the running report.</summary>
public sealed class RunLease : IDisposable
{
    private readonly Action _release;
    private readonly CancellationTokenSource _cancel;
    private int _released;

    internal RunLease(Action release, CancellationTokenSource cancel)
    {
        _release = release;
        _cancel = cancel;
    }

    /// <summary>Cancelled when the person (or an administrator) cancels the run.</summary>
    public CancellationToken Token => _cancel.Token;

    public void Cancel() => _cancel.Cancel();

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _released, 1) == 0)
        {
            _release();
            _cancel.Dispose();
        }
    }
}

/// <summary>
/// Concurrency and abuse limits (spec 6.5): one running report per user (a preview counts), a global cap, and a per-user hourly budget.
/// In memory, per application instance: a single IIS site is assumed (open question Q5 of the spec).
/// </summary>
public sealed class ReportRunGate
{
    private readonly ReportsOptions _options;
    private readonly TimeProvider _time;
    private readonly SemaphoreSlim _global;
    private readonly ConcurrentDictionary<int, RunLease> _running = new();
    private readonly ConcurrentDictionary<int, Queue<DateTimeOffset>> _history = new();

    public ReportRunGate(IOptions<ReportsOptions> options, TimeProvider time)
    {
        _options = options.Value;
        _time = time;
        _global = new SemaphoreSlim(Math.Max(1, _options.GlobalConcurrency));
    }

    /// <summary>Reports running now in the whole application.</summary>
    public int RunningCount => _running.Count;

    /// <summary>Takes a place for <paramref name="userId"/>, or says why not. The caller disposes the lease when the run ends.</summary>
    public (RunLease? Lease, GateDenial Denial) TryEnter(int userId, CancellationToken requestAborted)
    {
        if (_running.ContainsKey(userId))
            return (null, GateDenial.AlreadyRunning);

        if (!WithinHourlyBudget(userId))
            return (null, GateDenial.RateLimited);

        if (!_global.Wait(0))
            return (null, GateDenial.Busy);

        var cancel = CancellationTokenSource.CreateLinkedTokenSource(requestAborted);
        var lease = new RunLease(() =>
        {
            _running.TryRemove(userId, out _);
            _global.Release();
        }, cancel);

        if (!_running.TryAdd(userId, lease))
        {
            // Two requests of the same person raced; only one may run.
            _global.Release();
            cancel.Dispose();
            return (null, GateDenial.AlreadyRunning);
        }

        Record(userId);
        return (lease, GateDenial.None);
    }

    /// <summary>Cancels the person's running report, if any. True when there was one.</summary>
    public bool Cancel(int userId)
    {
        if (!_running.TryGetValue(userId, out var lease))
            return false;
        lease.Cancel();
        return true;
    }

    private bool WithinHourlyBudget(int userId)
    {
        var queue = _history.GetOrAdd(userId, _ => new Queue<DateTimeOffset>());
        lock (queue)
        {
            Trim(queue);
            return queue.Count < _options.RunsPerUserPerHour;
        }
    }

    private void Record(int userId)
    {
        var queue = _history.GetOrAdd(userId, _ => new Queue<DateTimeOffset>());
        lock (queue)
        {
            Trim(queue);
            queue.Enqueue(_time.GetUtcNow());
        }
    }

    private void Trim(Queue<DateTimeOffset> queue)
    {
        var cutoff = _time.GetUtcNow().AddHours(-1);
        while (queue.Count > 0 && queue.Peek() < cutoff)
            queue.Dequeue();
    }
}
