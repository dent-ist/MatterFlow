using System.Globalization;

namespace MatterFlow.Reports.Application.Results;

/// <summary>
/// One column of a stored result, kept as a typed array instead of boxed objects (spec 6.4). Rows are appended while the reader streams and the column is
/// sealed when the query ends. Comparison puts nulls last ascending (the caller reverses it for descending, so they come first).
/// </summary>
internal abstract class ResultColumnData
{
    protected bool[]? Nulls;
    protected int Count;

    public int RowCount => Count;

    public abstract void Add(object? value);

    public abstract bool IsNull(int row);

    /// <summary>The value as JSON-friendly object: number, string, bool; dates as ISO text.</summary>
    public abstract object? Get(int row);

    /// <summary>Orders two rows: nulls last, text case-insensitively.</summary>
    public abstract int Compare(int a, int b);

    public abstract long EstimatedBytes { get; }

    /// <summary>Trims the arrays to the rows that were read (the doubling growth leaves up to half unused).</summary>
    public abstract void Seal();

    protected void TrimNulls()
    {
        if (Nulls is not null && Nulls.Length != Count)
            Array.Resize(ref Nulls, Count);
    }

    protected void MarkNull(int row, int capacity)
    {
        Nulls ??= new bool[capacity];
        if (Nulls.Length < capacity)
            Array.Resize(ref Nulls, capacity);
        Nulls[row] = true;
    }

    protected bool NullAt(int row) => Nulls is not null && row < Nulls.Length && Nulls[row];

    protected int CompareNulls(int a, int b, out bool done)
    {
        var an = NullAt(a);
        var bn = NullAt(b);
        done = an || bn;
        return an && bn ? 0 : an ? 1 : bn ? -1 : 0;
    }

    protected static T[] Grow<T>(T[] array, int needed)
    {
        if (needed <= array.Length)
            return array;
        var larger = new T[Math.Max(needed, Math.Max(16, array.Length * 2))];
        Array.Copy(array, larger, array.Length);
        return larger;
    }

    /// <summary>Creates the right column for a result column.</summary>
    public static ResultColumnData For(ResultColumn column) => column.Type switch
    {
        ReportColumnType.Integer => new LongColumn(),
        ReportColumnType.Decimal => column.Floating ? new DoubleColumn() : new DecimalColumn(),
        ReportColumnType.Boolean => new BoolColumn(),
        ReportColumnType.Date => new TicksColumn(dateOnly: true),
        ReportColumnType.DateTime => new TicksColumn(dateOnly: false),
        _ => new TextColumn(),
    };
}

internal sealed class LongColumn : ResultColumnData
{
    private long[] _values = [];

    public long this[int row] => _values[row];

    public override void Add(object? value)
    {
        _values = Grow(_values, Count + 1);
        if (value is null)
            MarkNull(Count, _values.Length);
        else
            _values[Count] = Convert.ToInt64(value, CultureInfo.InvariantCulture);
        Count++;
    }

    public override bool IsNull(int row) => NullAt(row);

    public override object? Get(int row) => NullAt(row) ? null : _values[row];

    public override int Compare(int a, int b)
    {
        var n = CompareNulls(a, b, out var done);
        return done ? n : _values[a].CompareTo(_values[b]);
    }

    public override void Seal()
    {
        Array.Resize(ref _values, Count);
        TrimNulls();
    }

    public override long EstimatedBytes => (long)_values.Length * 8 + (Nulls?.Length ?? 0);
}

internal sealed class DecimalColumn : ResultColumnData
{
    private decimal[] _values = [];

    public decimal this[int row] => _values[row];

    public override void Add(object? value)
    {
        _values = Grow(_values, Count + 1);
        if (value is null)
            MarkNull(Count, _values.Length);
        else
            _values[Count] = value is decimal d ? d : Convert.ToDecimal(value, CultureInfo.InvariantCulture);
        Count++;
    }

    public override bool IsNull(int row) => NullAt(row);

    public override object? Get(int row) => NullAt(row) ? null : _values[row];

    public override int Compare(int a, int b)
    {
        var n = CompareNulls(a, b, out var done);
        return done ? n : _values[a].CompareTo(_values[b]);
    }

    public override void Seal()
    {
        Array.Resize(ref _values, Count);
        TrimNulls();
    }

    public override long EstimatedBytes => (long)_values.Length * 16 + (Nulls?.Length ?? 0);
}

internal sealed class DoubleColumn : ResultColumnData
{
    private double[] _values = [];

    public double this[int row] => _values[row];

    public override void Add(object? value)
    {
        _values = Grow(_values, Count + 1);
        if (value is null)
            MarkNull(Count, _values.Length);
        else
            _values[Count] = Convert.ToDouble(value, CultureInfo.InvariantCulture);
        Count++;
    }

    public override bool IsNull(int row) => NullAt(row);

    public override object? Get(int row) => NullAt(row) ? null : _values[row];

    public override int Compare(int a, int b)
    {
        var n = CompareNulls(a, b, out var done);
        return done ? n : _values[a].CompareTo(_values[b]);
    }

    public override void Seal()
    {
        Array.Resize(ref _values, Count);
        TrimNulls();
    }

    public override long EstimatedBytes => (long)_values.Length * 8 + (Nulls?.Length ?? 0);
}

internal sealed class BoolColumn : ResultColumnData
{
    private bool[] _values = [];

    public bool this[int row] => _values[row];

    public override void Add(object? value)
    {
        _values = Grow(_values, Count + 1);
        if (value is null)
            MarkNull(Count, _values.Length);
        else
            _values[Count] = Convert.ToBoolean(value, CultureInfo.InvariantCulture);
        Count++;
    }

    public override bool IsNull(int row) => NullAt(row);

    public override object? Get(int row) => NullAt(row) ? null : _values[row];

    public override int Compare(int a, int b)
    {
        var n = CompareNulls(a, b, out var done);
        return done ? n : _values[a].CompareTo(_values[b]);
    }

    public override void Seal()
    {
        Array.Resize(ref _values, Count);
        TrimNulls();
    }

    public override long EstimatedBytes => (long)_values.Length + (Nulls?.Length ?? 0);
}

/// <summary>Dates and date-times as ticks (DateTimeOffset values are taken in UTC).</summary>
internal sealed class TicksColumn(bool dateOnly) : ResultColumnData
{
    private long[] _values = [];

    public bool DateOnly => dateOnly;

    public long this[int row] => _values[row];

    public override void Add(object? value)
    {
        _values = Grow(_values, Count + 1);
        if (value is null)
        {
            MarkNull(Count, _values.Length);
        }
        else
        {
            var dt = value switch
            {
                DateTime d => d,
                DateTimeOffset o => o.UtcDateTime,
                DateOnly d => d.ToDateTime(TimeOnly.MinValue),
                _ => Convert.ToDateTime(value, CultureInfo.InvariantCulture),
            };
            _values[Count] = dateOnly ? dt.Date.Ticks : dt.Ticks;
        }

        Count++;
    }

    public override bool IsNull(int row) => NullAt(row);

    public override object? Get(int row)
    {
        if (NullAt(row))
            return null;
        var dt = new DateTime(_values[row], DateTimeKind.Unspecified);
        return dateOnly ? dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : dt.ToString("yyyy-MM-dd'T'HH:mm:ss.FFFFFFF", CultureInfo.InvariantCulture);
    }

    public override int Compare(int a, int b)
    {
        var n = CompareNulls(a, b, out var done);
        return done ? n : _values[a].CompareTo(_values[b]);
    }

    public override void Seal()
    {
        Array.Resize(ref _values, Count);
        TrimNulls();
    }

    public override long EstimatedBytes => (long)_values.Length * 8 + (Nulls?.Length ?? 0);
}

/// <summary>Text with repeated values shared (a small dictionary per column); anything that is not a string is turned into its invariant text.</summary>
internal sealed class TextColumn : ResultColumnData
{
    private const int InternLimit = 4096;
    private const int MaxChars = 32_767;

    private string?[] _values = [];
    private readonly Dictionary<string, string> _pool = new(StringComparer.Ordinal);
    private long _stringBytes;

    public string? this[int row] => _values[row];

    public override void Add(object? value)
    {
        _values = Grow(_values, Count + 1);
        if (value is null)
        {
            MarkNull(Count, _values.Length);
        }
        else
        {
            var text = ToText(value);
            if (text.Length > MaxChars)
                text = text[..MaxChars];
            if (_pool.TryGetValue(text, out var shared))
            {
                text = shared;
            }
            else if (_pool.Count < InternLimit)
            {
                _pool[text] = text;
                _stringBytes += 26 + (long)text.Length * 2;
            }
            else
            {
                _stringBytes += 26 + (long)text.Length * 2;
            }

            _values[Count] = text;
        }

        Count++;
    }

    private static string ToText(object value) => value switch
    {
        string s => s,
        byte[] bytes => "0x" + Convert.ToHexString(bytes.AsSpan(0, Math.Min(bytes.Length, 64))) + (bytes.Length > 64 ? "..." : ""),
        Guid g => g.ToString("D"),
        TimeSpan t => t.ToString("c", CultureInfo.InvariantCulture),
        DateTime d => d.ToString("yyyy-MM-dd'T'HH:mm:ss.FFFFFFF", CultureInfo.InvariantCulture),
        DateTimeOffset o => o.ToString("yyyy-MM-dd'T'HH:mm:ss.FFFFFFFzzz", CultureInfo.InvariantCulture),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString() ?? "",
    };

    public override bool IsNull(int row) => NullAt(row);

    public override object? Get(int row) => NullAt(row) ? null : _values[row];

    public override int Compare(int a, int b)
    {
        var n = CompareNulls(a, b, out var done);
        return done ? n : string.Compare(_values[a], _values[b], StringComparison.OrdinalIgnoreCase);
    }

    public override void Seal()
    {
        Array.Resize(ref _values, Count);
        TrimNulls();
    }

    public override long EstimatedBytes => (long)_values.Length * 8 + _stringBytes + (Nulls?.Length ?? 0);
}
