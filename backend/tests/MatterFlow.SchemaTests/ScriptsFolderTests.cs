using Shouldly;

namespace MatterFlow.SchemaTests;

public class ScriptsFolderTests
{
    [Fact]
    public void Db_scripts_folder_with_authoring_readme_exists()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "global.json")))
            dir = dir.Parent;

        dir.ShouldNotBeNull();
        File.Exists(Path.Combine(dir.FullName, "db", "scripts", "README.md")).ShouldBeTrue();
    }
}
