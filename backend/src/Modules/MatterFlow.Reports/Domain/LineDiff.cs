namespace MatterFlow.Reports.Domain;

/// <summary>Whether a line is in both texts, only in the new one or only in the old one.</summary>
public enum DiffKind
{
    Same,
    Added,
    Removed,
}

/// <summary>One line of a line diff. Line numbers are 1-based; the one that does not apply is null.</summary>
public sealed record DiffLine(DiffKind Kind, string Text, int? OldLine, int? NewLine);

/// <summary>
/// A line diff for the version history (spec 6.7): the common start and end are skipped, the middle is compared with a longest-common-subsequence
/// table. A very large change (more than four million line pairs) is shown as everything removed then everything added instead of spending the time.
/// </summary>
public static class LineDiff
{
    private const long MaxCells = 4_000_000;

    public static IReadOnlyList<DiffLine> Compute(string oldText, string newText)
    {
        var a = Split(oldText);
        var b = Split(newText);
        var result = new List<DiffLine>(Math.Max(a.Length, b.Length));

        var start = 0;
        while (start < a.Length && start < b.Length && a[start] == b[start])
        {
            result.Add(new DiffLine(DiffKind.Same, a[start], start + 1, start + 1));
            start++;
        }

        var endA = a.Length;
        var endB = b.Length;
        while (endA > start && endB > start && a[endA - 1] == b[endB - 1])
        {
            endA--;
            endB--;
        }

        var n = endA - start;
        var m = endB - start;
        if ((long)n * m > MaxCells)
        {
            for (var i = start; i < endA; i++)
                result.Add(new DiffLine(DiffKind.Removed, a[i], i + 1, null));
            for (var j = start; j < endB; j++)
                result.Add(new DiffLine(DiffKind.Added, b[j], null, j + 1));
        }
        else
        {
            var table = new int[n + 1, m + 1];
            for (var i = n - 1; i >= 0; i--)
            {
                for (var j = m - 1; j >= 0; j--)
                    table[i, j] = a[start + i] == b[start + j] ? table[i + 1, j + 1] + 1 : Math.Max(table[i + 1, j], table[i, j + 1]);
            }

            int x = 0, y = 0;
            while (x < n && y < m)
            {
                if (a[start + x] == b[start + y])
                {
                    result.Add(new DiffLine(DiffKind.Same, a[start + x], start + x + 1, start + y + 1));
                    x++;
                    y++;
                }
                else if (table[x + 1, y] >= table[x, y + 1])
                {
                    result.Add(new DiffLine(DiffKind.Removed, a[start + x], start + x + 1, null));
                    x++;
                }
                else
                {
                    result.Add(new DiffLine(DiffKind.Added, b[start + y], null, start + y + 1));
                    y++;
                }
            }

            for (; x < n; x++)
                result.Add(new DiffLine(DiffKind.Removed, a[start + x], start + x + 1, null));
            for (; y < m; y++)
                result.Add(new DiffLine(DiffKind.Added, b[start + y], null, start + y + 1));
        }

        for (var k = 0; endA + k < a.Length; k++)
            result.Add(new DiffLine(DiffKind.Same, a[endA + k], endA + k + 1, endB + k + 1));
        return result;
    }

    private static string[] Split(string text) => text.Length == 0 ? [] : text.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n').Split('\n');
}
