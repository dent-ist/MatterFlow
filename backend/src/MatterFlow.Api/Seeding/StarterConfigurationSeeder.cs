using MatterFlow.Assets.Application;
using MatterFlow.Configuration.Application.Forms;
using MatterFlow.Configuration.Application.TaskTypes;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Identity.Application;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkflowEngine.Application.Steps;
using MatterFlow.WorkflowEngine.Application.Workflows;
using MatterFlow.WorkflowEngine.Contracts;

namespace MatterFlow.Api.Seeding;

/// <summary>
/// Loads the SME starter configuration (docs/sme/seed-configuration.json) into the running system through the real application services,
/// so every form and workflow goes through the normal publish validation. Idempotent: items are matched by their unique name and an
/// existing item is never modified, except an untouched shell (an empty form or an empty first workflow draft) which is completed.
/// Run as the <see cref="SeedActor"/> (see <see cref="StarterConfigurationSeedExtensions"/>).
/// </summary>
public sealed class StarterConfigurationSeeder(
    FormAdminService forms,
    StepDefinitionService steps,
    WorkflowAdminService workflows,
    TaskTypeService taskTypes,
    AssetTypeService assetTypes,
    RoleAdministration roles,
    ILogger<StarterConfigurationSeeder> logger)
{
    /// <summary>Change note on the form versions the seed publishes; also marks a draft the seed may resume after an interrupted run.</summary>
    public const string SeedNote = "Starter configuration (SME seed)";

    private const string KindRole = "Role";
    private const string KindStep = "Step";
    private const string KindWorkflow = "Workflow";
    private const string KindTaskType = "TaskType";
    private const string KindAssetType = "AssetType";

    public async Task<StarterSeedReport> SeedAsync(StarterSeedData data, bool dryRun, CancellationToken ct = default)
    {
        var report = new StarterSeedReport(dryRun);
        logger.LogInformation("Starter configuration seed {Mode}.", dryRun ? "DRY RUN (nothing is written)" : "started");

        await SeedRolesAsync(data, report, dryRun, ct);
        var stepIds = await SeedStepsAsync(data, report, dryRun, ct);
        var workflowIds = await SeedWorkflowsAsync(data, stepIds, report, dryRun, ct);
        await SeedTaskTypesAsync(data, workflowIds, report, dryRun, ct);
        await SeedAssetTypesAsync(data, report, dryRun, ct);

        foreach (var action in report.Actions.Where(a => a.Outcome != SeedOutcome.Existing))
        {
            if (action.Outcome == SeedOutcome.Failed)
                logger.LogError("Seed {Kind} '{Name}' failed: {Detail}", action.Kind, action.Name, action.Detail);
            else
                logger.LogInformation("Seed {Kind} '{Name}': {Outcome}", action.Kind, action.Name, action.Outcome);
        }

        logger.LogInformation("Starter configuration seed finished. {Summary}", report.Summary());
        return report;
    }

    // ---- roles

    private async Task SeedRolesAsync(StarterSeedData data, StarterSeedReport report, bool dryRun, CancellationToken ct)
    {
        var existing = (await roles.ListAsync(ct)).Select(r => r.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var role in data.Roles.Where(r => !r.BuiltIn))
        {
            if (existing.Contains(role.Name))
            {
                // The five architecture starter roles are seeded by the Identity module; admin edits to any role are kept.
                report.Add(KindRole, role.Name, SeedOutcome.Existing);
                continue;
            }

            if (dryRun)
            {
                report.Add(KindRole, role.Name, SeedOutcome.WouldCreate);
                continue;
            }

            var created = await roles.CreateAsync(new SaveRoleRequest(role.Name, Trim(role.Description, 500), [.. role.Permissions], null), ct);
            report.Add(KindRole, role.Name, created.IsSuccess ? SeedOutcome.Created : SeedOutcome.Failed, created.IsSuccess ? null : Describe(created.Error!));
        }
    }

    // ---- step library

    private async Task<Dictionary<string, int>> SeedStepsAsync(StarterSeedData data, StarterSeedReport report, bool dryRun, CancellationToken ct)
    {
        var ids = new Dictionary<string, int>(StringComparer.Ordinal);
        var existing = await ListAllStepsAsync(ct);
        foreach (var step in data.StepDefinitions)
        {
            var fields = StarterFormBuilder.Build(step.Fields);
            if (!IsPublishable(fields, out var invalid))
            {
                report.Add(KindStep, step.Title, SeedOutcome.Failed, invalid);
                continue;
            }

            if (!existing.TryGetValue(step.Title, out var id))
            {
                if (dryRun)
                {
                    report.Add(KindStep, step.Title, SeedOutcome.WouldCreate);
                    ids[step.Code] = 0; // placeholder: the step will exist for the workflows of this dry run
                    continue;
                }

                var created = await steps.CreateAsync(
                    new CreateStepDefinitionRequest
                    {
                        Title = step.Title,
                        Description = Trim(step.Description, 1000),
                        Instructions = Trim(step.Instructions, CreateStepDefinitionRequest.MaxInstructions),
                        DocumentationUrl = Trim(step.DocUrl, 1000),
                    },
                    ct);
                if (created.IsFailure)
                {
                    report.Add(KindStep, step.Title, SeedOutcome.Failed, Describe(created.Error!));
                    continue;
                }

                id = created.Value.StepDefinitionId;
                var seeded = await SeedFormAsync(FormOwnerKind.Step, id, fields, dryRun, ct);
                report.Add(KindStep, step.Title, seeded.Failed ? SeedOutcome.Failed : SeedOutcome.Created, seeded.Error);
                ids[step.Code] = id;
                continue;
            }

            var completion = await SeedFormAsync(FormOwnerKind.Step, id, fields, dryRun, ct);
            report.Add(KindStep, step.Title, Outcome(completion), completion.Error);
            ids[step.Code] = id;
        }

        return ids;
    }

    private async Task<Dictionary<string, int>> ListAllStepsAsync(CancellationToken ct)
    {
        var result = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var page = 1; ; page++)
        {
            var listed = await steps.ListAsync(new StepDefinitionListQuery { Page = page, PageSize = 100 }, ct);
            if (listed.IsFailure)
                break;
            // Titles are unique among active steps only: an active step wins over a deactivated one of the same title.
            foreach (var s in listed.Value.Items.OrderBy(s => s.IsActive ? 0 : 1))
                result.TryAdd(s.Title, s.StepDefinitionId);
            if (page * 100 >= listed.Value.Total)
                break;
        }

        return result;
    }

    // ---- workflows

    private async Task<Dictionary<string, int>> SeedWorkflowsAsync(
        StarterSeedData data,
        IReadOnlyDictionary<string, int> stepIds,
        StarterSeedReport report,
        bool dryRun,
        CancellationToken ct)
    {
        var ids = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var existing = await ListAllWorkflowsAsync(ct);
        foreach (var workflow in data.Workflows)
        {
            var missing = workflow.Steps.Select(s => s.Step).Where(code => !stepIds.ContainsKey(code)).ToList();
            if (missing.Count > 0)
            {
                report.Add(KindWorkflow, workflow.Name, SeedOutcome.Failed, $"Step(s) {string.Join(", ", missing)} are not available.");
                continue;
            }

            var request = new SaveWorkflowDraftRequest
            {
                IsOrdered = workflow.Ordered,
                RowVersion = string.Empty,
                Steps =
                [
                    .. workflow.Steps.Select(s => new WorkflowStepPlacement
                    {
                        SourceStepDefinitionId = stepIds[s.Step],
                        IsSkippable = s.Skippable,
                        SkipCommentRequired = s.SkipCommentRequired,
                    }),
                ],
            };

            if (!existing.TryGetValue(workflow.Name, out var id))
            {
                if (dryRun)
                {
                    report.Add(KindWorkflow, workflow.Name, SeedOutcome.WouldCreate);
                    ids[workflow.Name] = 0;
                    continue;
                }

                var created = await workflows.CreateAsync(
                    new CreateWorkflowRequest { Name = workflow.Name, Description = Trim(workflow.Description, 1000), IsOrdered = workflow.Ordered },
                    ct);
                if (created.IsFailure)
                {
                    report.Add(KindWorkflow, workflow.Name, SeedOutcome.Failed, Describe(created.Error!));
                    continue;
                }

                var draft = created.Value.Versions.First(v => v.Status == WorkflowVersionStatus.Draft);
                var published = await FillAndPublishAsync(created.Value.Workflow.WorkflowDefinitionId, draft, request, ct);
                report.Add(KindWorkflow, workflow.Name, published is null ? SeedOutcome.Created : SeedOutcome.Failed, published);
                ids[workflow.Name] = created.Value.Workflow.WorkflowDefinitionId;
                continue;
            }

            ids[workflow.Name] = id;
            var detail = await workflows.GetAsync(id, ct);
            if (detail.IsFailure)
            {
                report.Add(KindWorkflow, workflow.Name, SeedOutcome.Failed, Describe(detail.Error!));
                continue;
            }

            // Only an untouched shell is completed: exactly one version, a draft that is empty or already holds the seed's steps.
            var versions = detail.Value.Versions;
            if (versions is [{ Status: WorkflowVersionStatus.Draft } only] && (only.StepCount == 0 || only.StepCount == workflow.Steps.Count))
            {
                if (dryRun)
                {
                    report.Add(KindWorkflow, workflow.Name, SeedOutcome.WouldComplete);
                    continue;
                }

                var error = await FillAndPublishAsync(id, versions[0], request, ct);
                report.Add(KindWorkflow, workflow.Name, error is null ? SeedOutcome.Completed : SeedOutcome.Failed, error);
                continue;
            }

            report.Add(KindWorkflow, workflow.Name, SeedOutcome.Existing);
        }

        return ids;
    }

    /// <summary>Saves the steps into the draft and publishes it. Returns an error text, or null on success.</summary>
    private async Task<string?> FillAndPublishAsync(int workflowId, WorkflowVersionSummary draft, SaveWorkflowDraftRequest request, CancellationToken ct)
    {
        var saved = await workflows.SaveDraftAsync(workflowId, draft.WorkflowVersionId, request with { RowVersion = draft.RowVersion }, ct);
        if (saved.IsFailure)
            return Describe(saved.Error!);
        var published = await workflows.PublishAsync(workflowId, draft.WorkflowVersionId, new WorkflowVersionActionRequest { RowVersion = saved.Value.Version.RowVersion }, ct);
        return published.IsFailure ? Describe(published.Error!) : null;
    }

    private async Task<Dictionary<string, int>> ListAllWorkflowsAsync(CancellationToken ct)
    {
        var result = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var page = 1; ; page++)
        {
            var listed = await workflows.ListAsync(new WorkflowListQuery { Page = page, PageSize = 100 }, ct);
            if (listed.IsFailure)
                break;
            foreach (var w in listed.Value.Items)
                result.TryAdd(w.Name, w.WorkflowDefinitionId);
            if (page * 100 >= listed.Value.Total)
                break;
        }

        return result;
    }

    // ---- task types

    private async Task SeedTaskTypesAsync(
        StarterSeedData data,
        IReadOnlyDictionary<string, int> workflowIds,
        StarterSeedReport report,
        bool dryRun,
        CancellationToken ct)
    {
        var existing = (await taskTypes.ListViewsAsync(ct)).GroupBy(t => t.Name, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);
        foreach (var type in data.TaskTypes)
        {
            var fields = StarterFormBuilder.Build(type.Fields);
            if (!IsPublishable(fields, out var invalid))
            {
                report.Add(KindTaskType, type.Name, SeedOutcome.Failed, invalid);
                continue;
            }

            if (existing.TryGetValue(type.Name, out var id))
            {
                var completion = await SeedFormAsync(FormOwnerKind.TaskType, id, fields, dryRun, ct);
                report.Add(KindTaskType, type.Name, Outcome(completion), completion.Error);
                continue;
            }

            var unavailable = type.EligibleWorkflows.Where(w => !workflowIds.ContainsKey(w)).ToList();
            if (unavailable.Count > 0)
            {
                report.Add(KindTaskType, type.Name, SeedOutcome.Failed, $"Workflow(s) {string.Join(", ", unavailable)} are not available.");
                continue;
            }

            if (dryRun)
            {
                report.Add(KindTaskType, type.Name, SeedOutcome.WouldCreate);
                continue;
            }

            var eligible = type.EligibleWorkflows.Select(w => workflowIds[w]).Distinct().ToList();
            var created = await taskTypes.CreateAsync(
                new CreateTaskTypeRequest(
                    type.Name,
                    Trim(Describe(type), 1000),
                    true,
                    eligible,
                    type.DefaultWorkflow is null ? eligible.FirstOrDefault() : workflowIds[type.DefaultWorkflow]),
                ct);
            if (created.IsFailure)
            {
                report.Add(KindTaskType, type.Name, SeedOutcome.Failed, Describe(created.Error!));
                continue;
            }

            var seeded = await SeedFormAsync(FormOwnerKind.TaskType, created.Value.Id, fields, dryRun, ct);
            report.Add(KindTaskType, type.Name, seeded.Failed ? SeedOutcome.Failed : SeedOutcome.Created, seeded.Error);
        }
    }

    /// <summary>The Task Type description with the SME's example title, which has no field of its own.</summary>
    private static string Describe(SeedTaskType type) =>
        string.IsNullOrWhiteSpace(type.TitleHint) ? type.Description ?? string.Empty : $"{type.Description} Example title: {type.TitleHint}";

    // ---- asset types

    private async Task SeedAssetTypesAsync(StarterSeedData data, StarterSeedReport report, bool dryRun, CancellationToken ct)
    {
        var existing = await ListAllAssetTypesAsync(ct);
        foreach (var type in data.AssetTypes)
        {
            var fields = StarterFormBuilder.BuildAssetType(type);
            if (!IsPublishable(fields, out var invalid))
            {
                report.Add(KindAssetType, type.Name, SeedOutcome.Failed, invalid);
                continue;
            }

            if (existing.TryGetValue(type.Name, out var id))
            {
                var completion = await SeedFormAsync(FormOwnerKind.AssetType, id, fields, dryRun, ct);
                report.Add(KindAssetType, type.Name, Outcome(completion), completion.Error);
                continue;
            }

            if (dryRun)
            {
                report.Add(KindAssetType, type.Name, SeedOutcome.WouldCreate);
                continue;
            }

            var created = await assetTypes.CreateAsync(new CreateAssetTypeRequest { Name = type.Name, Description = Trim(type.Naming?.Replace("`", string.Empty, StringComparison.Ordinal), 500) }, ct);
            if (created.IsFailure)
            {
                report.Add(KindAssetType, type.Name, SeedOutcome.Failed, Describe(created.Error!));
                continue;
            }

            var seeded = await SeedFormAsync(FormOwnerKind.AssetType, created.Value.AssetTypeId, fields, dryRun, ct);
            report.Add(KindAssetType, type.Name, seeded.Failed ? SeedOutcome.Failed : SeedOutcome.Created, seeded.Error);
        }
    }

    private async Task<Dictionary<string, int>> ListAllAssetTypesAsync(CancellationToken ct)
    {
        var result = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var page = 1; ; page++)
        {
            var listed = await assetTypes.ListAsync(new AssetTypeListQuery { Page = page, PageSize = 100 }, ct);
            if (listed.IsFailure)
                break;
            foreach (var t in listed.Value.Items)
                result.TryAdd(t.Name, t.AssetTypeId);
            if (page * 100 >= listed.Value.Total)
                break;
        }

        return result;
    }

    // ---- forms

    private enum FormSeedState
    {
        None,
        Seeded,
        WouldSeed,
        Existing,
        Failed,
    }

    private readonly record struct FormSeedResult(FormSeedState State, string? Error = null)
    {
        public bool Failed => State == FormSeedState.Failed;
    }

    private static SeedOutcome Outcome(FormSeedResult result) => result.State switch
    {
        FormSeedState.Seeded => SeedOutcome.Completed,
        FormSeedState.WouldSeed => SeedOutcome.WouldComplete,
        FormSeedState.Failed => SeedOutcome.Failed,
        _ => SeedOutcome.Existing,
    };

    /// <summary>
    /// Designs and publishes the owner's form unless it was already designed: a form with any version is left alone, except a single draft
    /// carrying <see cref="SeedNote"/> (an interrupted earlier run), which is resumed.
    /// </summary>
    private async Task<FormSeedResult> SeedFormAsync(FormOwnerKind kind, int ownerId, IReadOnlyList<FormFieldModel> fields, bool dryRun, CancellationToken ct)
    {
        if (fields.Count == 0)
            return new FormSeedResult(FormSeedState.None);

        var found = await forms.FindDefinitionAsync(kind, ownerId, ct);
        FormDefinitionModel? definition = found.IsSuccess ? found.Value : null;
        if (found.IsFailure && found.Error!.Type != ErrorType.NotFound)
            return new FormSeedResult(FormSeedState.Failed, Describe(found.Error!));

        var versions = definition?.Versions ?? [];
        var resumable = versions is [{ Status: FormVersionStatus.Draft, Notes: SeedNote } draftOnly] ? draftOnly : null;
        if (versions.Count > 0 && resumable is null)
            return new FormSeedResult(FormSeedState.Existing);

        if (dryRun)
            return new FormSeedResult(FormSeedState.WouldSeed);

        if (definition is null)
        {
            var ensured = await forms.EnsureDefinitionAsync(new EnsureFormDefinitionRequest { OwnerKind = kind, OwnerId = ownerId }, ct);
            if (ensured.IsFailure)
                return new FormSeedResult(FormSeedState.Failed, Describe(ensured.Error!));
            definition = ensured.Value;
        }

        string draftRowVersion;
        int draftId;
        if (resumable is not null)
        {
            draftRowVersion = resumable.RowVersion;
            draftId = resumable.FormVersionId;
        }
        else
        {
            var draft = await forms.CreateDraftAsync(definition.FormDefinitionId, new CreateFormDraftRequest(null, SeedNote), ct);
            if (draft.IsFailure)
                return new FormSeedResult(FormSeedState.Failed, Describe(draft.Error!));
            draftRowVersion = draft.Value.Version.RowVersion;
            draftId = draft.Value.Version.FormVersionId;
        }

        var saved = await forms.SaveDraftAsync(definition.FormDefinitionId, draftId, new SaveFormDraftRequest { Fields = fields, Notes = SeedNote, RowVersion = draftRowVersion }, ct);
        if (saved.IsFailure)
            return new FormSeedResult(FormSeedState.Failed, Describe(saved.Error!));
        var published = await forms.PublishAsync(definition.FormDefinitionId, draftId, saved.Value.Version.RowVersion, ct);
        return published.IsFailure
            ? new FormSeedResult(FormSeedState.Failed, Describe(published.Error!))
            : new FormSeedResult(FormSeedState.Seeded);
    }

    // ---- helpers

    private static bool IsPublishable(IReadOnlyList<FormFieldModel> fields, out string? problems)
    {
        if (fields.Count == 0)
        {
            problems = null;
            return true;
        }

        var outcome = StarterFormBuilder.Validate(fields);
        problems = outcome.IsValid
            ? null
            : "The seeded form does not pass publish validation: " + string.Join("; ", outcome.Issues.Select(i => $"{i.Code}{(i.FieldKey is null ? string.Empty : " (" + i.FieldKey + ")")}: {i.Message}"));
        return outcome.IsValid;
    }

    private static string? Trim(string? text, int max)
    {
        var value = text?.Trim();
        if (string.IsNullOrEmpty(value))
            return null;
        return value.Length <= max ? value : value[..(max - 1)] + "…";
    }

    private static string Describe(Error error)
    {
        var details = error.FieldErrors is null
            ? string.Empty
            : " [" + string.Join("; ", error.FieldErrors.Select(f => $"{f.Key}: {string.Join(", ", f.Value.Select(e => e.Code))}")) + "]";
        return $"{error.Code}: {error.Message}{details}";
    }
}

public static class StarterConfigurationSeedExtensions
{
    /// <summary>Registers the seeder and the seed actor.</summary>
    public static IServiceCollection AddStarterConfigurationSeeding(this IServiceCollection services)
    {
        SeedActor.AddSeedActor(services);
        services.AddScoped<StarterConfigurationSeeder>();
        return services;
    }

    /// <summary>
    /// Runs the seed when <c>Seed:StarterConfiguration:Enabled</c> is true (default: Development only), honoring <c>DryRun</c>.
    /// Call after schema migrations and the module seeds. A failing item is logged and reported; it never stops the host.
    /// </summary>
    public static async Task<StarterSeedReport?> SeedStarterConfigurationAsync(this IServiceProvider services, CancellationToken cancellationToken = default)
    {
        var options = StarterConfigurationOptions.From(services.GetRequiredService<IConfiguration>(), services.GetRequiredService<IHostEnvironment>());
        return options.Enabled ? await services.RunStarterConfigurationSeedAsync(StarterSeedData.LoadEmbedded(), options.DryRun, cancellationToken) : null;
    }

    /// <summary>Runs the seed in its own scope as the seed actor, regardless of configuration (used by startup and by tests).</summary>
    public static async Task<StarterSeedReport> RunStarterConfigurationSeedAsync(
        this IServiceProvider services,
        StarterSeedData data,
        bool dryRun,
        CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        // The actor must be switched on before anything else is resolved: the DbContext captures the current user.
        scope.ServiceProvider.GetRequiredService<SeedActor>().Active = true;
        return await scope.ServiceProvider.GetRequiredService<StarterConfigurationSeeder>().SeedAsync(data, dryRun, cancellationToken);
    }
}
