using System.Reflection;
using System.Text.RegularExpressions;
using MatterFlow.SharedKernel.Audit;
using Shouldly;

namespace MatterFlow.ArchitectureTests;

/// <summary>
/// Sensitive-matter epic #788 (SM-13, README 12.3 c): the audit trail is filtered by the <c>MatterId</c> and <c>TaskId</c> columns of each event, so an event about a
/// matter, project, asset or task that is written without its matter would be shown to everybody. These rules make that a build failure instead of a leak.
/// </summary>
public class AuditScopeRulesTests
{
    private static IEnumerable<Type> ProductTypes()
    {
        Assembly[] assemblies =
        [
            typeof(MatterFlow.Organization.Domain.Matter).Assembly,
            typeof(MatterFlow.Assets.Domain.Asset).Assembly,
            typeof(MatterFlow.WorkManagement.Domain.WorkTask).Assembly,
            typeof(MatterFlow.Configuration.Domain.Priority).Assembly,
            typeof(MatterFlow.Identity.Domain.AppUser).Assembly,
            typeof(MatterFlow.WorkflowEngine.Domain.StepDefinition).Assembly,
        ];
        return assemblies.SelectMany(a => a.GetTypes());
    }

    [Fact]
    public void An_audited_entity_that_belongs_to_a_matter_declares_its_audit_scope_and_it_is_the_matter()
    {
        var offenders = new List<string>();
        foreach (var type in ProductTypes().Where(t => t.GetCustomAttribute<AuditedAttribute>(inherit: true) is not null))
        {
            var isMatter = type.Name == "Matter";
            var matterColumn = type.GetProperty("MatterId");
            if (!isMatter && matterColumn is null)
                continue;

            if (!typeof(IAuditScoped).IsAssignableFrom(type))
            {
                offenders.Add($"{type.Name}: has a matter but is not IAuditScoped");
                continue;
            }

            var instance = (IAuditScoped)Activator.CreateInstance(type, nonPublic: true)!;
            var property = isMatter ? type.GetProperty("Id", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.FlattenHierarchy)! : matterColumn!;
            property.SetValue(instance, 42);
            if (instance.AuditMatterId != 42)
                offenders.Add($"{type.Name}: AuditMatterId is {instance.AuditMatterId?.ToString() ?? "null"} for matter 42");
        }

        offenders.ShouldBeEmpty(string.Join("; ", offenders));
    }

    /// <summary>Files whose explicit audit entries legitimately carry no matter: administration records (identity, configuration, workflow definitions, clients) and the matter-created event, which the Data layer scopes by its object id.</summary>
    private static readonly Dictionary<string, int> UnscopedEntries = new()
    {
        ["FormDefinitionResolver.cs"] = 1,
        ["FormAdminService.cs"] = 6,
        ["FormValueStore.cs"] = 1, // FORM_VALUES_DROPPED: field keys only (residual listed in README section 4, SM-13)
        ["PriorityService.cs"] = 1,
        ["TaskTypeService.cs"] = 1,
        ["UserResolver.cs"] = 3,
        ["RoleAdministration.cs"] = 2,
        ["UserAdministration.cs"] = 1,
        ["UserAvailabilityService.cs"] = 3,
        ["WorkflowAdminService.cs"] = 7,
        ["StepDefinitionService.cs"] = 1,
        ["ClientService.cs"] = 2,
        ["TaskQueueExportService.cs"] = 2, // EXPORT_RUN (PM v2 #879): the surface, the row count and the filters of a list export; no record data
        ["MatterService.cs"] = 1, // MATTER_CREATED: the Data layer scopes an event about a Matter object to that matter
    };

    [Fact]
    public void Explicit_audit_entries_carry_their_matter_except_the_known_administration_events()
    {
        var found = new Dictionary<string, int>();
        foreach (var file in ProductSources())
        {
            var text = File.ReadAllText(file);
            foreach (Match m in Regex.Matches(text, @"new AuditEntry\b"))
            {
                var open = text.IndexOf('{', m.Index + m.Length);
                var depth = 0;
                var i = open;
                do
                {
                    if (text[i] == '{')
                        depth++;
                    else if (text[i] == '}')
                        depth--;
                    i++;
                }
                while (depth > 0);

                if (!text[open..i].Contains("MatterId", StringComparison.Ordinal))
                    found[Path.GetFileName(file)] = found.GetValueOrDefault(Path.GetFileName(file)) + 1;
            }
        }

        found.OrderBy(kv => kv.Key, StringComparer.Ordinal).ToList().ShouldBe(
            UnscopedEntries.OrderBy(kv => kv.Key, StringComparer.Ordinal).ToList(),
            "An explicit audit entry about a matter, project, asset or task must set MatterId (and TaskId), otherwise the sensitive-matter rule cannot restrict it. "
            + "An entry about administration data may be added to the list with a reason.");
    }

    private static IEnumerable<string> ProductSources()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "global.json")))
            dir = dir.Parent;

        dir.ShouldNotBeNull();
        return Directory.EnumerateFiles(Path.Combine(dir.FullName, "backend", "src"), "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                && !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal));
    }
}
