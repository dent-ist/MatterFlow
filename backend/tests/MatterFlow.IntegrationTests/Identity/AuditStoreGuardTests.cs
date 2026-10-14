using MatterFlow.Api.Security;
using Shouldly;

namespace MatterFlow.IntegrationTests.Identity;

/// <summary>Security review SEC-04: what the host does when the API's database identity can modify the audit table.</summary>
public class AuditStoreGuardTests
{
    [Theory]
    [InlineData(false, true, false, AuditStoreGuard.Outcome.Safe)]
    [InlineData(false, false, false, AuditStoreGuard.Outcome.Safe)]
    [InlineData(true, true, false, AuditStoreGuard.Outcome.Refuse)]
    [InlineData(true, true, true, AuditStoreGuard.Outcome.Warn)]
    [InlineData(true, false, false, AuditStoreGuard.Outcome.Warn)]
    public void Production_refuses_a_privileged_identity_unless_explicitly_allowed(bool exposed, bool production, bool allow, AuditStoreGuard.Outcome expected) =>
        AuditStoreGuard.Decide(exposed, production, allow).ShouldBe(expected);
}
