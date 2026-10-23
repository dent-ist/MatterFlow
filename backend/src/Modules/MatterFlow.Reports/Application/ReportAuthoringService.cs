using System.Text.Json;
using MatterFlow.Reports.Domain;
using MatterFlow.Reports.Domain.Parameters;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
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

public sealed record ReportStateProblem(int Status, string Code, string Message, IReadOnlyDictionary<string, IReadOnlyList<FieldError>>? Errors = null);

/// <summary>What saving did.</summary>
/// <param name="Version">The version after the save (the appended one, or the current one when no version was written).</param>
/// <param name="Unchanged">True when no new version was written (text and parameters equal the current version, or only details were saved).</param>
/// <param name="Deactivated">True when the report was active and had to be deactivated because the new text was not previewed.</param>
public sealed record SaveVersionResult(SaveOutcome? Version, bool Unchanged, bool Deactivated, PreviewResult? Preview, ReportStateProblem? Problem);

/// <summary>A save from the editor: details and/or a new version.</summary>
/// <param name="ExpectedRowVersion">The row version the editor last read (from <c>If-Match</c>).</param>
/// <param name="Details">The unversioned fields; null leaves them alone.</param>
/// <param name="Sql">The query text; null saves no version.</param>
/// <param name="ParametersJson">The parameter definitions (JSON array).</param>
/// <param name="RestoredFromVersionNo">Set by a restore (always appends a version).</param>
public sealed record SaveReportCommand(
    int ReportId,
    byte[]? ExpectedRowVersion,
    ReportDetails? Details,
    string? Sql,
    string? ParametersJson,
    string? ChangeNote,
    bool KeepActive,
    IReadOnlyDictionary<string, JsonElement> SampleValues,
    int? RestoredFromVersionNo = null);

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
    private readonly ReportChoiceService _choices;

    public ReportAuthoringService(
        ICurrentUser user,
        BuiltInContextFactory builtIns,
        IReportDefinitionStore store,
        IReportExecutor executor,
        IReportRunLog log,
        ReportRunGate gate,
        IReportsAvailability availability,
        IOptions<ReportsOptions> options,
        ReportChoiceService choices)
    {
        _user = user;
        _builtIns = builtIns;
        _store = store;
        _executor = executor;
        _log = log;
        _gate = gate;
        _availability = availability;
        _options = options.Value;
        _choices = choices;
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
            definitions = ParameterDefinitionValidator.Normalize(ParameterDefinitionJson.Deserialize(parametersJson ?? report.ParametersJson ?? "[]"));
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

        // The author's unsaved SELECT lists run exactly as they will for users (no cache, so an edit shows at once); sample values come from the real lists.
        var choices = await _choices.ResolveAsync(definitions, compiled.UsedPlaceholders, context, start, adminDetail: true, useCache: false, cancellationToken);
        if (choices.Errors.Count > 0)
        {
            await _log.RecordRejectedAsync(start, "CHOICES_FAILED", CancellationToken.None);
            return new PreviewResult(false, "Rejected", [], [], 0, false, 0, [], choices.Errors, null, null, false, null, null);
        }

        definitions = choices.Definitions;
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
    /// Saves a report: the unversioned details and/or a new version of the SQL and parameter definitions, in one step. Identical text and parameters write
    /// no version. If <see cref="SaveReportCommand.KeepActive"/> the text is previewed first (nothing is lost when that fails); a version that passed keeps
    /// an active report active, anything else deactivates it ("Saved as version n. Preview it to activate.").
    /// </summary>
    public async Task<SaveVersionResult> SaveAsync(SaveReportCommand command, CancellationToken cancellationToken)
    {
        var report = await _store.GetAsync(command.ReportId, cancellationToken);
        if (report is null)
            return SaveFailed(404, ErrorCodes.NotFound, "This report does not exist.");
        if (command.ExpectedRowVersion is { } expected && !expected.AsSpan().SequenceEqual(report.RowVersion))
            return SaveFailed(409, ErrorCodes.ConcurrencyConflict, "The report was changed by someone else. Reload it and apply your changes again.");

        string? parametersJson = null;
        byte[]? hash = null;
        var contentChanged = false;
        if (command.Sql is not null)
        {
            var normalized = NormalizeParameters(command.ParametersJson ?? "[]", out var problem);
            if (problem is not null)
                return new SaveVersionResult(null, false, false, null, problem);
            parametersJson = normalized;
            hash = SqlValidator.Hash(command.Sql);
            contentChanged = command.RestoredFromVersionNo is not null
                || report.SqlHash is null
                || !hash.AsSpan().SequenceEqual(report.SqlHash)
                || Canonical(parametersJson) != Canonical(report.ParametersJson ?? "[]");
        }

        PreviewResult? preview = null;
        var previewedOk = false;
        if (contentChanged && command.KeepActive && report.IsActive && command.RestoredFromVersionNo is null)
        {
            preview = await PreviewAsync(command.ReportId, command.Sql, parametersJson, command.SampleValues, cancellationToken);
            previewedOk = preview.Success;
        }

        var saved = await _store.SaveAsync(
            new SaveDefinition(command.ReportId, command.ExpectedRowVersion, command.Details, command.Sql, hash, parametersJson, command.ChangeNote, previewedOk, command.RestoredFromVersionNo, _user.UserId),
            CancellationToken.None);
        return saved.Status switch
        {
            StoreStatus.Ok => new SaveVersionResult(saved.Value, !saved.Value!.VersionAdded, saved.Value.Deactivated, preview, null),
            StoreStatus.Conflict => SaveFailed(409, ErrorCodes.ConcurrencyConflict, "The report was changed by someone else. Reload it and apply your changes again."),
            StoreStatus.DuplicateName => SaveFailed(409, "DUPLICATE_NAME", "Another report already has this name."),
            StoreStatus.CategoryInvalid => SaveFailed(422, "CATEGORY_INVALID", "Choose an active category."),
            _ => SaveFailed(404, ErrorCodes.NotFound, "This report does not exist."),
        };
    }

    /// <summary>Reads, normalises and checks the parameter definitions of a save; returns the canonical JSON or the problem (422 with a message per parameter field).</summary>
    public static string NormalizeParameters(string json, out ReportStateProblem? problem)
    {
        problem = null;
        IReadOnlyList<ReportParameterDefinition> definitions;
        try
        {
            definitions = ParameterDefinitionValidator.Normalize(ParameterDefinitionJson.Deserialize(json));
        }
        catch (JsonException)
        {
            problem = new ReportStateProblem(400, "PARAMETERS_INVALID", "The parameter definitions could not be read.");
            return "[]";
        }

        var issues = ParameterDefinitionValidator.Validate(definitions);
        if (issues.Count > 0)
        {
            var errors = issues
                .GroupBy(i => i.Parameter.Length == 0 ? "parameters" : $"parameters.{i.Parameter}.{i.Field}", StringComparer.Ordinal)
                .ToDictionary(g => g.Key, g => (IReadOnlyList<FieldError>)g.Select(i => new FieldError(i.Code, i.Message)).ToList());
            problem = new ReportStateProblem(422, "REPORT_DEFINITION_INVALID", "Some parameter definitions are not valid.", errors);
            return "[]";
        }

        return ParameterDefinitionJson.Serialize(definitions);
    }

    /// <summary>Parameter definitions compared as data: the same definitions written in a different order of properties are equal.</summary>
    internal static string Canonical(string parametersJson)
    {
        try
        {
            return ParameterDefinitionJson.Serialize(ParameterDefinitionValidator.Normalize(ParameterDefinitionJson.Deserialize(parametersJson)));
        }
        catch (JsonException)
        {
            return parametersJson;
        }
    }

    private static PreviewResult Refused(int status, string code, string message) =>
        new(false, "Refused", [], [], 0, false, 0, [], [], null, null, false, null, new PreviewProblem(status, code, message));

    private static SaveVersionResult SaveFailed(int status, string code, string message) => new(null, false, false, null, new ReportStateProblem(status, code, message));

    private static ReportStateResult Failed(int status, string code, string message) => new(false, new ReportStateProblem(status, code, message), false, null, null);
}
