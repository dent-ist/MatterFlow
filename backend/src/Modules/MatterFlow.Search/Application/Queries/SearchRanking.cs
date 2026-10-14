using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Search.Application.Queries;

/// <summary>
/// The relevance tiers of a match, best first: the whole value (or exact number), the start of the value (or a number prefix), the start of a
/// word, anywhere inside. Hits sort by tier, then by a per-type stable key and the id. The SQL is built from <see cref="Tier{T}"/> lists;
/// <see cref="RankText"/> is the same rule in plain C# (kept in step by tests) for unit tests and documentation.
/// </summary>
public static class SearchRanking
{
    public const int Exact = 0;
    public const int StartsWith = 1;
    public const int WordStart = 2;
    public const int Substring = 3;

    /// <summary>The tier at which <paramref name="text"/> matches <paramref name="term"/> (case-insensitive), or null when it does not match.</summary>
    public static int? RankText(string? text, string? term)
    {
        if (string.IsNullOrEmpty(text) || string.IsNullOrEmpty(term))
            return null;
        if (string.Equals(text, term, StringComparison.OrdinalIgnoreCase))
            return Exact;
        if (text.StartsWith(term, StringComparison.OrdinalIgnoreCase))
            return StartsWith;

        var best = (int?)null;
        for (var at = text.IndexOf(term, StringComparison.OrdinalIgnoreCase); at >= 0; at = text.IndexOf(term, at + 1, StringComparison.OrdinalIgnoreCase))
        {
            if (at > 0 && SearchTerm.IsWordSeparator(text[at - 1]))
                return WordStart;
            best = Substring;
        }

        return best;
    }

    /// <summary>The better (lower) of several tiers; null entries are non-matches.</summary>
    public static int? Best(params int?[] ranks)
    {
        var found = ranks.Where(r => r is not null).Select(r => r!.Value).ToList();
        return found.Count == 0 ? null : found.Min();
    }
}

/// <summary>
/// One relevance tier: rows satisfying <see cref="Predicate"/> are at least this relevant. A tier that another tier of the same query already
/// implies (the start of a name implies "name contains") sets <see cref="InFilter"/> to false: it only ranks, and is left out of the WHERE clause so
/// the scan evaluates one LIKE per column instead of four.
/// </summary>
public sealed record Tier<T>(int Rank, Expression<Func<T, bool>> Predicate, bool InFilter = true);

/// <summary>A row with the relevance tier it matched at.</summary>
public sealed class Ranked<T>
{
    public T Item { get; init; } = default!;

    public int Rank { get; init; }
}

/// <summary>Builds the "match anything in any tier" filter and the <c>CASE</c> rank from a tier list, so both stay in step.</summary>
public static class RankedQuery
{
    private const string BinaryCollation = "Latin1_General_100_BIN2";

    /// <summary>The LIKE-based predicates match on a column; the collation of the database decides case sensitivity (case-insensitive here).</summary>
    public static IQueryable<Ranked<T>> Rank<T>(IQueryable<T> rows, IReadOnlyList<Tier<T>> tiers, bool requireMatch)
    {
        var parameter = Expression.Parameter(typeof(T), "r");
        Expression rank = Expression.Constant(SearchRanking.Substring);
        foreach (var tier in tiers.OrderByDescending(t => t.Rank))
            rank = Expression.Condition(Rebind(tier.Predicate, parameter), Expression.Constant(tier.Rank), rank);

        if (requireMatch)
        {
            var any = tiers.Where(t => t.InFilter).Select(t => Rebind(t.Predicate, parameter)).Aggregate(Expression.OrElse);
            rows = rows.Where(Expression.Lambda<Func<T, bool>>(any, parameter));
        }
        else
        {
            rank = Expression.Constant(SearchRanking.Exact);
        }

        var item = typeof(Ranked<T>).GetProperty(nameof(Ranked<>.Item))!;
        var rankProperty = typeof(Ranked<T>).GetProperty(nameof(Ranked<>.Rank))!;
        var init = Expression.MemberInit(
            Expression.New(typeof(Ranked<T>)),
            Expression.Bind(item, parameter),
            Expression.Bind(rankProperty, rank));
        return rows.Select(Expression.Lambda<Func<T, Ranked<T>>>(init, parameter));
    }

    /// <summary>A LIKE tier predicate on a string column with <c>ESCAPE '\'</c>; the pattern becomes a SQL parameter.</summary>
    public static Expression<Func<T, bool>> Like<T>(Expression<Func<T, string?>> column, string pattern, bool binary = false)
    {
        var holder = new PatternHolder(pattern);
        var like = typeof(DbFunctionsExtensions).GetMethod(
            nameof(DbFunctionsExtensions.Like),
            [typeof(DbFunctions), typeof(string), typeof(string), typeof(string)])!;
        var body = Expression.Call(
            like,
            Expression.Constant(EF.Functions),
            binary ? Binary(column.Body) : column.Body,
            Expression.Property(Expression.Constant(holder), nameof(PatternHolder.Value)),
            Expression.Constant(SearchTerm.Escape));
        return Expression.Lambda<Func<T, bool>>(body, column.Parameters);
    }

    /// <summary>A case-insensitive equality tier predicate on a string column; the value becomes a SQL parameter.</summary>
    public static Expression<Func<T, bool>> Equal<T>(Expression<Func<T, string?>> column, string value, bool binary = false)
    {
        var holder = new PatternHolder(value);
        var body = Expression.Equal(binary ? Binary(column.Body) : column.Body, Expression.Property(Expression.Constant(holder), nameof(PatternHolder.Value)));
        return Expression.Lambda<Func<T, bool>>(body, column.Parameters);
    }

    /// <summary>
    /// The four text tiers (whole value, start, word start, anywhere) of one column. With <paramref name="binary"/> the column is compared as
    /// <c>LOWER(column) COLLATE Latin1_General_100_BIN2</c> against the lower-cased term: the same case-insensitive result, several times faster on a
    /// table with hundreds of thousands of rows (Assets), at the price of not using a prefix index seek.
    /// </summary>
    public static IEnumerable<Tier<T>> TextTiers<T>(Expression<Func<T, string?>> column, SearchTerm term, bool binary = false)
    {
        if (binary)
        {
            var lowered = term.Lowered;
            yield return new Tier<T>(SearchRanking.Exact, Equal(column, lowered.Text, binary: true), InFilter: false);
            yield return new Tier<T>(SearchRanking.StartsWith, Like(column, lowered.Prefix, binary: true), InFilter: false);
            yield return new Tier<T>(SearchRanking.WordStart, Like(column, lowered.WordStart, binary: true), InFilter: false);
            yield return new Tier<T>(SearchRanking.Substring, Like(column, lowered.Contains, binary: true));
            yield break;
        }

        // Whole value, start and word start all imply "contains", so only the last tier filters.
        yield return new Tier<T>(SearchRanking.Exact, Equal(column, term.Text), InFilter: false);
        yield return new Tier<T>(SearchRanking.StartsWith, Like(column, term.Prefix), InFilter: false);
        yield return new Tier<T>(SearchRanking.WordStart, Like(column, term.WordStart), InFilter: false);
        yield return new Tier<T>(SearchRanking.Substring, Like(column, term.Contains));
    }

    /// <summary>
    /// The tiers matching when the column matches any of the patterns (number prefixes). Unused <see cref="SearchTerm.Never"/> slots are left out;
    /// when none is left the result is empty, so a plain-text search adds no number predicates to the SQL at all.
    /// </summary>
    public static IEnumerable<Tier<T>> AnyLike<T>(int rank, Expression<Func<T, string?>> column, IEnumerable<string> patterns)
    {
        var used = patterns.Where(p => p != SearchTerm.Never).Select(p => Like(column, p)).ToList();
        if (used.Count > 0)
            yield return new Tier<T>(rank, used.Aggregate(OrElse));
    }

    /// <summary>An equality tier, or nothing when the value is the <see cref="SearchTerm.Never"/> sentinel.</summary>
    public static IEnumerable<Tier<T>> EqualTier<T>(int rank, Expression<Func<T, string?>> column, string value)
    {
        if (value != SearchTerm.Never)
            yield return new Tier<T>(rank, Equal(column, value));
    }

    /// <summary>Joins two predicates over the same row type with OR.</summary>
    public static Expression<Func<T, bool>> OrElse<T>(Expression<Func<T, bool>> left, Expression<Func<T, bool>> right)
    {
        var parameter = left.Parameters[0];
        return Expression.Lambda<Func<T, bool>>(Expression.OrElse(left.Body, Rebind(right, parameter)), parameter);
    }

    /// <summary><c>LOWER(column) COLLATE Latin1_General_100_BIN2</c>.</summary>
    private static Expression Binary(Expression column)
    {
        var lower = Expression.Call(column, typeof(string).GetMethod(nameof(string.ToLower), Type.EmptyTypes)!);
        var collate = typeof(RelationalDbFunctionsExtensions).GetMethod(nameof(RelationalDbFunctionsExtensions.Collate))!.MakeGenericMethod(typeof(string));
        return Expression.Call(collate, Expression.Constant(EF.Functions), lower, Expression.Constant(BinaryCollation));
    }

    private static Expression Rebind<T>(Expression<Func<T, bool>> lambda, ParameterExpression parameter) =>
        new ParameterReplacer(lambda.Parameters[0], parameter).Visit(lambda.Body);

    private sealed class PatternHolder(string value)
    {
        public string Value { get; } = value;
    }

    private sealed class ParameterReplacer(ParameterExpression from, ParameterExpression to) : ExpressionVisitor
    {
        protected override Expression VisitParameter(ParameterExpression node) => node == from ? to : base.VisitParameter(node);
    }
}
