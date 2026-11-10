using System.Text.Json;

namespace MatterFlow.Identity.LandingPages;

/// <summary>The stable page keys (<c>contracts/landing-pages.json</c>); code that names a page (the starter roles) uses these.</summary>
public static class LandingPageKeys
{
    public const string Dashboard = "dashboard";
    public const string MyMatters = "my-matters";
    public const string MyWork = "my-work";
    public const string Clients = "clients";
    public const string Matters = "matters";
    public const string Projects = "projects";
    public const string Assets = "assets";
    public const string PodWork = "pod-work";
    public const string TaskQueue = "task-queue";
    public const string Reports = "reports";
    public const string Administration = "administration";
}

/// <summary>One page of the landing page catalogue and the rule that says who can open it.</summary>
/// <param name="AllOf">Permissions the person must hold all of.</param>
/// <param name="AnyOf">When not empty: at least one of these as well.</param>
/// <param name="DashboardTab">The Dashboard rule: <c>Dashboard.View</c> is in <paramref name="AllOf"/> and one Dashboard tab permission is needed too (a Dashboard with no tab is a dead end).</param>
public sealed record LandingPageDefinition(string Key, string Label, string Path, IReadOnlyList<string> AllOf, IReadOnlyList<string> AnyOf, bool DashboardTab);

/// <summary>
/// The landing page catalogue (<c>contracts/landing-pages.json</c>, embedded at build time): the page keys and the one rule that says who can open a page.
/// The rule is the one the navigation and the route guards use; evaluating it here means a client is never trusted for it.
/// </summary>
public sealed class LandingPageCatalog
{
    private const string ResourceName = "contracts.landing-pages.json";

    private static readonly Lazy<LandingPageCatalog> Shared = new(Load);

    private readonly Dictionary<string, LandingPageDefinition> _byKey;

    private LandingPageCatalog(IReadOnlyList<LandingPageDefinition> pages, IReadOnlyList<string> dashboardTabPermissions)
    {
        Pages = pages;
        DashboardTabPermissions = dashboardTabPermissions;
        _byKey = pages.ToDictionary(p => p.Key, StringComparer.Ordinal);
    }

    /// <summary>The embedded catalogue.</summary>
    public static LandingPageCatalog Default => Shared.Value;

    /// <summary>Every page, in navigation order.</summary>
    public IReadOnlyList<LandingPageDefinition> Pages { get; }

    public IReadOnlyList<string> DashboardTabPermissions { get; }

    /// <summary>Every permission code the rules mention (the endpoints of the landing pages accept a person who holds any of them).</summary>
    public IReadOnlySet<string> RulePermissions =>
        Pages.SelectMany(p => p.AllOf.Concat(p.AnyOf)).Concat(DashboardTabPermissions).ToHashSet(StringComparer.Ordinal);

    /// <summary>The page with this key, or null for an unknown, blank or differently cased key.</summary>
    public LandingPageDefinition? Find(string? key) => key is not null && _byKey.TryGetValue(key, out var page) ? page : null;

    /// <summary>True when <paramref name="has"/> says the person holds what the page's rule needs.</summary>
    public bool CanOpen(LandingPageDefinition page, Func<string, bool> has) =>
        page.AllOf.All(has)
        && (page.AnyOf.Count == 0 || page.AnyOf.Any(has))
        && (!page.DashboardTab || DashboardTabPermissions.Any(has));

    /// <summary>The pages <paramref name="has"/> can open, in navigation order.</summary>
    public IReadOnlyList<LandingPageDefinition> OpenableBy(Func<string, bool> has) => [.. Pages.Where(p => CanOpen(p, has))];

    public static LandingPageCatalog Load()
    {
        using var stream = typeof(LandingPageCatalog).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"Embedded resource '{ResourceName}' not found.");
        return Parse(stream);
    }

    public static LandingPageCatalog Parse(Stream json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        static string[] Strings(JsonElement e) => [.. e.EnumerateArray().Select(x => x.GetString()!)];
        var pages = root.GetProperty("pages").EnumerateArray().Select(p => new LandingPageDefinition(
            p.GetProperty("key").GetString()!,
            p.GetProperty("label").GetString()!,
            p.GetProperty("path").GetString()!,
            Strings(p.GetProperty("allOf")),
            Strings(p.GetProperty("anyOf")),
            p.GetProperty("dashboardTab").GetBoolean())).ToList();
        return new LandingPageCatalog(pages, Strings(root.GetProperty("dashboardTabPermissions")));
    }
}

/// <summary>A role as the resolution sees it: its name (the list order) and its default page key.</summary>
public sealed record RoleLanding(string Name, string? LandingPage);

/// <summary>The outcome of the fallback chain: a page key and where it came from, or none (the frontend applies the old landing rule).</summary>
public sealed record LandingResolution(LandingPageDefinition? Page, string? Source);

/// <summary>
/// The fallback chain behind "where does this person land" (epic #1330), a pure function so each branch is unit tested:
/// the person's own choice if they can still open it; otherwise the default of the FIRST role in their role list, if they can open it; otherwise nothing,
/// and the frontend applies the landing rule it had before. An unknown key (a renamed or removed page) and a page the person can no longer open are skipped.
/// </summary>
public static class LandingPageResolver
{
    public const string SourceChoice = "CHOICE";
    public const string SourceRoleDefault = "ROLE_DEFAULT";

    /// <summary>
    /// The order of the person's role list, the one <c>GET /me</c> and the Users list show: by name, ignoring case, then by exact spelling.
    /// Role names are unique, so the order is total and the same on every request.
    /// </summary>
    public static IReadOnlyList<RoleLanding> RoleListOrder(IEnumerable<RoleLanding> roles) =>
        [.. roles.OrderBy(r => r.Name, StringComparer.OrdinalIgnoreCase).ThenBy(r => r.Name, StringComparer.Ordinal)];

    /// <summary>The first role of the role list (the one that decides the role default), or null when the person has no role.</summary>
    public static RoleLanding? FirstRole(IEnumerable<RoleLanding> roles) => RoleListOrder(roles).FirstOrDefault();

    public static LandingResolution Resolve(LandingPageCatalog catalog, string? choice, string? firstRoleDefault, Func<string, bool> has)
    {
        if (catalog.Find(choice) is { } chosen && catalog.CanOpen(chosen, has))
            return new LandingResolution(chosen, SourceChoice);
        if (catalog.Find(firstRoleDefault) is { } fallback && catalog.CanOpen(fallback, has))
            return new LandingResolution(fallback, SourceRoleDefault);
        return new LandingResolution(null, null);
    }
}
