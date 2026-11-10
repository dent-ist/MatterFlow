using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests.Security;

/// <summary>
/// "Walk every endpoint as six personas" (epic #788, SM-15/SM-16, README 12.2): with the rule on, no persona gets a hidden record, a hidden id or a sensitive sentinel from any
/// catalogued GET endpoint, a hidden id answers exactly like a missing one, an unauthenticated caller gets 401 and a caller without permission never learns hiddenness. The
/// same walk run against a rule that is off, or against an access matrix that is out of date, must find violations (the suite is not vacuous).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class SensitivePersonaWalkTests(SqlServerFixture sql)
{
    [Fact]
    public async Task With_the_rule_on_the_walk_finds_no_violation_and_covers_every_walkable_endpoint_for_every_persona()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var walk = PersonaWalk.Create(u, await PersonaWalk.PrepareAsync(u));
            u.H.Factory.InvalidateAll();
            var personas = walk.Personas();
            await walk.RunAsync(personas);

            walk.Violations.ShouldBeEmpty(string.Join(Environment.NewLine, walk.Violations.Take(40)));
            walk.Requests.ShouldBeGreaterThan(500);

            var walkable = SensitiveAccessCatalog.All.Where(kv => PersonaWalk.IsWalked(kv.Key, kv.Value) && kv.Value.Kind != AccessKind.Open
                && !kv.Key.Contains("api/v1/test/", StringComparison.Ordinal) && (kv.Value.Calls.Length > 0 || !kv.Key.Contains('{', StringComparison.Ordinal))).Select(kv => kv.Key).ToList();
            foreach (var key in walkable)
            {
                walk.Covered.ShouldContainKey(key);
                foreach (var persona in personas)
                    walk.Covered[key].ShouldContain(persona.Name, key);
            }
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }
}
