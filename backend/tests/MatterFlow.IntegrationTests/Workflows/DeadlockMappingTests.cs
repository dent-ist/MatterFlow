using MatterFlow.Api.Http;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.SqlClient;
using Shouldly;

namespace MatterFlow.IntegrationTests.Workflows;

/// <summary>
/// E2E-F3: a SQL Server deadlock victim (error 1205) must never reach the client as a 500. The test makes SQL Server pick a real victim
/// (two transactions that lock two rows in opposite order) and feeds the resulting exception to the shared exception handler.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class DeadlockMappingTests(SqlServerFixture sql)
{
    [Fact]
    public async Task A_real_deadlock_victim_is_a_409_concurrency_conflict_not_a_500()
    {
        var victim = await ProvokeDeadlockAsync(await sql.CreateDatabaseAsync());

        victim.Number.ShouldBe(1205);
        GlobalExceptionHandler.IsDeadlock(victim).ShouldBeTrue();
        // The same failure wrapped by EF Core, as the API logs it.
        GlobalExceptionHandler.IsDeadlock(new InvalidOperationException("transient failure", new Exception("save failed", victim))).ShouldBeTrue();

        var problems = new CapturingProblemDetails();
        var handler = new GlobalExceptionHandler(problems, Microsoft.Extensions.Logging.Abstractions.NullLogger<GlobalExceptionHandler>.Instance);
        var http = new DefaultHttpContext();

        (await handler.TryHandleAsync(http, victim, CancellationToken.None)).ShouldBeTrue();

        http.Response.StatusCode.ShouldBe(StatusCodes.Status409Conflict);
        problems.Context!.ProblemDetails.Extensions["code"].ShouldBe("CONCURRENCY_CONFLICT");
    }

    [Fact]
    public async Task Other_failures_are_still_500()
    {
        GlobalExceptionHandler.IsDeadlock(new InvalidOperationException("boom")).ShouldBeFalse();

        var problems = new CapturingProblemDetails();
        var handler = new GlobalExceptionHandler(problems, Microsoft.Extensions.Logging.Abstractions.NullLogger<GlobalExceptionHandler>.Instance);
        var http = new DefaultHttpContext();

        (await handler.TryHandleAsync(http, new InvalidOperationException("boom"), CancellationToken.None)).ShouldBeTrue();

        http.Response.StatusCode.ShouldBe(StatusCodes.Status500InternalServerError);
    }

    private static async Task<SqlException> ProvokeDeadlockAsync(string connectionString)
    {
        await using var setup = new SqlConnection(connectionString);
        await setup.OpenAsync();
        await Run(setup, "CREATE TABLE dbo.DeadlockProbe (Id int NOT NULL PRIMARY KEY, V int NOT NULL); INSERT dbo.DeadlockProbe VALUES (1, 0), (2, 0);");

        await using var a = new SqlConnection(connectionString);
        await using var b = new SqlConnection(connectionString);
        await a.OpenAsync();
        await b.OpenAsync();
        await using var ta = a.BeginTransaction();
        await using var tb = b.BeginTransaction();
        await Run(a, "UPDATE dbo.DeadlockProbe SET V = 1 WHERE Id = 1;", ta);
        await Run(b, "UPDATE dbo.DeadlockProbe SET V = 1 WHERE Id = 2;", tb);

        // Each now waits for the row the other holds; SQL Server's deadlock monitor picks one as the victim within a few seconds.
        var first = Run(a, "UPDATE dbo.DeadlockProbe SET V = 2 WHERE Id = 2;", ta);
        var second = Run(b, "UPDATE dbo.DeadlockProbe SET V = 2 WHERE Id = 1;", tb);
        var done = await Task.WhenAny(first, second).WaitAsync(TimeSpan.FromSeconds(60));
        var victim = (await Should.ThrowAsync<SqlException>(async () => await done));

        // The victim's transaction is already gone; rolling back the survivor lets its blocked statement finish.
        await TryRollbackAsync(ta);
        await TryRollbackAsync(tb);
        await Task.WhenAll(first.ContinueWith(_ => { }), second.ContinueWith(_ => { }));
        return victim;
    }

    private static async Task TryRollbackAsync(SqlTransaction transaction)
    {
        try
        {
            await transaction.RollbackAsync();
        }
        catch (Exception)
        {
            // Already rolled back by SQL Server.
        }
    }

    private static async Task Run(SqlConnection connection, string sqlText, SqlTransaction? transaction = null)
    {
        await using var command = new SqlCommand(sqlText, connection, transaction);
        await command.ExecuteNonQueryAsync();
    }

    private sealed class CapturingProblemDetails : Microsoft.AspNetCore.Http.IProblemDetailsService
    {
        public ProblemDetailsContext? Context { get; private set; }

        public ValueTask WriteAsync(ProblemDetailsContext context)
        {
            Context = context;
            return ValueTask.CompletedTask;
        }

        public ValueTask<bool> TryWriteAsync(ProblemDetailsContext context)
        {
            Context = context;
            return ValueTask.FromResult(true);
        }
    }
}
