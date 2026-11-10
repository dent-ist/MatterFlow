using MatterFlow.Audit.Contracts;
using MatterFlow.Audit.Domain;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace MatterFlow.IntegrationTests.Audit;

/// <summary>Audit capture against a real SQL Server: atomicity, rollback, correlation and append-only enforcement.</summary>
[Collection(SqlServerCollection.Name)]
public class AuditCaptureTests(SqlServerFixture sql)
{
    private async Task<AuditTestHost> NewHostAsync() => await AuditTestHost.CreateAsync(await sql.CreateMigratedDatabaseAsync());

    private static async Task<List<AuditEvent>> AuditRowsAsync(AuditTestHost host, string? where = null)
    {
        await using var scope = host.NewScope();
        var db = scope.ServiceProvider.GetRequiredService<AuditTestDbContext>();
        var sqlText = "SELECT * FROM dbo.AuditEvent" + (where is null ? "" : " WHERE " + where) + " ORDER BY AuditEventId";
        return await db.Set<AuditEvent>().FromSqlRaw(sqlText).AsNoTracking().ToListAsync();
    }

    private static async Task<int> CountAsync(string connectionString, string table)
    {
        await using var c = new SqlConnection(connectionString);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = $"SELECT COUNT(*) FROM dbo.{table}";
        return (int)(await cmd.ExecuteScalarAsync())!;
    }

    [Fact]
    public async Task Audited_entity_changes_produce_field_level_rows_in_the_same_save()
    {
        await using var host = await NewHostAsync();
        int id;
        await using (var scope = host.NewScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AuditTestDbContext>();
            var doc = new SampleDocument { Title = "First", MatterId = 7, ValuesJson = """{"ocr_language":"en"}""" };
            db.Add(doc);
            await db.SaveChangesAsync();
            id = doc.Id;
        }

        // Insert: one FIELD_CHANGED row per non-null audited property, with the generated key as ObjectId. Status is [AuditExplicit].
        var created = await AuditRowsAsync(host);
        created.Select(e => e.FieldKey).ShouldBe(["Title", "form:ocr_language", "MatterId"], ignoreOrder: true);
        created.ShouldAllBe(e => e.ObjectType == "SampleDocument" && e.ObjectId == id.ToString() && e.EventType == "FIELD_CHANGED");
        created.ShouldAllBe(e => e.ActorUserId == 42 && e.MatterId == 7 && e.OldValue == null);

        await using (var scope = host.NewScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AuditTestDbContext>();
            var doc = await db.Set<SampleDocument>().SingleAsync();
            doc.Title = "Second";
            doc.Status = "DONE"; // explicit property: no generic row
            doc.ValuesJson = """{"ocr_language":"de","pages":3}""";
            await db.SaveChangesAsync();
        }

        var updates = (await AuditRowsAsync(host)).Skip(created.Count).ToList();
        updates.Select(e => (e.FieldKey, e.OldValue, e.NewValue)).ShouldBe(
            [("Title", "First", "Second"), ("form:ocr_language", "en", "de"), ("form:pages", null, "3")],
            ignoreOrder: true);
        updates.ShouldAllBe(e => e.OccurredAtUtc == AuditTestHost.Now);
    }

    [Fact]
    public async Task Unchanged_save_and_audit_stamp_only_columns_write_nothing()
    {
        await using var host = await NewHostAsync();
        await using var scope = host.NewScope();
        var db = scope.ServiceProvider.GetRequiredService<AuditTestDbContext>();
        db.Add(new SampleDocument { Title = "x" });
        await db.SaveChangesAsync();
        var before = (await AuditRowsAsync(host)).Count;

        (await db.SaveChangesAsync()).ShouldBe(0);

        (await AuditRowsAsync(host)).Count.ShouldBe(before);
    }

    [Fact]
    public async Task Explicit_events_are_written_with_the_change_and_resolve_generated_ids()
    {
        await using var host = await NewHostAsync();
        await using var scope = host.NewScope();
        var db = scope.ServiceProvider.GetRequiredService<AuditTestDbContext>();
        var writer = scope.ServiceProvider.GetRequiredService<IAuditWriter>();
        var doc = new SampleDocument { Title = "T" };
        db.Add(doc);
        writer.Write(new AuditEntry
        {
            EventType = AuditEventTypes.TaskStatusChanged,
            ObjectType = "SampleDocument",
            ObjectIdFactory = () => doc.Id.ToString(),
            FieldKey = "Status",
            OldValue = "NEW",
            NewValue = "DONE",
            Summary = "STEP_REOPEN",
        });

        await db.SaveChangesAsync();

        var explicitRow = (await AuditRowsAsync(host, "EventType = 'TASK_STATUS_CHANGED'")).Single();
        explicitRow.ObjectId.ShouldBe(doc.Id.ToString());
        explicitRow.Summary.ShouldBe("STEP_REOPEN");
        explicitRow.ActorUserId.ShouldBe(42);
        (await AuditRowsAsync(host, "EventType = 'FIELD_CHANGED'")).ShouldNotBeEmpty();
    }

    [Fact]
    public async Task Explicit_event_without_any_tracked_change_is_still_saved()
    {
        await using var host = await NewHostAsync();
        await using var scope = host.NewScope();
        var db = scope.ServiceProvider.GetRequiredService<AuditTestDbContext>();
        scope.ServiceProvider.GetRequiredService<IAuditWriter>().Write(
            new AuditEntry { EventType = "ROLE_GRANTED", ObjectType = "User", ObjectId = "5" });

        await db.SaveChangesAsync();

        (await AuditRowsAsync(host)).Single().EventType.ShouldBe("ROLE_GRANTED");
    }

    [Fact]
    public async Task Rolled_back_transaction_leaves_no_entity_and_no_audit_row()
    {
        await using var host = await NewHostAsync();
        await using (var scope = host.NewScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AuditTestDbContext>();
            await using var tx = await db.Database.BeginTransactionAsync();
            db.Add(new SampleDocument { Title = "gone" });
            scope.ServiceProvider.GetRequiredService<IAuditWriter>().Write(
                new AuditEntry { EventType = "X", ObjectType = "SampleDocument", ObjectId = "1" });
            await db.SaveChangesAsync();
            (await db.Set<AuditEvent>().CountAsync()).ShouldBeGreaterThan(0); // visible inside the transaction
            await tx.RollbackAsync();
        }

        await using var verify = host.NewScope();
        (await CountAsync(host.ConnectionString, "AuditEvent")).ShouldBe(0);
        (await CountAsync(host.ConnectionString, "SampleDocument")).ShouldBe(0);
    }

    [Fact]
    public async Task Failed_save_rolls_back_business_and_audit_rows_and_keeps_explicit_entries_for_retry()
    {
        await using var host = await NewHostAsync();
        await using var scope = host.NewScope();
        var db = scope.ServiceProvider.GetRequiredService<AuditTestDbContext>();
        var writer = scope.ServiceProvider.GetRequiredService<IAuditWriter>();
        var good = new SampleDocument { Title = "ok" };
        var bad = new SampleDocument { Title = "this title is longer than ten characters" };
        db.AddRange(good, bad);
        writer.Write(new AuditEntry { EventType = "E1", ObjectType = "SampleDocument", ObjectId = "9" });

        await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync());

        (await CountAsync(host.ConnectionString, "SampleDocument")).ShouldBe(0);
        (await CountAsync(host.ConnectionString, "AuditEvent")).ShouldBe(0);

        // Fix the data and retry: the queued explicit event survives and is written exactly once, with a fresh field diff.
        bad.Title = "fixed";
        await db.SaveChangesAsync();
        (await AuditRowsAsync(host, "EventType = 'E1'")).Count.ShouldBe(1);
        (await AuditRowsAsync(host, "FieldKey = 'Title'")).Count.ShouldBe(2);
    }

    [Fact]
    public async Task Bulk_operation_shares_one_correlation_id_and_each_scope_gets_its_own()
    {
        await using var host = await NewHostAsync();
        Guid first;
        await using (var scope = host.NewScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AuditTestDbContext>();
            var writer = scope.ServiceProvider.GetRequiredService<IAuditWriter>();
            first = scope.ServiceProvider.GetRequiredService<IAuditCorrelation>().Id;

            // A bulk action: several saves plus semantic events inside one request scope.
            for (var i = 0; i < 3; i++)
            {
                var doc = new SampleDocument { Title = "step" + i };
                db.Add(doc);
                writer.Write(new AuditEntry
                {
                    EventType = AuditEventTypes.StepCompleted,
                    ObjectType = "SampleDocument",
                    ObjectIdFactory = () => doc.Id.ToString(),
                    Summary = "bulk=true",
                });
                await db.SaveChangesAsync();
            }
        }

        var rows = await AuditRowsAsync(host);
        rows.Count.ShouldBeGreaterThan(3);
        rows.Select(e => e.CorrelationId).Distinct().ShouldBe([first]);

        await using var other = host.NewScope();
        other.ServiceProvider.GetRequiredService<IAuditCorrelation>().Id.ShouldNotBe(first);
    }

    [Fact]
    public async Task Update_and_delete_against_audit_event_are_rejected_even_for_sysadmin()
    {
        await using var host = await NewHostAsync();
        await using (var scope = host.NewScope())
        {
            scope.ServiceProvider.GetRequiredService<IAuditWriter>().Write(
                new AuditEntry { EventType = "X", ObjectType = "T", ObjectId = "1", NewValue = "secret" });
            await scope.ServiceProvider.GetRequiredService<AuditTestDbContext>().SaveChangesAsync();
        }

        var update = await Should.ThrowAsync<SqlException>(
            () => SqlServerFixture.ExecuteAsync(host.ConnectionString, "UPDATE dbo.AuditEvent SET NewValue = 'tampered'"));
        update.Message.ShouldContain("append-only");
        var delete = await Should.ThrowAsync<SqlException>(
            () => SqlServerFixture.ExecuteAsync(host.ConnectionString, "DELETE FROM dbo.AuditEvent"));
        delete.Message.ShouldContain("append-only");

        await using var scope2 = host.NewScope();
        var db = scope2.ServiceProvider.GetRequiredService<AuditTestDbContext>();
        await Should.ThrowAsync<SqlException>(() => db.Set<AuditEvent>().ExecuteDeleteAsync());
        (await db.Set<AuditEvent>().SingleAsync()).NewValue.ShouldBe("secret");
    }

    [Fact]
    public async Task Indexes_for_lookup_by_object_and_time_exist()
    {
        await using var host = await NewHostAsync();
        await using var c = new SqlConnection(host.ConnectionString);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT name FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.AuditEvent') AND name IS NOT NULL";
        var names = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            names.Add(reader.GetString(0));

        names.ShouldContain("IX_Audit_Object");
        names.ShouldContain("IX_Audit_Time");
    }
}
