using System.Collections.Concurrent;
using MatterFlow.Reports.Application;

namespace MatterFlow.Reports.Infrastructure;

/// <summary>Collects the rows of a result in memory (replaced by the typed column store of issue #705).</summary>
internal sealed class ListRowSink : IRowSink
{
    private readonly int _limit;
    private readonly List<object?[]> _rows = [];

    public ListRowSink(int limit) => _limit = limit;

    public IReadOnlyList<ResultColumn> Columns { get; private set; } = [];

    public IReadOnlyList<object?[]> Rows => _rows;

    public void Begin(IReadOnlyList<ResultColumn> columns) => Columns = columns;

    public bool TryAdd(object?[] row)
    {
        _rows.Add(row);
        return _rows.Count < _limit;
    }
}

/// <summary>A finished result owned by one person.</summary>
internal sealed record StoredResult(Guid RunId, int OwnerUserId, int ReportId, IReadOnlyList<ResultColumn> Columns, IReadOnlyList<object?[]> Rows, bool Truncated, DateTime CreatedUtc);

internal sealed class InMemoryResultStore
{
    private readonly ConcurrentDictionary<int, StoredResult> _byUser = new();

    public void Put(StoredResult result) => _byUser[result.OwnerUserId] = result;

    public StoredResult? Get(int userId, Guid runId) => _byUser.TryGetValue(userId, out var r) && r.RunId == runId ? r : null;
}

internal sealed class InMemoryResultSink(InMemoryResultStore store, TimeProvider time) : IReportResultSink
{
    public IRowSink CreateSink(int maxRows) => new ListRowSink(maxRows);

    public Guid? Complete(IRowSink sink, int ownerUserId, int reportId, bool truncated)
    {
        var list = (ListRowSink)sink;
        var id = Guid.NewGuid();
        store.Put(new StoredResult(id, ownerUserId, reportId, list.Columns, list.Rows, truncated, time.GetUtcNow().UtcDateTime));
        return id;
    }
}
