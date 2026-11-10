using System.Xml.Linq;
using Shouldly;

namespace MatterFlow.UnitTests.Deploy;

/// <summary>deploy/web.config (epic #850, BR-06): Windows sign-in for the whole site, anonymous access for exactly the public branding path.</summary>
public class WebConfigTests
{
    private static XDocument Load()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "deploy", "web.config")))
            dir = dir.Parent;
        return XDocument.Load(Path.Combine(dir?.FullName ?? throw new InvalidOperationException("deploy/web.config not found"), "deploy", "web.config"));
    }

    private static IEnumerable<(string Path, bool? Anonymous, bool? Windows)> Locations() =>
        Load().Root!.Elements("location").Select(l =>
        {
            var auth = l.Descendants("authentication").FirstOrDefault();
            bool? Flag(string name) => auth?.Element(name)?.Attribute("enabled") is { } a ? bool.Parse(a.Value) : null;
            return ((string?)l.Attribute("path") ?? string.Empty, Flag("anonymousAuthentication"), Flag("windowsAuthentication"));
        });

    [Fact]
    public void The_whole_site_is_windows_only_and_anonymous_is_off()
    {
        var site = Locations().Single(l => l.Path == ".");
        site.Anonymous.ShouldBe(false);
        site.Windows.ShouldBe(true);
    }

    [Fact]
    public void Anonymous_access_is_enabled_for_exactly_one_narrow_path_the_public_branding_endpoints()
    {
        var anonymous = Locations().Where(l => l.Anonymous == true).ToList();

        anonymous.Select(l => l.Path).ShouldBe(["api/v1/branding"]);
        anonymous[0].Windows.ShouldBeNull(); // Windows sign-in is inherited from the site, not switched off here
    }

    [Fact]
    public void No_wildcard_or_parent_path_is_opened_to_anonymous_users()
    {
        foreach (var location in Locations().Where(l => l.Anonymous == true))
        {
            location.Path.ShouldNotContain("*");
            location.Path.ShouldNotBe(".");
            location.Path.ShouldNotBe("api");
            location.Path.ShouldNotBe("api/v1");
            location.Path.ShouldNotContain("admin");
        }
    }
}
