using System.Text.Json;
using MatterFlow.Reports.Domain;
using MatterFlow.Reports.Domain.Parameters;
using MatterFlow.SharedKernel.Identity;
using Microsoft.Extensions.Options;

namespace MatterFlow.Reports.Application;

/// <summary>The outcome of a preview (spec 6.6). For administrators only: it may contain SQL Server's own error text.</summary>
/// <param name="Success">True when the query ran and returned at most the cap.</param>
/// <param name="Columns">Columns of the result.</param>
/// <param name="Rows">The first rows (at most 20).</param>
/// <param name="RowCount">Rows counted up to the cap.</param>
/// <param name="ExceedsCap">True when the full result would be cut off at the row cap.</param>
/// <param name="ValidationErrors">Why the text was refused before it ran.</param>
/// <param name="ParameterErrors">Why the sample values were refused.</param>
/// <param name="SqlError">SQL Server's message and line when the query failed (not shown to people who only run reports).</param>
/// <param name="CountsForActivation">True when this exact saved version (text and parameters) passed, so it can now be activated.</param>
public sealed record PreviewResult(
    bool Success,
    string Status,
    IReadOnlyList<ResultColumn> Columns,
    IReadOnlyList<IReadOnlyList<object?>> Rows,
    int RowCount,
    bool ExceedsCap,
    int DurationMs,
    IReadOnlyList<SqlValidationError> ValidationErrors,
    IReadOnlyList<ParameterError> ParameterErrors,
    string? SqlError,
    int? SqlErrorLine,
    bool CountsForActivation,
    byte[]? RowVersion,
    PreviewProblem? Problem);

/// <summary>A preview that could not even start.</summary>
public sealed record PreviewProblem(int Status, string Code, string Message);

public sealed record ReportStateResult(bool Ok, ReportStateProblem? Problem, bool IsActive, int? CurrentVersionId, byte[]? RowVersion);

public sealed record ReportStateProblem(int Status, string Code, string Message);

/// <summary>What saving a version did.</summary>
/// <param name="Version">The appended version (or the current one when nothing changed).</param>
/// <param name="Unchanged">True when text and parameters equal the current version, so no new version was written.</param>
/// <param name="Deactivated">True when the report was active and had to be deactivated because the new text was not previewed.</param>
public sealed record SaveVersionResult(AddedVersion? Version, bool Unchanged, bool Deactivated, PreviewResult? Preview, ReportStateProblem? Problem);

/// <summary>
/// Preview, the activation gate and the version rule for report authors (spec 6.6, 6.7). A preview runs the unsaved editor text through the same
/// validator, binder, gate and read-only connection as a run, with sample values, 20 rows and a 15 s limit, and is logged as a preview. Only a
/// successful preview of exactly the saved text and parameters lets the report be activated; a saved new version of an active report stays active
/// only when it was previewed in the same action, otherwise the report is deactivated (never serve unreviewed SQL).
/// </summary>
public sealed class ReportAuthoringService
{
    private readonly ICurrentUser _user;
    private readonly BuiltInContextFactory _builtIns;
    private readonly IReportDefinitionStore _store;
    private readonly IReportExecutor _executor;
    private readonly IReportRunLog _log;
    private readonly ReportRunGate _gate;
    private readonly IReportsAvailability _availability;
    private readonly ReportsOptions _options;

    public ReportAuthoringService(
        ICurrentUser user,
        BuiltInContextFactory builtIns,
        IReportDefinitionStore store,
        IReportExecutor executor,
        IReportRunLog log,
        ReportRunGate gate,
        IReportsAvailability availability,
        IOptions<ReportsOptions> options)
    {
        _user = user;
        _builtIns = builtIns;
        _store = store;
        _executor = executor;
        _log = log;
        _gate = gate;
        _availability = availability;
        _options = options.Value;
    }

    /// <summary>
    /// Runs a preview. <paramref name="sql"/> and <paramref name="parametersJson"/> are the editor's unsaved text and definitions (null = the saved ones);
    /// <paramref name="sampleValues"/> are the author's typed values.
    /// </summary>
    public async Task<PreviewResult> PreviewAsync(int reportId, string? sql, string? parametersJson, IReadOnlyDictionary<string, JsonElement> sampleValues, CancellationToken cancellationToken)
    {
        var report = await _store.GetAsync(reportId, cancellationToken);
        if (report is null)
            return Refused(404, "NOT_FOUND", "This report does not exist.");
        if (report.CurrentVersionId is null)
            return Refused(409, "NO_VERSION", "Save the report before previewing it.");
        if (_user.UserId is not { } userId)
            return Refused(401, "UNAUTHENTICATED", "Sign in to preview reports.");
        if (!_availability.Current.Enabled)
            return Refused(503, "REPORTS_UNAVAILABLE", _availability.Current.Message);

        var text = sql ?? report.SqlText!;
        IReadOnlyList<ReportParameterDefinition> definitions;
        try
        {
            definitions = ParameterDefinitionJson.Deserialize(parametersJson ?? report.ParametersJson ?? "[]");
        }
        catch (JsonException)
        {
            return Refused(400, "PARAMETERS_INVALID", "The parameter definitions could not be read.");
        }

        var correlation = Guid.NewGuid();
        var start = new RunStart(reportId, report.CurrentVersionId.Value, userId, ReportRunKind.Preview, null, correlation, report.Name, report.CurrentVersionNo ?? 0);
        var (compiled, validation) = ReportSqlCompiler.CompileAndValidate(text, definitions);
        if (!validation.IsValid)
        {
            await _log.RecordRejectedAsync(start, "VALIDATION_FAILED", CancellationToken.None);
            return new PreviewResult(false, "Rejected", [], [], 0, false, 0, validation.Errors, [], null, null, false, null, null);
        }

        var context = await _builtIns.CreateAsync(userId, cancellationToken);
        var values = ReportSamples.Complete(definitions, sampleValues, context);
        var bind = ParameterBinder.Bind(definitions, values, context, compiled.UsedPlaceholders);
        if (!bind.IsValid)
        {
            await _log.RecordRejectedAsync(start with { ParametersJson = ReportRunService.LogJson(bind.Parameters) }, "PARAMETERS_INVALID", CancellationToken.None);
            return new PreviewResult(false, "Rejected", [], [], 0, false, 0, [], bind.Errors, null, null, false, null, null);
        }

        var (lease, denial) = _gate.TryEnter(userId, cancellationToken);
        if (lease is null)
            return denial switch
            {
                GateDenial.AlreadyRunning => Refused(409, "REPORT_ALREADY_RUNNING", "Another report is already running. Wait for it or cancel it."),
                GateDenial.RateLimited => Refused(429, "REPORT_RATE_LIMITED", "You have started many reports this hour. Try again later."),
                _ => Refused(429, "REPORT_BUSY", "Reports are busy right now. Try again in a moment."),
            };

        using (lease)
        {
            start = start with { ParametersJson = ReportRunService.LogJson(bind.Parameters) };
            var runId = await _log.StartAsync(start, CancellationToken.None);
            var maxRows = _options.EffectiveMaxRows(report.MaxRows);
            var builder = new Results.ResultTableBuilder(_options.PreviewRows, (long)_options.ResultMemoryBudgetMegabytes * 1024 * 1024);
            ExecutionOutcome outcome;
            try
            {
                outcome = await _executor.ExecuteAsync(new ExecutionRequest(compiled.SqlText, bind.Parameters, _options.PreviewTimeoutSeconds, maxRows, _options.PreviewRows), builder, lease.Token);
            }
            catch (Exception)
            {
                await _log.CompleteAsync(runId, start, new RunCompletion(ReportRunStatus.Failed, null, false, null, "UNEXPECTED", null), CancellationToken.None);
                throw;
            }

            await _log.CompleteAsync(runId, start, new RunCompletion(outcome.Status, outcome.RowCount, outcome.Truncated, outcome.DurationMs, outcome.ErrorCode, null), CancellationToken.None);

            if (outcome.Status is not (ReportRunStatus.Succeeded or ReportRunStatus.Truncated))
            {
                var message = outcome.Status == ReportRunStatus.TimedOut ? $"The preview took longer than {_options.PreviewTimeoutSeconds} seconds and was stopped." : outcome.AdminDetail;
                return new PreviewResult(false, outcome.Status.ToString(), outcome.Columns, [], outcome.RowCount, false, outcome.DurationMs, [], [], message, outcome.ErrorLine, false, null, null);
            }

            var table = builder.Build();
            var page = Results.ResultQuery.Page(table, [], [], 1, _options.PreviewRows);

            // Only the exact saved text and parameters count for activation; a preview of unsaved edits is just a preview.
            var exact = report.SqlHash is not null
                && SqlValidator.Hash(text).AsSpan().SequenceEqual(report.SqlHash)
                && Canonical(parametersJson ?? report.ParametersJson ?? "[]") == Canonical(report.ParametersJson ?? "[]");
            byte[]? rowVersion = null;
            if (exact)
                rowVersion = await _store.MarkPreviewOkAsync(reportId, report.CurrentVersionId.Value, userId, CancellationToken.None);

            return new PreviewResult(true, outcome.Status.ToString(), outcome.Columns, page.Rows, outcome.RowCount, outcome.Truncated, outcome.DurationMs, [], [], null, null, exact && rowVersion is not null, rowVersion, null);
        }
    }

    /// <summary>Activates a report. Allowed only when its current version passed a preview: 409 <c>PREVIEW_REQUIRED</c> otherwise.</summary>
    public async Task<ReportStateResult> ActivateAsync(int reportId, CancellationToken cancellationToken)
    {
        var report = await _store.GetAsync(reportId, cancellationToken);
        if (report is null)
            return Failed(404, "NOT_FOUND", "This report does not exist.");
        if (report.CurrentVersionId is null || report.LastPreviewOkVersionId != report.CurrentVersionId)
            return Failed(409, "PREVIEW_REQUIRED", "Preview the current version before activating it.");
        if (report.IsActive)
            return new ReportStateResult(true, null, true, report.CurrentVersionId, report.RowVersion);

        var rowVersion = await _store.SetActiveAsync(reportId, true, _user.UserId, CancellationToken.None);
        return rowVersion is null
            ? Failed(409, "PREVIEW_REQUIRED", "Preview the current version before activating it.")
            : new ReportStateResult(true, null, true, report.CurrentVersionId, rowVersion);
    }

    public async Task<ReportStateResult> DeactivateAsync(int reportId, CancellationToken cancellationToken)
    {
        var report = await _store.GetAsync(reportId, cancellationToken);
        if (report is null)
            return Failed(404, "NOT_FOUND", "This report does not exist.");
        if (!report.IsActive)
            return new ReportStateResult(true, null, false, report.CurrentVersionId, report.RowVersion);
        var rowVersion = await _store.SetActiveAsync(reportId, false, _user.UserId, CancellationToken.None);
        return new ReportStateResult(true, null, false, report.CurrentVersionId, rowVersion ?? report.RowVersion);
    }

    /// <summary>
    /// Saves a new version of a report. If <paramref name="keepActive"/> the text is previewed first (nothing is written when that fails); a version that passed
    /// keeps an active report active, anything else deactivates it ("Saved as version n. Preview it to activate.").
    /// </summary>
    public async Task<SaveVersionResult> SaveVersionAsync(int reportId, string sql, string parametersJson, string? changeNote, bool keepActive, IReadOnlyDictionary<string, JsonElement> sampleValues, CancellationToken cancellationToken)
    {
        var report = await _store.GetAsync(reportId, cancellationToken);
        if (report is null)
            return new SaveVersionResult(null, false, false, null, new ReportStateProblem(404, "NOT_FOUND", "This report does not exist."));

        var hash = SqlValidator.Hash(sql);
        if (report.SqlHash is not null && hash.AsSpan().SequenceEqual(report.SqlHash) && Canonical(parametersJson) == Canonical(report.ParametersJson ?? "[]"))
            return new SaveVersionResult(new AddedVersion(report.CurrentVersionId!.Value, report.CurrentVersionNo!.Value, report.IsActive, report.RowVersion), true, false, null, null);

        PreviewResult? preview = null;
        var previewedOk = false;
        if (keepActive && report.IsActive)
        {
            preview = await PreviewAsync(reportId, sql, parametersJson, sampleValues, cancellationToken);
            previewedOk = preview.Success;
        }

        var added = await _store.AddVersionAsync(reportId, sql, hash, parametersJson, changeNote, previewedOk, _user.UserId, CancellationToken.None);
        return new SaveVersionResult(added, false, report.IsActive && !added.IsActive, preview, null);
    }

    /// <summary>Parameter definitions compared as data: the same definitions written in a different order of properties are equal.</summary>
    internal static string Canonical(string parametersJson)
    {
        try
        {
            return ParameterDefinitionJson.Serialize(ParameterDefinitionJson.Deserialize(parametersJson));
        }
        catch (JsonException)
        {
            return parametersJson;
        }
    }

    private static PreviewResult Refused(int status, string code, string message) =>
        new(false, "Refused", [], [], 0, false, 0, [], [], null, null, false, null, new PreviewProblem(status, code, message));

    private static ReportStateResult Failed(int status, string code, string message) => new(false, new ReportStateProblem(status, code, message), false, null, null);
}
