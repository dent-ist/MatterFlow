using MatterFlow.Data;
using MatterFlow.SharedKernel.Entities;
using MatterFlow.SharedKernel.ValueObjects;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Shouldly;

namespace MatterFlow.UnitTests.Data;

public class DbContextConventionTests
{
    public sealed class Widget : AuditedEntity<int>
    {
        public string Name { get; set; } = string.Empty;

        public BusinessNumber Number { get; set; }
    }

    public sealed class BigThing : Entity<long>;

    private sealed class TestContext() : DbContext(
        new DbContextOptionsBuilder<TestContext>().UseSqlServer("Server=localhost;Database=unused;").Options)
    {
        protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
        {
            configurationBuilder.Properties<BusinessNumber>().HaveConversion<BusinessNumberConverter>().HaveColumnType("char(5)");
        }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<Widget>();
            modelBuilder.Entity<BigThing>();
            ModelConventions.Apply(modelBuilder);
        }
    }

    [Fact]
    public void Primary_key_column_is_named_after_the_entity()
    {
        using var db = new TestContext();
        var widget = db.Model.FindEntityType(typeof(Widget))!;
        var big = db.Model.FindEntityType(typeof(BigThing))!;

        widget.FindPrimaryKey()!.Properties.Single().GetColumnName().ShouldBe("WidgetId");
        big.FindPrimaryKey()!.Properties.Single().GetColumnName().ShouldBe("BigThingId");
    }

    [Fact]
    public void Row_version_is_a_required_rowversion_concurrency_token()
    {
        using var db = new TestContext();
        var prop = db.Model.FindEntityType(typeof(Widget))!.FindProperty(nameof(AuditedEntity<int>.RowVersion))!;

        prop.IsConcurrencyToken.ShouldBeTrue();
        prop.ValueGenerated.ShouldBe(ValueGenerated.OnAddOrUpdate);
        prop.IsNullable.ShouldBeFalse();
        prop.GetColumnName().ShouldBe("RowVersion");
        prop.GetColumnType().ShouldBe("rowversion");
    }

    [Fact]
    public void Audit_columns_use_the_sql_script_names()
    {
        using var db = new TestContext();
        var type = db.Model.FindEntityType(typeof(Widget))!;

        type.FindProperty(nameof(AuditedEntity<int>.CreatedAtUtc))!.GetColumnName().ShouldBe("CreatedAt");
        type.FindProperty(nameof(AuditedEntity<int>.ModifiedAtUtc))!.GetColumnName().ShouldBe("ModifiedAt");
        type.FindProperty(nameof(AuditedEntity<int>.CreatedByUserId))!.GetColumnName().ShouldBe("CreatedByUserId");
        type.FindProperty(nameof(AuditedEntity<int>.ModifiedByUserId))!.GetColumnName().ShouldBe("ModifiedByUserId");
    }

    [Fact]
    public void Plain_entities_get_no_audit_or_rowversion_columns()
    {
        using var db = new TestContext();

        db.Model.FindEntityType(typeof(BigThing))!.GetProperties().Select(p => p.Name).ShouldBe(["Id"]);
    }

    [Fact]
    public void Business_number_is_stored_as_char5()
    {
        using var db = new TestContext();
        var prop = db.Model.FindEntityType(typeof(Widget))!.FindProperty(nameof(Widget.Number))!;

        prop.GetColumnType().ShouldBe("char(5)");
        prop.GetValueConverter()!.ConvertToProvider(BusinessNumber.Parse("343").Value).ShouldBe("00343");
        prop.GetValueConverter()!.ConvertFromProvider("00343").ShouldBe(BusinessNumber.Parse("343").Value);
    }

    [Fact]
    public void Interceptor_stamps_created_and_modified_audit_columns()
    {
        using var db = new TestContext();
        var created = new DateTime(2026, 10, 14, 12, 0, 0, DateTimeKind.Utc);
        var edited = created.AddHours(1);
        var widget = new Widget { Id = 1, Name = "a", RowVersion = [1] };

        db.Add(widget);
        AuditColumnsInterceptor.Stamp(db, created, 7);
        widget.CreatedAtUtc.ShouldBe(created);
        widget.CreatedByUserId.ShouldBe(7);
        widget.ModifiedAtUtc.ShouldBeNull();

        db.Entry(widget).State = EntityState.Unchanged;
        widget.Name = "b";
        AuditColumnsInterceptor.Stamp(db, edited, 9);
        widget.ModifiedAtUtc.ShouldBe(edited);
        widget.ModifiedByUserId.ShouldBe(9);
        widget.CreatedByUserId.ShouldBe(7);
    }
}
