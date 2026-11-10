using MatterFlow.Reports.Application;
using Microsoft.Data.SqlClient;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>The report connection is never the application's own login and never falls back to it (spec 7.10).</summary>
public class ReportsConnectionGuardTests
{
    private const string App = "Server=127.0.0.1,1433;Database=MatterFlow;User Id=sa;Password=App!1;TrustServerCertificate=True";
    private const string Reports = "Server=127.0.0.1,1433;Database=MatterFlow;User Id=mf_reports;Password=Rep!1;TrustServerCertificate=True";

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void A_missing_connection_disables_reports_and_never_falls_back(string? reports)
    {
        var r = ReportsConnectionGuard.Evaluate(reports, [App]);

        r.Ok.ShouldBeFalse();
        r.State.ShouldBe(ReportsStates.NotConfigured);
        r.ConnectionString.ShouldBeNull();
    }

    [Theory]
    [InlineData("not a connection string")]
    [InlineData("User Id=x;Password=y")]
    public void A_broken_connection_string_disables_reports(string reports)
    {
        ReportsConnectionGuard.Evaluate(reports, [App]).Ok.ShouldBeFalse();
    }

    [Fact]
    public void The_same_string_is_refused()
    {
        var r = ReportsConnectionGuard.Evaluate(App, [null, "", App]);

        r.Ok.ShouldBeFalse();
        r.State.ShouldBe(ReportsStates.SharedWithApplication);
    }

    [Theory]
    [InlineData("Data Source=tcp:127.0.0.1;Initial Catalog=matterflow;User ID=SA;Password=x")]
    [InlineData("Server=localhost;Database=MatterFlow;Uid=sa;Pwd=other;Application Name=MatterFlow.Reports")]
    [InlineData("Server=(local),1433;Database=MatterFlow;User Id=sa;Password=other")]
    public void The_same_login_on_the_same_database_is_refused_however_it_is_spelled(string reports)
    {
        ReportsConnectionGuard.Evaluate(reports, [App]).State.ShouldBe(ReportsStates.SharedWithApplication);
    }

    [Fact]
    public void Two_windows_identity_connections_to_the_same_database_are_the_same_login()
    {
        var app = "Server=db01;Database=MatterFlow;Integrated Security=True;TrustServerCertificate=False";
        var reports = "Server=DB01;Database=MatterFlow;Trusted_Connection=Yes";

        ReportsConnectionGuard.Evaluate(reports, [app]).State.ShouldBe(ReportsStates.SharedWithApplication);
    }

    [Fact]
    public void The_migration_connection_counts_as_an_application_login_too()
    {
        var migrations = "Server=127.0.0.1;Database=MatterFlow;User Id=mf_migrator_login;Password=m";
        var reports = "Server=127.0.0.1;Database=MatterFlow;User Id=MF_MIGRATOR_LOGIN;Password=r";

        ReportsConnectionGuard.Evaluate(reports, [App, migrations]).Ok.ShouldBeFalse();
    }

    [Fact]
    public void A_different_login_is_accepted_and_hardened()
    {
        var wild = Reports + ";Max Pool Size=500;Connect Timeout=120;Application Name=Sneaky;ApplicationIntent=ReadWrite;Pooling=False";

        var r = ReportsConnectionGuard.Evaluate(wild, [App]);

        r.Ok.ShouldBeTrue();
        var b = new SqlConnectionStringBuilder(r.ConnectionString);
        b.UserID.ShouldBe("mf_reports");
        b.ApplicationName.ShouldBe("MatterFlow.Reports");
        b.ApplicationIntent.ShouldBe(ApplicationIntent.ReadOnly);
        b.MaxPoolSize.ShouldBe(8);
        b.ConnectTimeout.ShouldBe(10);
        b.Pooling.ShouldBeTrue();
        b.PoolBlockingPeriod.ShouldBe(PoolBlockingPeriod.NeverBlock);
        b.MultipleActiveResultSets.ShouldBeFalse();
    }

    [Fact]
    public void The_same_login_name_on_another_database_or_server_is_a_different_login()
    {
        ReportsConnectionGuard.Evaluate("Server=127.0.0.1;Database=Other;User Id=sa;Password=x", [App]).Ok.ShouldBeTrue();
        ReportsConnectionGuard.Evaluate("Server=db02;Database=MatterFlow;User Id=sa;Password=x", [App]).Ok.ShouldBeTrue();
    }
}
