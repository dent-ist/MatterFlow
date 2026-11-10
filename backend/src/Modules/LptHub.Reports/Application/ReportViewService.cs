using MatterFlow.Reports.Application.Results;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;

namespace MatterFlow.Reports.Application;

public sealed record ViewResult<T>(T? Value, RunProblem? Problem)
{
    public static ViewResult<T> Ok(T value) => new(value, null);

    public static ViewResult<T> Fail(RunProblem problem) => new(default, problem);
}

/// <summary>
/// Personal saved views of a report's result grid (issue #722, spec section 6): list, save, rename, delete, default. A view belongs to one person and
/// one report; everything is looked up with both, so another person's view is "not found" (404), never "forbidden". Views of a report the person may
/// not run are not found either (the same rule as running it). A view holds layout only: no parameter values, no data, nothing that reaches SQL. No audit
/// event is written: a view is a personal preference (spec section 13 lists no view events).
/// </summary>
public sealed class ReportViewService(ICurrentUser user, IReportCatalog catalog, IReportViewStore store, ReportResultStore results)
{
    public const string ViewNotFoundMessage = "This view does not exist.";

    public async Task<ViewResult<IReadOnlyList<ReportViewResponseModel>>> ListAsync(int reportId, CancellationToken cancellationToken)
    {
        var access = await Authorize(reportId, cancellationToken);
        if (access.Problem is { } problem)
            return ViewResult<IReadOnlyList<ReportViewResponseModel>>.Fail(problem);

        var rows = await store.ListAsync(reportId, access.UserId, cancellationToken);
        return ViewResult<IReadOnlyList<ReportViewResponseModel>>.Ok(rows.Select(r => ToModel(r, [])).ToList());
    }

    public async Task<ViewResult<ReportViewResponseModel>> CreateAsync(int reportId, string? name, ReportViewLayout? layout, bool isDefault, CancellationToken cancellationToken)
    {
        var access = await Authorize(reportId, cancellationToken);
        if (access.Problem is { } problem)
            return ViewResult<ReportViewResponseModel>.Fail(problem);

        var (cleanName, nameError) = ReportViewLayoutRules.CheckName(name);
        if (nameError is not null)
            return Invalid(nameError, "name");
        var (clean, ignored, layoutError) = ReportViewLayoutRules.Sanitize(layout, KnownColumns(access.UserId, reportId));
        if (layoutError is not null)
            return Invalid(layoutError, "layout");

        var (result, row) = await store.CreateAsync(reportId, access.UserId, cleanName!, ViewJson.Write(clean!), isDefault, ReportViewLayoutRules.MaxViewsPerReport, cancellationToken);
        return Map(result, row, ignored);
    }

    public async Task<ViewResult<ReportViewResponseModel>> UpdateAsync(int reportId, int viewId, string? name, ReportViewLayout? layout, CancellationToken cancellationToken)
    {
        var access = await Authorize(reportId, cancellationToken);
        if (access.Problem is { } problem)
            return ViewResult<ReportViewResponseModel>.Fail(problem);
        if (name is null && layout is null)
            return Invalid(new FieldError("NOTHING_TO_SAVE", "Give a new name or a new layout."), "name");

        string? cleanName = null;
        if (name is not null)
        {
            var (checkedName, nameError) = ReportViewLayoutRules.CheckName(name);
            if (nameError is not null)
                return Invalid(nameError, "name");
            cleanName = checkedName;
        }

        string? json = null;
        IReadOnlyList<string> ignored = [];
        if (layout is not null)
        {
            var (clean, ignoredColumns, layoutError) = ReportViewLayoutRules.Sanitize(layout, KnownColumns(access.UserId, reportId));
            if (layoutError is not null)
                return Invalid(layoutError, "layout");
            json = ViewJson.Write(clean!);
            ignored = ignoredColumns;
        }

        var (result, row) = await store.UpdateAsync(viewId, reportId, access.UserId, cleanName, json, cancellationToken);
        return Map(result, row, ignored);
    }

    public async Task<ViewResult<bool>> DeleteAsync(int reportId, int viewId, CancellationToken cancellationToken)
    {
        var access = await Authorize(reportId, cancellationToken);
        if (access.Problem is { } problem)
            return ViewResult<bool>.Fail(problem);
        return await store.DeleteAsync(viewId, reportId, access.UserId, cancellationToken)
            ? ViewResult<bool>.Ok(true)
            : ViewResult<bool>.Fail(NotFound());
    }

    public async Task<ViewResult<ReportViewResponseModel>> SetDefaultAsync(int reportId, int viewId, bool isDefault, CancellationToken cancellationToken)
    {
        var access = await Authorize(reportId, cancellationToken);
        if (access.Problem is { } problem)
            return ViewResult<ReportViewResponseModel>.Fail(problem);
        var row = await store.SetDefaultAsync(viewId, reportId, access.UserId, isDefault, cancellationToken);
        return row is null ? ViewResult<ReportViewResponseModel>.Fail(NotFound()) : ViewResult<ReportViewResponseModel>.Ok(ToModel(row, []));
    }

    private sealed record Access(int UserId, RunProblem? Problem);

    private async Task<Access> Authorize(int reportId, CancellationToken cancellationToken)
    {
        if (user.UserId is not { } userId)
            return new Access(0, new RunProblem(401, ErrorCodes.Unauthenticated, "Sign in to use reports."));
        // The same rule as running the report: unknown, inactive, deactivated category and unassigned all look alike.
        if (await catalog.FindRunnableAsync(reportId, userId, cancellationToken) is null)
            return new Access(userId, new RunProblem(404, ErrorCodes.NotFound, ReportRunService.NotAvailableMessage));
        return new Access(userId, null);
    }

    private IReadOnlyCollection<string>? KnownColumns(int userId, int reportId) => results.PeekTable(userId, reportId)?.Columns.Select(c => c.Name).ToList();

    private static RunProblem NotFound() => new(404, ErrorCodes.NotFound, ViewNotFoundMessage);

    private static ViewResult<ReportViewResponseModel> Invalid(FieldError error, string field) =>
        ViewResult<ReportViewResponseModel>.Fail(new RunProblem(
            422,
            "REPORT_VIEW_INVALID",
            error.Message,
            new Dictionary<string, IReadOnlyList<FieldError>> { [field] = [error] }));

    private static ViewResult<ReportViewResponseModel> Map(ViewWrite result, SavedViewRow? row, IReadOnlyList<string> ignored) => result switch
    {
        ViewWrite.Ok => ViewResult<ReportViewResponseModel>.Ok(ToModel(row!, ignored)),
        ViewWrite.NameTaken => ViewResult<ReportViewResponseModel>.Fail(new RunProblem(409, "VIEW_NAME_EXISTS", "You already have a view with this name.")),
        ViewWrite.LimitReached => ViewResult<ReportViewResponseModel>.Fail(new RunProblem(409, "VIEW_LIMIT_REACHED", $"You can save up to {ReportViewLayoutRules.MaxViewsPerReport} views for this report.")),
        _ => ViewResult<ReportViewResponseModel>.Fail(NotFound()),
    };

    private static ReportViewResponseModel ToModel(SavedViewRow row, IReadOnlyList<string> ignored) =>
        new(row.ViewId, row.Name, row.IsDefault, ViewJson.Read(row.ViewJson), row.CreatedAtUtc, row.ModifiedAtUtc, ignored);
}
