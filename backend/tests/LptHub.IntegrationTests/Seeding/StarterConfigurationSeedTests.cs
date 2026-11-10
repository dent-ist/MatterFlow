using MatterFlow.Api.Seeding;
using MatterFlow.Assets.Application;
using MatterFlow.Configuration.Application.Forms;
using MatterFlow.Configuration.Application.TaskTypes;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Configuration.Domain.Forms;
using MatterFlow.Configuration.Domain.Forms.Rules;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.WorkflowEngine.Application.Steps;
using MatterFlow.WorkflowEngine.Application.Workflows;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace MatterFlow.IntegrationTests.Seeding;

/// <summary>The embedded SME seed file itself: complete, and every form passes the real publish validation (no database needed).</summary>
public sealed class StarterSeedDataTests
{
    [Fact]
    public void Embedded_seed_has_the_documented_counts()
    {
        var data = StarterSeedData.LoadEmbedded();

        data.TaskTypes.Count.ShouldBe(15);
        data.StepDefinitions.Count.ShouldBe(10);
        data.Workflows.Count.ShouldBe(8);
        data.AssetTypes.Count.ShouldBe(7);
        data.Roles.Count.ShouldBe(10);
    }

    [Fact]
    public void Every_seeded_form_compiles_and_passes_publish_validation()
    {
        var data = StarterSeedData.LoadEmbedded();
        var forms = data.TaskTypes.Select(t => (t.Name, Fields: StarterFormBuilder.Build(t.Fields)))
            .Concat(data.StepDefinitions.Select(s => (s.Title, Fields: StarterFormBuilder.Build(s.Fields))))
            .Concat(data.AssetTypes.Select(a => (a.Name, Fields: StarterFormBuilder.BuildAssetType(a))))
            .ToList();

        forms.Count.ShouldBe(32);
        foreach (var (name, fields) in forms)
        {
            var outcome = StarterFormBuilder.Validate(fields);
            outcome.Issues.ShouldBeEmpty($"{name}: " + string.Join("; ", outcome.Issues.Select(i => i.Code + " " + i.FieldKey + " " + i.Message)));
            FormSchema.Compile(FormSpecs.ToDefinitions(StarterFormBuilder.ToSpecs(fields))).IsValid.ShouldBeTrue(name);
        }
    }

    [Fact]
    public void The_seeded_asset_type_status_select_is_labelled_Lifecycle_with_the_same_key_and_values()
    {
        var data = StarterSeedData.LoadEmbedded();
        var withStatus = data.AssetTypes.Where(a => a.StatusValues.Count > 0).ToList();
        withStatus.ShouldNotBeEmpty();
        foreach (var type in withStatus)
        {
            var field = StarterFormBuilder.BuildAssetType(type).First();
            field.Key.ShouldBe("asset_status", type.Name); // the key never changes: stored values stay valid
            field.Label.ShouldBe("Lifecycle", type.Name);
            field.Options!.Select(o => o.Label).ShouldBe(type.StatusValues, type.Name);
            field.Options!.Select(o => o.Key).ShouldBe(type.StatusValues.Select(StarterFormBuilder.Slug), type.Name);
        }
    }

    [Fact]
    public void Workflows_and_task_types_reference_only_existing_items()
    {
        var data = StarterSeedData.LoadEmbedded();
        var steps = data.StepDefinitions.Select(s => s.Code).ToHashSet();
        var workflows = data.Workflows.Select(w => w.Name).ToHashSet();

        data.Workflows.SelectMany(w => w.Steps).Select(s => s.Step).ShouldAllBe(code => steps.Contains(code));
        foreach (var type in data.TaskTypes)
        {
            type.EligibleWorkflows.ShouldAllBe(w => workflows.Contains(w), type.Name);
            type.DefaultWorkflow.ShouldNotBeNull(type.Name);
            type.EligibleWorkflows.ShouldContain(type.DefaultWorkflow!, type.Name);
        }
    }
}

/// <summary>
/// Ticket #56: the optional starter-configuration seed against a real SQL Server. It runs through the real application services, so
/// every form and workflow is published by the real validation; a second run must change nothing.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class StarterConfigurationSeedTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private string _connectionString = null!;

    public async Task InitializeAsync()
    {
        _connectionString = await sql.CreateDatabaseAsync();
        _factory = new DatabaseApiFactory(_connectionString);
        _ = _factory.Server; // starts the host: schema scripts and the module seeds run
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static readonly string[] CountedTables =
    [
        "TaskType", "TaskTypeWorkflowEligibility", "StepDefinition", "WorkflowDefinition", "WorkflowVersion", "WorkflowVersionStep",
        "AssetType", "FormDefinition", "FormVersion", "FormField", "FormFieldOption", "Role", "RolePermission", "AuditEvent",
    ];

    private Task<StarterSeedReport> RunAsync(bool dryRun = false) =>
        _factory.Services.RunStarterConfigurationSeedAsync(StarterSeedData.LoadEmbedded(), dryRun);

    private async Task<Dictionary<string, int>> SnapshotAsync()
    {
        var counts = new Dictionary<string, int>();
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();
        foreach (var table in CountedTables)
        {
            await using var cmd = connection.CreateCommand();
            cmd.CommandText = $"SELECT COUNT(*) FROM dbo.[{table}]";
            counts[table] = (int)(await cmd.ExecuteScalarAsync())!;
        }

        return counts;
    }

    private async Task<T> InSeedScopeAsync<T>(Func<IServiceProvider, Task<T>> action)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<SeedActor>().Active = true;
        return await action(scope.ServiceProvider);
    }

    [Fact]
    public async Task Dry_run_reports_what_would_be_created_and_writes_nothing()
    {
        var before = await SnapshotAsync();

        var report = await RunAsync(dryRun: true);

        report.HasFailures.ShouldBeFalse(string.Join("; ", report.Actions.Where(a => a.Outcome == SeedOutcome.Failed)));
        report.Changed.ShouldBeFalse();
        report.Count("TaskType", SeedOutcome.WouldCreate).ShouldBe(15);
        report.Count("Step", SeedOutcome.WouldCreate).ShouldBe(10);
        report.Count("Workflow", SeedOutcome.WouldCreate).ShouldBe(8);
        report.Count("AssetType", SeedOutcome.WouldCreate).ShouldBe(7);
        report.Count("Role", SeedOutcome.WouldCreate).ShouldBe(4);
        (await SnapshotAsync()).ShouldBe(before);
    }

    [Fact]
    public async Task Seeds_the_full_configuration_and_a_second_run_changes_nothing()
    {
        var first = await RunAsync();

        first.HasFailures.ShouldBeFalse(string.Join("; ", first.Actions.Where(a => a.Outcome == SeedOutcome.Failed).Select(a => $"{a.Kind} {a.Name}: {a.Detail}")));
        first.Count("TaskType", SeedOutcome.Created).ShouldBe(15);
        first.Count("Step", SeedOutcome.Created).ShouldBe(10);
        first.Count("Workflow", SeedOutcome.Created).ShouldBe(8);
        first.Count("AssetType", SeedOutcome.Created).ShouldBe(7);
        first.Count("Role", SeedOutcome.Created).ShouldBe(4);

        // 15 Task Types, all usable for new Tasks.
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var catalog = scope.ServiceProvider.GetRequiredService<ITaskTypeCatalog>();
            var all = await catalog.ListAsync(includeInactive: true);
            all.Count.ShouldBe(15);
            (await catalog.ListUsableAsync()).Count.ShouldBe(15);
            all.ShouldAllBe(t => t.IsUsable && t.PublishedFormVersionId != null && t.EligibleWorkflowIds.Count >= 1 && t.DefaultWorkflowDefinitionId != null);

            // Every starter type has an icon from the library, and none was left on the placeholder default (each has a sensible one).
            all.ShouldAllBe(t => TaskTypeIcons.IsValid(t.IconKey) && t.IconKey != TaskTypeIcons.DefaultKey);
            all.Single(t => t.Name == "Data Processing").IconKey.ShouldBe("cpu-2");
        }

        // 10 steps, 8 published workflows, 7 asset types with published forms, 9 non-admin roles.
        await InSeedScopeAsync(async sp =>
        {
            var stepList = await sp.GetRequiredService<StepDefinitionService>().ListAsync(new StepDefinitionListQuery { PageSize = 100 }, default);
            stepList.Value.Total.ShouldBe(10);
            stepList.Value.Items.ShouldAllBe(s => s.IsActive);

            var workflowList = await sp.GetRequiredService<WorkflowAdminService>().ListAsync(new WorkflowListQuery { PageSize = 100 }, default);
            workflowList.Value.Total.ShouldBe(8);
            workflowList.Value.Items.ShouldAllBe(w => w.PublishedVersionId != null && w.DraftVersionId == null && w.PublishedStepCount >= 2);

            var assetTypeList = await sp.GetRequiredService<AssetTypeService>().ListAsync(new AssetTypeListQuery { PageSize = 100 }, default);
            assetTypeList.Value.Total.ShouldBe(7);
            assetTypeList.Value.Items.ShouldAllBe(t => t.PublishedFormVersionId != null);
            return 0;
        });

        // Workflow settings survived: the ordered flag and the skip rules.
        await InSeedScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<WorkflowAdminService>();
            var list = (await service.ListAsync(new WorkflowListQuery { PageSize = 100 }, default)).Value.Items;
            var processing = list.Single(w => w.Name == "Standard Processing and Load");
            var version = (await service.GetVersionAsync(processing.WorkflowDefinitionId, processing.PublishedVersionId!.Value, default)).Value;
            version.Version.IsOrdered.ShouldBeTrue();
            version.Steps.Count.ShouldBe(7);
            version.Steps.Single(s => s.IsSkippable).SkipCommentRequired.ShouldBeTrue();

            var unordered = list.Single(w => w.Name == "Quick Request");
            (await service.GetVersionAsync(unordered.WorkflowDefinitionId, unordered.PublishedVersionId!.Value, default)).Value.Version.IsOrdered.ShouldBeFalse();
            return 0;
        });

        // Every published form (task type, step, asset type) compiles.
        var versionIds = await _factory.WithDbAsync(db =>
            db.Set<FormVersion>().Where(v => v.Status == FormVersionStatus.Published).Select(v => v.Id).ToListAsync());
        versionIds.Count.ShouldBe(32);
        await InSeedScopeAsync(async sp =>
        {
            var formService = sp.GetRequiredService<FormAdminService>();
            foreach (var id in versionIds)
            {
                var detail = (await formService.GetVersionAsync(id, default)).Value;
                detail.Fields.ShouldNotBeEmpty();
                FormSchema.Compile(FormSpecs.ToDefinitions(StarterFormBuilder.ToSpecs(detail.Fields))).IsValid.ShouldBeTrue($"form version {id}");
            }

            return 0;
        });

        // Deadline block with the privilege reminder help text is in the Task Type forms.
        await InSeedScopeAsync(async sp =>
        {
            var catalog = sp.GetRequiredService<ITaskTypeCatalog>();
            var collection = (await catalog.ListAsync(true)).Single(t => t.Name == "Collection Receipt");
            var form = (await sp.GetRequiredService<FormAdminService>().GetVersionAsync(collection.PublishedFormVersionId!.Value, default)).Value;
            form.Fields.Single(f => f.Key == "deadline_driver").IsFilterable.ShouldBeTrue();
            form.Fields.Single(f => f.Key == "deadline_note").ShowWhen.ShouldNotBeNull();
            form.Fields.Single(f => f.Key == "handling_flags").HelpText!.ShouldContain("privileged");
            return 0;
        });

        var afterFirst = await SnapshotAsync();
        afterFirst["TaskType"].ShouldBe(15);
        afterFirst["StepDefinition"].ShouldBe(10);
        afterFirst["WorkflowDefinition"].ShouldBe(8);
        afterFirst["AssetType"].ShouldBe(7);
        afterFirst["Role"].ShouldBe(10); // System Admin + 5 architecture starter roles + 4 SME additions

        var second = await RunAsync();

        second.HasFailures.ShouldBeFalse();
        second.Changed.ShouldBeFalse();
        second.Actions.ShouldAllBe(a => a.Outcome == SeedOutcome.Existing);
        (await SnapshotAsync()).ShouldBe(afterFirst);
    }

    [Fact]
    public async Task Admin_edits_are_not_overwritten_and_an_untouched_shell_is_completed()
    {
        await RunAsync();

        // An admin edits a description and clears the eligible workflows of another Task Type; the seed must respect both.
        await _factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync("UPDATE dbo.TaskType SET Description = N'edited by admin' WHERE Name = N'Access Request'"));
        await _factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync(
            "DELETE FROM dbo.TaskTypeWorkflowEligibility WHERE TaskTypeId = (SELECT TaskTypeId FROM dbo.TaskType WHERE Name = N'General / Ad Hoc Request')"));

        var report = await RunAsync();

        report.HasFailures.ShouldBeFalse();
        report.Changed.ShouldBeFalse();
        await _factory.WithDbAsync(async db =>
        {
            var description = await db.Database.SqlQuery<string>($"SELECT Description AS Value FROM dbo.TaskType WHERE Name = N'Access Request'").SingleAsync();
            description.ShouldBe("edited by admin");
            // The admin's decision to clear the eligible workflows is respected too.
            (await db.Database.SqlQuery<int>($"SELECT COUNT(*) AS Value FROM dbo.TaskTypeWorkflowEligibility e JOIN dbo.TaskType t ON t.TaskTypeId = e.TaskTypeId WHERE t.Name = N'General / Ad Hoc Request'").SingleAsync())
                .ShouldBe(0);
        });
    }

    [Fact]
    public async Task A_bare_task_type_of_a_seeded_name_gets_its_form_and_everything_else_is_still_created()
    {
        // Pre-create a Task Type of a seeded name with no form and no workflows, as an interrupted earlier run would have left it.
        var id = await InSeedScopeAsync(async sp =>
        {
            var created = await sp.GetRequiredService<TaskTypeService>().CreateAsync(new CreateTaskTypeRequest("Access Request", "bare", true), default);
            return created.Value.Id;
        });

        var report = await RunAsync();

        report.HasFailures.ShouldBeFalse(string.Join("; ", report.Actions.Where(a => a.Outcome == SeedOutcome.Failed).Select(a => $"{a.Kind} {a.Name}: {a.Detail}")));
        report.Actions.Single(a => a.Kind == "TaskType" && a.Name == "Access Request").Outcome.ShouldBe(SeedOutcome.Completed);
        report.Count("TaskType", SeedOutcome.Created).ShouldBe(14);
        await using var scope = _factory.Services.CreateAsyncScope();
        var info = await scope.ServiceProvider.GetRequiredService<ITaskTypeCatalog>().GetAsync(id);
        info!.PublishedFormVersionId.ShouldNotBeNull();
        info.IsUsable.ShouldBeFalse("its eligible workflows are the admin's to set; the seed does not link an existing type");
    }
}
