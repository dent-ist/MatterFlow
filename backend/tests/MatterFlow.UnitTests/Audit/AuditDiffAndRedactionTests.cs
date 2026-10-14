using MatterFlow.Audit.Contracts;
using MatterFlow.Audit.Domain;
using MatterFlow.Audit.Infrastructure;
using MatterFlow.SharedKernel.Audit;
using Shouldly;

namespace MatterFlow.UnitTests.Audit;

public class AuditDiffTests
{
    [Fact]
    public void Equal_values_produce_no_change()
    {
        AuditDiff.Diff("Title", "a", "a").ShouldBeEmpty();
        AuditDiff.Diff("Title", null, null).ShouldBeEmpty();
    }

    [Fact]
    public void Scalar_change_is_one_field_with_invariant_formatting()
    {
        AuditDiff.Diff("Count", 1, 2).ShouldBe([new FieldChange("Count", "1", "2")]);
        AuditDiff.Diff("Flag", false, true).ShouldBe([new FieldChange("Flag", "false", "true")]);
        AuditDiff.Diff("Rate", 1.5m, 2.5m).ShouldBe([new FieldChange("Rate", "1.5", "2.5")]);
        AuditDiff.Diff("At", null, new DateTime(2026, 1, 2, 3, 4, 5, DateTimeKind.Utc))
            .Single().NewValue.ShouldBe("2026-01-02T03:04:05.0000000Z");
    }

    [Fact]
    public void Null_to_value_and_value_to_null_are_changes()
    {
        AuditDiff.Diff("Title", null, "x").ShouldBe([new FieldChange("Title", null, "x")]);
        AuditDiff.Diff("Title", "x", null).ShouldBe([new FieldChange("Title", "x", null)]);
    }

    [Fact]
    public void Json_columns_are_diffed_per_key_with_prefix()
    {
        var changes = AuditDiff.Diff(
            "ValuesJson",
            """{"ocr_language":"en","pages":2,"keep":true,"gone":"x"}""",
            """{"ocr_language":"de","pages":2,"keep":true,"added":[1,2]}""",
            "form");

        changes.ShouldBe(
            [
                new FieldChange("form:ocr_language", "en", "de"),
                new FieldChange("form:gone", "x", null),
                new FieldChange("form:added", null, "[1,2]"),
            ],
            ignoreOrder: true);
    }

    [Fact]
    public void Json_diff_from_and_to_empty_lists_every_key()
    {
        AuditDiff.Diff("V", null, """{"a":"1"}""", "form").ShouldBe([new FieldChange("form:a", null, "1")]);
        AuditDiff.Diff("V", """{"a":"1"}""", null, "form").ShouldBe([new FieldChange("form:a", "1", null)]);
        AuditDiff.Diff("V", null, null, "form").ShouldBeEmpty();
    }

    [Fact]
    public void Unparsable_or_non_object_json_falls_back_to_whole_property()
    {
        AuditDiff.Diff("V", "not json", """{"a":1}""", "form").ShouldBe([new FieldChange("V", "not json", """{"a":1}""")]);
        AuditDiff.Diff("V", "[1]", "[2]", "form").ShouldBe([new FieldChange("V", "[1]", "[2]")]);
    }

    [Fact]
    public void Field_keys_are_clipped_to_the_column_length()
    {
        var key = new string('k', 150);

        AuditDiff.Diff("V", null, $$"""{"{{key}}":"v"}""", "form").Single().FieldKey.Length.ShouldBe(AuditDiff.MaxFieldKeyLength);
    }
}

public class RedactionTests
{
    [Fact]
    public void Mask_hides_non_empty_values_and_keeps_absence_visible()
    {
        Redaction.Mask("secret body").ShouldBe(Redaction.Masked);
        Redaction.Mask(null).ShouldBeNull();
        Redaction.Mask("").ShouldBe("");
    }

    [Fact]
    public void Emails_in_free_text_are_masked()
    {
        Redaction.MaskEmails("Contact jane.doe+x@firm.example.com or bob@corp.io today")
            .ShouldBe("Contact [email] or [email] today");
        Redaction.MaskEmails(null).ShouldBe(string.Empty);
        Redaction.MaskEmails("no address here").ShouldBe("no address here");
    }

    [Fact]
    public void Truncate_flags_long_values()
    {
        Redaction.Truncate(new string('a', 4001), out var truncated)!.Length.ShouldBe(4000);
        truncated.ShouldBeTrue();
        Redaction.Truncate("short", out truncated).ShouldBe("short");
        truncated.ShouldBeFalse();
        Redaction.Truncate(null, out truncated).ShouldBeNull();
        truncated.ShouldBeFalse();
    }

    [Fact]
    public void Audit_event_log_string_never_contains_values()
    {
        var evt = new AuditEvent
        {
            Id = 5,
            EventType = "FIELD_CHANGED",
            ObjectType = "Task",
            ObjectId = "12",
            FieldKey = "Description",
            OldValue = "privileged old text",
            NewValue = "privileged new text jane@firm.com",
            CorrelationId = Guid.Empty,
        };

        var text = evt.ToLogString();

        text.ShouldContain("Task/12");
        text.ShouldContain("Description");
        text.ShouldNotContain("privileged");
        text.ShouldNotContain("jane@firm.com");
    }
}

public class AuditEntryBufferTests
{
    [Fact]
    public void Drain_returns_entries_once_and_requeue_restores_them_in_front()
    {
        var buffer = new AuditEntryBuffer();
        var a = new AuditEntry { EventType = "A", ObjectType = "T", ObjectId = "1" };
        var b = new AuditEntry { EventType = "B", ObjectType = "T", ObjectId = "2" };
        buffer.Write(a);

        var drained = buffer.Drain();
        buffer.Write(b);
        buffer.Requeue(drained);

        buffer.Drain().ShouldBe([a, b]);
        buffer.Drain().ShouldBeEmpty();
    }

    [Fact]
    public void Invalid_entries_are_rejected()
    {
        var buffer = new AuditEntryBuffer();

        Should.Throw<ArgumentException>(() => buffer.Write(new AuditEntry { EventType = "", ObjectType = "T", ObjectId = "1" }));
        Should.Throw<ArgumentException>(() => buffer.Write(new AuditEntry { EventType = "A", ObjectType = "T" }));
    }

    [Fact]
    public void Correlation_id_is_stable_until_a_new_operation_begins()
    {
        var correlation = new AuditCorrelation();
        var first = correlation.Id;

        correlation.Id.ShouldBe(first);
        var second = correlation.BeginOperation();

        second.ShouldNotBe(first);
        correlation.Id.ShouldBe(second);
    }
}
