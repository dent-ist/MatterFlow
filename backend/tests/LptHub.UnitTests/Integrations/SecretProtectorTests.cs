using LptHub.Integrations.Application;
using LptHub.SharedKernel.Results;
using Microsoft.AspNetCore.DataProtection;
using Shouldly;

namespace LptHub.UnitTests.Integrations;

public class SecretProtectorTests
{
    private static DataProtectionSecretProtector Protector(IDataProtectionProvider? provider = null, bool configured = true) =>
        new(provider ?? new EphemeralDataProtectionProvider(), new KeyStoreStatus(configured));

    [Fact]
    public void A_secret_round_trips_and_the_stored_text_does_not_contain_it()
    {
        var protector = Protector();

        var stored = protector.Protect("Abc8Q~very-secret-value");
        var back = protector.Unprotect(stored.Value);

        stored.IsSuccess.ShouldBeTrue();
        stored.Value.ShouldNotContain("very-secret-value");
        back.Value.ShouldBe("Abc8Q~very-secret-value");
    }

    [Fact]
    public void The_same_secret_is_stored_differently_each_time()
    {
        var protector = Protector();

        protector.Protect("same").Value.ShouldNotBe(protector.Protect("same").Value);
    }

    [Fact]
    public void Without_a_key_store_nothing_is_stored()
    {
        var result = Protector(configured: false).Protect("value");

        result.IsFailure.ShouldBeTrue();
        result.Error!.Code.ShouldBe(ErrorCodes.SecretStoreUnavailable);
    }

    [Fact]
    public void A_secret_stored_under_other_keys_or_damaged_cannot_be_read_and_says_so_plainly()
    {
        var stored = Protector().Protect("value").Value;

        var otherKeys = Protector(new EphemeralDataProtectionProvider()).Unprotect(stored);
        var damaged = Protector().Unprotect("not-a-protected-payload");

        otherKeys.Error!.Code.ShouldBe(ErrorCodes.SecretStoreUnavailable);
        damaged.Error!.Code.ShouldBe(ErrorCodes.SecretStoreUnavailable);
        otherKeys.Error.Message.ShouldNotContain("value");
    }

    [Fact]
    public void Another_purpose_cannot_read_the_secret()
    {
        var provider = new EphemeralDataProtectionProvider();
        var stored = Protector(provider).Protect("value").Value;

        Should.Throw<System.Security.Cryptography.CryptographicException>(() => provider.CreateProtector("some other purpose").Unprotect(stored));
    }
}
