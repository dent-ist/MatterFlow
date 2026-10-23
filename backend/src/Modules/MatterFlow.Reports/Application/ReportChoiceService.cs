using System.Globalization;
using MatterFlow.Reports.Application.Results;
using MatterFlow.Reports.Domain;
using MatterFlow.Reports.Domain.Parameters;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace MatterFlow.Reports.Application;

/// <summary>Stable codes of choice-list problems.</summary>
public static class ChoiceCodes
{
    public const string QueryFailed = "CHOICE_QUERY_FAILED";
    public const string QueryRejected = "CHOICE_QUERY_REJECTED";
    public const string Columns = "CHOICE_COLUMNS";
    public const string Unavailable = "REPORTS_UNAVAILABLE";
}

/// <summary>A choice list: the entries (at most 1,000) or why they could not be produced. <see cref="Detail"/> is for administrators only.</summary>
public sealed record ChoiceList(IReadOnlyList<ParameterOption> Options, bool Truncated, string? ErrorCode, string? Detail, int DurationMs)
{
    public bool IsOk => ErrorCode is null;

    public static ChoiceList Failed(string code, string detail) => new([], false, code, detail, 0);
}

/// <summary>The definitions of a run with their SELECT-driven lists filled in, or the lists that failed.</summary>
public sealed record ChoiceResolution(IReadOnlyList<ReportParameterDefinition> Definitions, IReadOnlyList<ParameterError> Errors);

/// <summary>
/// Produces the choice lists of single and multi choice parameters (spec 5.4). A <b>fixed</b> list is stored with the definition. A <b>query</b> list
/// runs the author's second SELECT through exactly the same compile, validate, bind, gate-free execute path and read-only login as a report (columns
/// <c>Value</c> and <c>Label</c>, at most 1,000 rows, 10 s), may use built-in values only, and is cached per person and query text for five minutes.
/// A value the user submits is always checked against the current list by the binder.
/// </summary>
public sealed class ReportChoiceService
{
    public static readonly TimeSpan CacheTime = TimeSpan.FromMinutes(5);

    private readonly IReportExecutor _executor;
    private readonly IReportsAvailability _availability;
    private readonly IReportRunLog _log;
    private readonly IMemoryCache _cache;
    private readonly ReportsOptions _options;
    private readonly ReportChoiceGate _gate;
    private readonly ICurrentUser _user;
    private readonly IReportCatalog _catalog;
    private readonly IReportDefinitionStore _definitions;
    private readonly BuiltInContextFactory _builtIns;

    public ReportChoiceService(
        IReportExecutor executor,
        IReportsAvailability availability,
        IReportRunLog log,
        IMemoryCache cache,
        IOptions<ReportsOptions> options,
        ReportChoiceGate gate,
        ICurrentUser user,
        IReportCatalog catalog,
        IReportDefinitionStore definitions,
        BuiltInContextFactory builtIns)
    {
        _executor = executor;
        _availability = availability;
        _log = log;
        _cache = cache;
        _options = options.Value;
        _gate = gate;
        _user = user;
        _catalog = catalog;
        _definitions = definitions;
        _builtIns = builtIns;
    }

    /// <summary>
    /// The choices of one parameter for a person who may run the report (assignment checked like a run: unknown, inactive and not assigned all answer 404).
    /// A fixed list comes from the definition, a SELECT list from the cache or the query. A lookup (matter, client, user, pod...) has no list here: the
    /// picker's own endpoint and its own permission serve it.
    /// </summary>
    public async Task<AdminResult<ChoiceList>> GetForUserAsync(int reportId, string parameter, CancellationToken cancellationToken)
    {
        if (_user.UserId is not { } userId)
            return AdminResult<ChoiceList>.Fail(401, ErrorCodes.Unauthenticated, "Sign in to run reports.");
        if (!_availability.Current.Enabled)
            return AdminResult<ChoiceList>.Fail(503, "REPORTS_UNAVAILABLE", ReportRunService.UnavailableMessage);
        var report = await _catalog.FindRunnableAsync(reportId, userId, cancellationToken);
        if (report is null)
            return AdminResult<ChoiceList>.Fail(404, ErrorCodes.NotFound, "This report does not exist or is not available to you.");

        var name = parameter.Trim().ToUpperInvariant();
        var definition = ParameterDefinitionJson.Deserialize(report.ParametersJson).FirstOrDefault(d => d.Name == name);
        if (definition is null)
            return AdminResult<ChoiceList>.Fail(404, ErrorCodes.NotFound, "This report has no such parameter.");
        if (definition.Type is not (ReportParameterType.Single or ReportParameterType.Multi))
            return AdminResult<ChoiceList>.Fail(400, "NO_CHOICE_LIST", definition.Type == ReportParameterType.Lookup ? "This parameter is picked with the search of the matching page, not from a list." : "This parameter has no list of choices.");
        if (definition.OptionsKind == OptionsKind.Fixed)
            return AdminResult<ChoiceList>.Ok(new ChoiceList(definition.Options, false, null, null, 0));

        var context = await _builtIns.CreateAsync(userId, cancellationToken);
        var start = new RunStart(report.ReportId, report.VersionId, userId, ReportRunKind.ChoiceQuery, null, Guid.NewGuid(), report.Name, report.VersionNo);
        var list = await QueryAsync(definition.OptionsSql ?? "", definition.ValueType, context, start, true, cancellationToken);
        return list.IsOk
            ? AdminResult<ChoiceList>.Ok(list)
            : AdminResult<ChoiceList>.Fail(503, "REPORT_CHOICES_FAILED", $"The choices could not be loaded (reference {ReportRunService.Reference(start.CorrelationId)}). Try again or tell an administrator.");
    }

    /// <summary>The author's "Test" button: runs an unsaved choice query for a saved report, never cached, and returns the reason in full when it fails.</summary>
    public async Task<AdminResult<ChoiceList>> TestAsync(int reportId, string? sql, ChoiceValueType valueType, CancellationToken cancellationToken)
    {
        if (_user.UserId is not { } userId)
            return AdminResult<ChoiceList>.Fail(401, ErrorCodes.Unauthenticated, "Sign in to preview reports.");
        var report = await _definitions.GetAsync(reportId, cancellationToken);
        if (report?.CurrentVersionId is null)
            return AdminResult<ChoiceList>.Fail(404, ErrorCodes.NotFound, "This report does not exist.");
        if (string.IsNullOrWhiteSpace(sql))
            return AdminResult<ChoiceList>.Fail(400, "SQL_REQUIRED", "Enter the SELECT that returns the columns Value and Label.");
        if (sql.Length > SqlScanner.MaxQueryLength)
            return AdminResult<ChoiceList>.Fail(400, SqlValidationCodes.TextTooLong, "The query is too long.");

        var context = await _builtIns.CreateAsync(userId, cancellationToken);
        var start = new RunStart(report.ReportId, report.CurrentVersionId.Value, userId, ReportRunKind.ChoiceQuery, null, Guid.NewGuid(), report.Name, report.CurrentVersionNo ?? 0);
        return AdminResult<ChoiceList>.Ok(await QueryAsync(sql, valueType, context, start, false, cancellationToken));
    }

    /// <summary>Runs (or takes from the cache) one choice query. <paramref name="useCache"/> is false for the author's "Test" button.</summary>
    public async Task<ChoiceList> QueryAsync(string optionsSql, ChoiceValueType valueType, BuiltInContext context, RunStart logContext, bool useCache, CancellationToken cancellationToken)
    {
        if (!_availability.Current.Enabled)
            return ChoiceList.Failed(ChoiceCodes.Unavailable, _availability.Current.Message);

        var key = $"report-choices:{context.UserId}:{valueType}:{Convert.ToHexString(SqlValidator.Hash(optionsSql))}";
        if (useCache && _cache.TryGetValue(key, out ChoiceList? cached) && cached is not null)
            return cached;

        var (compiled, validation) = ReportSqlCompiler.CompileAndValidate(optionsSql, []);
        if (!validation.IsValid)
            return ChoiceList.Failed(ChoiceCodes.QueryRejected, string.Join(" ", validation.Errors.Select(e => $"Line {e.Line}: {e.Message}")));
        if (compiled.Scan.Placeholders.FirstOrDefault(p => !p.IsBuiltIn) is { } user)
            return ChoiceList.Failed(ChoiceCodes.QueryRejected, $"A choice list cannot use the parameter :{user.DisplayName}.");
        var bind = ParameterBinder.Bind([], new Dictionary<string, System.Text.Json.JsonElement>(), context, compiled.UsedPlaceholders);

        await _gate.Slots.WaitAsync(cancellationToken);
        try
        {
            var start = logContext with { Kind = ReportRunKind.ChoiceQuery, ParametersJson = null };
            var runId = await _log.StartAsync(start, CancellationToken.None);
            var builder = new ResultTableBuilder(_options.ChoiceQueryMaxRows, (long)_options.ResultMemoryBudgetMegabytes * 1024 * 1024);
            var outcome = await _executor.ExecuteAsync(
                new ExecutionRequest(compiled.SqlText, bind.Parameters, _options.ChoiceQueryTimeoutSeconds, _options.ChoiceQueryMaxRows, _options.ChoiceQueryMaxRows),
                builder,
                cancellationToken);
            await _log.CompleteAsync(runId, start, new RunCompletion(outcome.Status, outcome.RowCount, outcome.Truncated, outcome.DurationMs, outcome.ErrorCode, null), CancellationToken.None);

            if (outcome.Status is not (ReportRunStatus.Succeeded or ReportRunStatus.Truncated))
            {
                var detail = outcome.Status == ReportRunStatus.TimedOut ? $"The choice query took longer than {_options.ChoiceQueryTimeoutSeconds} seconds." : outcome.AdminDetail ?? "The choice query failed.";
                return ChoiceList.Failed(ChoiceCodes.QueryFailed, detail);
            }

            var list = Read(builder.Build(), valueType, outcome.Truncated, outcome.DurationMs);
            if (list.IsOk && useCache)
                _cache.Set(key, list, CacheTime);
            return list;
        }
        finally
        {
            _gate.Slots.Release();
        }
    }

    internal static ChoiceList Read(ResultTable table, ChoiceValueType valueType, bool truncated, int durationMs)
    {
        var valueColumn = table.IndexOf("Value");
        var labelColumn = table.IndexOf("Label");
        if (valueColumn < 0 || labelColumn < 0)
            return ChoiceList.Failed(ChoiceCodes.Columns, "The choice query must return the columns Value and Label.");

        var options = new List<ParameterOption>(table.RowCount);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var row = 0; row < table.RowCount; row++)
        {
            var value = Text(table.Get(row, valueColumn));
            if (value is null)
                continue;
            if (value.Length == 0 || value.Length > ReportParameterDefinition.MaxChoiceTextLength)
                return ChoiceList.Failed(ChoiceCodes.QueryFailed, $"Row {row + 1}: the Value must have 1 to {ReportParameterDefinition.MaxChoiceTextLength} characters.");
            if (valueType == ChoiceValueType.Int && !int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out _))
                return ChoiceList.Failed(ChoiceCodes.QueryFailed, $"Row {row + 1}: the Value '{(value.Length > 30 ? value[..30] : value)}' is not a whole number.");
            if (!seen.Add(value))
                continue;
            var label = Text(table.Get(row, labelColumn));
            options.Add(new ParameterOption(value, string.IsNullOrEmpty(label) ? value : label.Length > 200 ? label[..200] : label));
        }

        return new ChoiceList(options, truncated, null, null, durationMs);
    }

    private static string? Text(object? cell) => cell switch
    {
        null => null,
        string s => s.Trim(),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => cell.ToString(),
    };

    /// <summary>
    /// Fills in the SELECT-driven lists that the SQL uses. A failing list is reported as a parameter error on that parameter; administrators get
    /// the reason, run-only people a plain sentence (the text can name objects).
    /// </summary>
    public async Task<ChoiceResolution> ResolveAsync(
        IReadOnlyList<ReportParameterDefinition> definitions,
        IReadOnlySet<string> usedPlaceholders,
        BuiltInContext context,
        RunStart logContext,
        bool adminDetail,
        bool useCache,
        CancellationToken cancellationToken)
    {
        var resolved = new List<ReportParameterDefinition>(definitions.Count);
        var errors = new List<ParameterError>();
        foreach (var d in definitions)
        {
            if (d.OptionsKind != OptionsKind.Query || string.IsNullOrWhiteSpace(d.OptionsSql) || !d.PlaceholderNames.Any(usedPlaceholders.Contains))
            {
                resolved.Add(d);
                continue;
            }

            var list = await QueryAsync(d.OptionsSql, d.ValueType, context, logContext, useCache, cancellationToken);
            if (!list.IsOk)
            {
                errors.Add(new ParameterError(d.Name, list.ErrorCode!, adminDetail ? $"The choice list could not be loaded: {list.Detail}" : "The choices for this parameter could not be loaded. Try again or tell an administrator."));
                resolved.Add(d);
                continue;
            }

            resolved.Add(d with { Options = list.Options });
        }

        return new ChoiceResolution(resolved, errors);
    }
}

/// <summary>Application-wide limit on choice queries running at the same time (they do not use a person's one-report slot, so opening a form never blocks a run).</summary>
public sealed class ReportChoiceGate(IOptions<ReportsOptions> options)
{
    public SemaphoreSlim Slots { get; } = new(Math.Max(1, options.Value.GlobalConcurrency));
}
