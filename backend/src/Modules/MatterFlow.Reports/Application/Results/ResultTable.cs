namespace MatterFlow.Reports.Application.Results;

/// <summary>A finished result in typed column storage. Read-only, so it can be sorted and paged by many requests at once.</summary>
public sealed class ResultTable
{
    private readonly ResultColumnData[] _data;

    internal ResultTable(IReadOnlyList<ResultColumn> columns, ResultColumnData[] data, int rowCount)
    {
        Columns = columns;
        _data = data;
        RowCount = rowCount;
        EstimatedBytes = data.Sum(d => d.EstimatedBytes);
    }

    public IReadOnlyList<ResultColumn> Columns { get; }

    public int RowCount { get; }

    /// <summary>Rough memory use, for the budget of all cached results.</summary>
    public long EstimatedBytes { get; }

    internal ResultColumnData Data(int column) => _data[column];

    private readonly object _cacheLock = new();
    private (string Key, int[] Order)? _cached;

    /// <summary>The order of the last filter+sort combination, so paging through it does not sort again.</summary>
    internal bool TryGetCachedOrder(string key, out int[] order)
    {
        lock (_cacheLock)
        {
            if (_cached is { } c && c.Key == key)
            {
                order = c.Order;
                return true;
            }
        }

        order = [];
        return false;
    }

    internal void CacheOrder(string key, int[] order)
    {
        lock (_cacheLock)
            _cached = (key, order);
    }

    /// <summary>The cell as a JSON-friendly value (number, string, bool, null; dates as ISO text).</summary>
    public object? Get(int row, int column) => _data[column].Get(row);

    public int IndexOf(string columnName)
    {
        for (var i = 0; i < Columns.Count; i++)
        {
            if (string.Equals(Columns[i].Name, columnName, StringComparison.OrdinalIgnoreCase))
                return i;
        }

        return -1;
    }
}

/// <summary>
/// Builds a <see cref="ResultTable"/> while the reader streams. Stops accepting rows when its estimated size passes the budget, so one huge
/// result cannot exhaust the server before it is even stored (the run then answers 503 <c>REPORT_MEMORY</c>).
/// </summary>
public sealed class ResultTableBuilder : IRowSink
{
    private const int EstimateEvery = 1000;

    private readonly int _maxRows;
    private readonly long _budgetBytes;
    private ResultColumnData[] _data = [];
    private IReadOnlyList<ResultColumn> _columns = [];
    private int _rows;

    public ResultTableBuilder(int maxRows, long budgetBytes)
    {
        _maxRows = maxRows;
        _budgetBytes = budgetBytes;
    }

    /// <summary>True when the result outgrew the budget while it was being read.</summary>
    public bool OverBudget { get; private set; }

    public void Begin(IReadOnlyList<ResultColumn> columns)
    {
        _columns = columns;
        _data = columns.Select(ResultColumnData.For).ToArray();
    }

    public bool TryAdd(object?[] row)
    {
        for (var i = 0; i < _data.Length; i++)
            _data[i].Add(row[i]);
        _rows++;

        if (_rows % EstimateEvery == 0 && _data.Sum(d => d.EstimatedBytes) > _budgetBytes)
        {
            OverBudget = true;
            return false;
        }

        return _rows < _maxRows;
    }

    public ResultTable Build()
    {
        foreach (var d in _data)
            d.Seal();
        return new(_columns, _data, _rows);
    }
}
