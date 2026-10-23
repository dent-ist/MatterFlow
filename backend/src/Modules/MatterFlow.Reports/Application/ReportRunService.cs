using System.Text.Json;
using MatterFlow.Identity.Contracts;
using MatterFlow.Reports.Domain;
using MatterFlow.Reports.Domain.Parameters;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

namespace MatterFlow.Reports.Application;

/// <summary>What the run endpoint answers when a report ran. The rows stay on the server under <see cref="RunId"/>.</summary>
/// <param name="RunId">Unguessable id of the cached result, bound to the caller.</param>
/// <param name="Columns">Name and type of each column.</param>
/// <param name="RowCount">Rows kept (at most <see cref="MaxRows"/>).</param>
/// <param name="Truncated">True when the result was cut off at the row cap.</param>
/// <param name="DurationMs">How long the query ran.</param>
/// <param name="MaxRows">The cap that applied.</param>
public sealed record RunResponse(Guid RunId, IReadOnlyList<ResultColumn> Columns, int RowCount, bool Truncated, int DurationMs, int MaxRows);

/// <summary>A refused or failed run, with the HTTP status and stable code the endpoint answers.</summary>
public sealed record RunProblem(int Status, string Code, string Message, IReadOnlyDictionary<string, IReadOnlyList<FieldError>>? Errors = null, string? Reference = null);

public sealed record RunResult(RunResponse? Response, RunProblem? Problem)
{
    public static RunResult Ok(RunResponse response) => new(response, null);

    public static RunResult Fail(int status, string code, string message, IReadOnlyDictionary<string, IReadOnlyList<FieldError>>? errors = null, string? reference = null) =>
        new(null, new RunProblem(status, code, message, errors, reference));
}

/// <summary>
/// One report run for a person (spec 6.1): authorisation by assignment, hash and validator re-check of the stored text, parameter binding,
/// the per-user and global limits, the run log, the read-only execution and the cached result. Nothing here ever shows SQL text or
/// SQL Server's messages to the caller.
/// </summary>
public sealed class ReportRunService
{
    private readonly ICurrentUser _user;
    private readonly IPodDirectory _pods;
    private readonly IReportCatalog _catalog;
    private readonly IReportExecutor _executor;
    private readonly IReportRunLog _log;
    private readonly ReportRunGate _gate;
    private readonly IReportsAvailability _availability;
    private readonly ReportsOptions _options;
    private readonly IConfiguration _configuration;
    private readonly TimeProvider _time;
    private readonly IReportResultSink _results;

    public ReportRunService(
        ICurrentUser user,
        IPodDirectory pods,
        IReportCatalog catalog,
        IReportExecutor executor,
        IReportRunLog log,
        ReportRunGate gate,
        IReportsAvailability availability,
        IOptions<ReportsOptions> options,
        IConfiguration configuration,
        TimeProvider time,
        IReportResultSink results)
    {
        _user = user;
        _pods = pods;
        _catalog = catalog;
        _executor = executor;
        _log = log;
        _gate = gate;
        _availability = availability;
        _options = options.Value;
        _configuration = configuration;
        _time = time;
        _results = results;
    }

    public const string UnavailableMessage = "Reports are not available right now. Ask an administrator.";

    public async Task<RunResult> RunAsync(int reportId, IReadOnlyDictionary<string, JsonElement> parameters, CancellationToken requestAborted)
    {
        if (_user.UserId is not { } userId)
            return RunResult.Fail(401, ErrorCodes.Unauthenticated, "Sign in to run reports.");

        if (!_availability.Current.Enabled)
            return RunResult.Fail(503, "REPORTS_UNAVAILABLE", UnavailableMessage);

        var report = await _catalog.FindRunnableAsync(reportId, userId, requestAborted);
        if (report is null)
            return RunResult.Fail(404, ErrorCodes.NotFound, "This report does not exist or is not available to you.");

        var correlation = Guid.NewGuid();
        var start = new RunStart(report.ReportId, report.VersionId, userId, ReportRunKind.Run, null, correlation);

        // The stored text is checked again on every run: it must be the text that was validated, and it must still pass the validator.
        var definitions = ParameterDefinitionJson.Deserialize(report.ParametersJson);
        var compiled = ReportSqlCompiler.Compile(report.SqlText, definitions);
        var validation = SqlValidator.Validate(report.SqlText, compiled.Scan, compiled.Rewritten);
        if (!validation.Hash.AsSpan().SequenceEqual(report.SqlHash) || !validation.IsValid)
        {
            await _log.RecordRejectedAsync(start, validation.IsValid ? "HASH_MISMATCH" : "VALIDATION_FAILED", CancellationToken.None);
            return RunResult.Fail(409, "REPORT_INVALID", "This report cannot be run. Tell an administrator.", reference: Reference(correlation));
        }

        var context = await BuiltInsAsync(userId, requestAborted);
        var bind = ParameterBinder.Bind(definitions, parameters, context, compiled.UsedPlaceholders);
        if (!bind.IsValid)
        {
            await _log.RecordRejectedAsync(start with { ParametersJson = LogJson(bind.Parameters) }, "PARAMETERS_INVALID", CancellationToken.None);
            var error = ParameterErrors.ToError(bind.Errors);
            return RunResult.Fail(422, ParameterErrors.Code, error.Message, error.FieldErrors);
        }

        var (lease, denial) = _gate.TryEnter(userId, requestAborted);
        if (lease is null)
            return Denied(denial);

        using (lease)
        {
            var parametersJson = LogJson(bind.Parameters);
            var runId = await _log.StartAsync(start with { ParametersJson = parametersJson }, CancellationToken.None);
            var maxRows = _options.EffectiveMaxRows(report.MaxRows);
            var sink = _results.CreateSink(maxRows);
            ExecutionOutcome outcome;
            try
            {
                outcome = await _executor.ExecuteAsync(
                    new ExecutionRequest(compiled.SqlText, bind.Parameters, _options.EffectiveTimeout(report.TimeoutSeconds), maxRows, maxRows),
                    sink,
                    lease.Token);
            }
            catch (Exception)
            {
                await _log.CompleteAsync(runId, new RunCompletion(ReportRunStatus.Failed, null, false, null, "UNEXPECTED", null), CancellationToken.None);
                throw;
            }

            await _log.CompleteAsync(runId, new RunCompletion(outcome.Status, outcome.RowCount, outcome.Truncated, outcome.DurationMs, outcome.ErrorCode, null), CancellationToken.None);

            switch (outcome.Status)
            {
                case ReportRunStatus.Succeeded or ReportRunStatus.Truncated:
                    var stored = _results.Complete(sink, userId, report.ReportId, outcome.Truncated);
                    if (stored is null)
                        return RunResult.Fail(503, "REPORT_MEMORY", "There is not enough memory for this result right now. Narrow the parameters or try again in a moment.");
                    return RunResult.Ok(new RunResponse(stored.Value, outcome.Columns, outcome.RowCount, outcome.Truncated, outcome.DurationMs, maxRows));
                case ReportRunStatus.TimedOut:
                    return RunResult.Fail(408, "REPORT_TIMEOUT", $"The report took longer than {_options.EffectiveTimeout(report.TimeoutSeconds)} seconds and was stopped. Narrow the parameters.");
                case ReportRunStatus.Cancelled:
                    return RunResult.Fail(499, "REPORT_CANCELLED", "The report was cancelled.");
                default:
                    return RunResult.Fail(500, "REPORT_FAILED", $"The report could not be completed (reference {Reference(correlation)}).", reference: Reference(correlation));
            }
        }
    }

    /// <summary>Cancels the caller's running report; true when there was one.</summary>
    public bool CancelMine() => _user.UserId is { } id && _gate.Cancel(id);

    public static string Reference(Guid correlation) => correlation.ToString("N")[..8].ToUpperInvariant();

    private static RunResult Denied(GateDenial denial) => denial switch
    {
        GateDenial.AlreadyRunning => RunResult.Fail(409, "REPORT_ALREADY_RUNNING", "Another report is already running. Wait for it or cancel it."),
        GateDenial.RateLimited => RunResult.Fail(429, "REPORT_RATE_LIMITED", "You have started many reports this hour. Try again later."),
        _ => RunResult.Fail(429, "REPORT_BUSY", "Reports are busy right now. Try again in a moment."),
    };

    private async Task<BuiltInContext> BuiltInsAsync(int userId, CancellationToken cancellationToken)
    {
        var pods = await _pods.GetUserPodsAsync(userId, includeInactive: false, cancellationToken);
        var primary = await _pods.GetPrimaryPodAsync(userId, cancellationToken);
        var now = _time.GetUtcNow().UtcDateTime;
        var zone = UserTimeZone.Resolve(null, _configuration["Firm:TimeZoneId"]).Zone;
        var local = TimeZoneInfo.ConvertTimeFromUtc(now, zone);
        return new BuiltInContext(
            userId,
            _user.DisplayName ?? "",
            DateOnly.FromDateTime(local),
            now,
            pods.Select(p => p.Pod.PodId).Order().ToList(),
            primary?.PodId,
            (int)zone.GetUtcOffset(now).TotalMinutes);
    }

    /// <summary>The parameter values as bound (long values already shortened) as a JSON array of "NAME=value" strings; fits the 4,000-character column.</summary>
    internal static string LogJson(IReadOnlyList<BoundParameter> parameters)
    {
        var json = JsonSerializer.Serialize(parameters.Where(p => !BuiltInParameters.IsBuiltIn(p.Name)).Select(p => p.LogValue));
        return json.Length <= 4000 ? json : JsonSerializer.Serialize(new[] { $"({parameters.Count} parameters, too long to log)" });
    }
}

/// <summary>Creates the sink that collects a result and turns it into a stored, owner-bound result.</summary>
public interface IReportResultSink
{
    IRowSink CreateSink(int maxRows);

    /// <summary>Stores the collected result for <paramref name="ownerUserId"/> and returns its id; null when the memory budget cannot take it.</summary>
    Guid? Complete(IRowSink sink, int ownerUserId, int reportId, bool truncated);
}
