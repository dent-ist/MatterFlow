using MatterFlow.Audit.Contracts;
using MatterFlow.Productions.Application;
using MatterFlow.SharedKernel.Results;
using Shouldly;

namespace MatterFlow.UnitTests.Productions;

/// <summary>The field-change audit and the concurrency check shared by productions and specs (MD-09, MD-10).</summary>
public sealed class ProductionSupportTests
{
    private sealed class Recorder : IAuditWriter
    {
        public List<AuditEntry> Entries { get; } = [];

        public void Write(AuditEntry entry) => Entries.Add(entry);
    }

    [Fact]
    public void Only_changed_fields_are_written_with_old_and_new_value_and_the_matter()
    {
        var audit = new Recorder();
        var before = new Dictionary<string, string?> { ["BatesBegin"] = "ABC000001", ["BatesEnd"] = "ABC000100", ["Notes"] = null };
        var after = new Dictionary<string, string?> { ["BatesBegin"] = "ABC000001", ["BatesEnd"] = "ABC000250", ["Notes"] = "Volume 2" };

        ProductionSupport.WriteFieldChanges(audit, "Production", "7", 42, before, after);

        audit.Entries.Count.ShouldBe(2);
        audit.Entries.ShouldAllBe(e => e.MatterId == 42 && e.ObjectType == "Production" && e.ObjectId == "7" && e.EventType == AuditEventTypes.FieldChanged);
        var bates = audit.Entries.Single(e => e.FieldKey == "BatesEnd");
        bates.OldValue.ShouldBe("ABC000100");
        bates.NewValue.ShouldBe("ABC000250");
        audit.Entries.Single(e => e.FieldKey == "Notes").OldValue.ShouldBeNull();
    }

    [Fact]
    public void Nothing_is_written_when_nothing_changed()
    {
        var audit = new Recorder();
        var same = new Dictionary<string, string?> { ["Name"] = "Volume 1" };

        ProductionSupport.WriteFieldChanges(audit, "Production", "7", 42, same, new Dictionary<string, string?>(same));

        audit.Entries.ShouldBeEmpty();
    }

    [Fact]
    public void A_stale_row_version_is_a_conflict_that_carries_the_current_token()
    {
        byte[] current = [1, 2, 3, 4, 5, 6, 7, 8];
        var stale = Convert.ToBase64String(new byte[] { 9, 9, 9, 9, 9, 9, 9, 9 });

        var result = ProductionSupport.CheckRowVersion(current, stale);

        result.IsFailure.ShouldBeTrue();
        result.Error!.Type.ShouldBe(ErrorType.Conflict);
        result.Error.Code.ShouldBe(ErrorCodes.ConcurrencyConflict);
        result.Error.Meta!["currentRowVersion"].ShouldBe(Convert.ToBase64String(current));
        ProductionSupport.CheckRowVersion(current, Convert.ToBase64String(current)).IsSuccess.ShouldBeTrue();
    }

    [Fact]
    public void A_row_version_that_is_not_base64_is_a_validation_error()
    {
        ProductionSupport.CheckRowVersion([1], "not base64!").Error!.Type.ShouldBe(ErrorType.Validation);
    }
}
