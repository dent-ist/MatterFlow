using MatterFlow.Audit.Application;
using Shouldly;

namespace MatterFlow.UnitTests.Audit;

public class AuditSummaryComposerTests
{
    [Fact]
    public void Status_change_reads_with_labels()
    {
        AuditSummaryComposer.Compose("TASK_STATUS_CHANGED", null, "IN_PROGRESS", "ON_HOLD", null, false).ShouldBe("Status changed from In Progress to On Hold");
        AuditSummaryComposer.Compose("TASK_STATUS_CHANGED", null, null, "NEW", null, false).ShouldBe("Status set to New");
    }

    [Theory]
    [InlineData("priority", "Normal", "High", "Priority changed from Normal to High")]
    [InlineData("form:billing_code", null, "B-7", "Billing code set to B-7")]
    [InlineData("ClientNumber", "00343", null, "Client number cleared")]
    [InlineData("description", "a", "b", "Description changed")]
    public void Field_changes_read_as_sentences(string key, string? oldValue, string? newValue, string expected) =>
        AuditSummaryComposer.Compose("FIELD_CHANGED", key, oldValue, newValue, null, false).ShouldBe(expected);

    [Fact]
    public void Masked_values_are_never_repeated_in_the_sentence() =>
        AuditSummaryComposer.Compose("FIELD_CHANGED", "api_token", "[REDACTED]", "[REDACTED]", null, true).ShouldBe("Api token changed");

    [Fact]
    public void Stored_summary_wins_for_other_events_and_the_bulk_flag_is_shortened()
    {
        AuditSummaryComposer.Compose("STEP_COMPLETED", null, null, null, "step 'A' completed (bulk=true)", false).ShouldBe("Step 'A' completed (bulk)");
        AuditSummaryComposer.Compose("ROLE_GRANTED", null, null, null, null, false).ShouldBe("Role granted");
    }

    [Fact]
    public void Long_values_are_clipped_in_the_sentence()
    {
        var text = AuditSummaryComposer.Compose("FIELD_CHANGED", "title", "a", new string('x', 200), null, false);

        text.Length.ShouldBeLessThan(140);
        text.ShouldEndWith("...");
    }
}

public class AuditAssignmentTextTests
{
    private static readonly Dictionary<int, string> Users = new() { [9] = "Dana P.", [4] = "Sam K." };
    private static readonly Dictionary<int, string> Pods = new() { [2] = "Pod A" };

    [Fact]
    public void Reassigning_names_both_sides() =>
        AuditAssignmentText.Describe("""{"podId":2,"userId":9}""", """{"podId":2,"userId":4}""", Users, Pods)
            .ShouldBe("Reassigned from Dana P. (Pod A) to Sam K. (Pod A)");

    [Fact]
    public void First_assignment_and_unassignment_read_naturally()
    {
        AuditAssignmentText.Describe(null, """{"podId":2}""", Users, Pods).ShouldBe("Assigned to Pod A (pod)");
        AuditAssignmentText.Describe("""{"podId":2,"userId":9}""", """{"podId":2}""", Users, Pods).ShouldBe("Reassigned from Dana P. (Pod A) to Pod A (pod)");
        AuditAssignmentText.Describe("""{"userId":9}""", null, Users, Pods).ShouldBe("Unassigned from Dana P.");
        AuditAssignmentText.Describe(null, null, Users, Pods).ShouldBe("Assignment cleared");
    }

    [Fact]
    public void Unknown_ids_and_damaged_values_do_not_throw()
    {
        AuditAssignmentText.Describe(null, """{"userId":77}""", Users, Pods).ShouldBe("Assigned to an unknown user");
        AuditAssignmentText.Parse("not json").ShouldBe((null, null));
        AuditAssignmentText.Parse("[1]").ShouldBe((null, null));
    }
}

public class AuditValueGuardTests
{
    [Theory]
    [InlineData("api_token")]
    [InlineData("form:Password")]
    [InlineData("ClientSecret")]
    [InlineData("ConnectionString")]
    [InlineData("AuthorizationHeader")]
    public void Secret_field_keys_are_sensitive(string key) => AuditValueGuard.IsSensitiveKey(key).ShouldBeTrue();

    [Theory]
    [InlineData("title")]
    [InlineData("form:billing_code")]
    [InlineData("bypass")]
    [InlineData(null)]
    public void Ordinary_field_keys_are_not(string? key) => AuditValueGuard.IsSensitiveKey(key).ShouldBeFalse();

    [Theory]
    [InlineData("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig")]
    [InlineData("Bearer abcdefghijklmnop1234")]
    [InlineData("Server=a;Password=x")]
    [InlineData("-----BEGIN RSA PRIVATE KEY-----")]
    public void Credential_looking_text_is_detected(string text) => AuditValueGuard.LooksLikeSecret(text).ShouldBeTrue();

    [Theory]
    [InlineData("Please reset the password for Smith")]
    [InlineData("Process custodians")]
    public void Prose_is_not_a_secret(string text) => AuditValueGuard.LooksLikeSecret(text).ShouldBeFalse();

    [Fact]
    public void Guard_masks_or_truncates()
    {
        AuditValueGuard.Guard("anything", true, out _, out var redacted).ShouldBe("[REDACTED]");
        redacted.ShouldBeTrue();
        AuditValueGuard.Guard(new string('a', 4001), false, out var truncated, out redacted)!.Length.ShouldBe(4000);
        truncated.ShouldBeTrue();
        redacted.ShouldBeFalse();
        AuditValueGuard.Guard(null, true, out _, out _).ShouldBeNull();
    }
}
