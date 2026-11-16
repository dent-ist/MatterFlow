using LptHub.Integrations.Application;
using LptHub.Integrations.Contracts;
using LptHub.SharedKernel.Results;
using Shouldly;

namespace LptHub.UnitTests.Integrations;

public class TokenCacheTests
{
    private readonly TestClock _clock = new(new DateTime(2026, 11, 16, 9, 0, 0, DateTimeKind.Utc));

    private TokenCache Cache(int refreshBeforeSeconds = 300) => new(_clock, TestOptions.Default(o => o.RefreshBeforeExpirySeconds = refreshBeforeSeconds));

    private Func<CancellationToken, Task<Result<AccessToken>>> Issue(Counter counter, int lifetimeSeconds = 3600) => _ =>
    {
        counter.Value++;
        return Task.FromResult<Result<AccessToken>>(new AccessToken("token-" + counter.Value, _clock.UtcNow.AddSeconds(lifetimeSeconds)));
    };

    private sealed class Counter
    {
        public int Value;
    }

    [Fact]
    public async Task A_token_is_reused_until_shortly_before_it_expires()
    {
        var cache = Cache();
        var calls = new Counter();

        var first = await cache.GetAsync("scope-a", Issue(calls), forceNew: false, CancellationToken.None);
        _clock.UtcNow = _clock.UtcNow.AddMinutes(54); // 6 minutes left, more than the 5-minute margin
        var second = await cache.GetAsync("scope-a", Issue(calls), forceNew: false, CancellationToken.None);

        calls.Value.ShouldBe(1);
        second.Value.Value.ShouldBe(first.Value.Value);
    }

    [Fact]
    public async Task A_token_is_replaced_once_inside_the_refresh_margin()
    {
        var cache = Cache();
        var calls = new Counter();

        await cache.GetAsync("scope-a", Issue(calls), false, CancellationToken.None);
        _clock.UtcNow = _clock.UtcNow.AddMinutes(56); // 4 minutes left: inside the margin
        var second = await cache.GetAsync("scope-a", Issue(calls), false, CancellationToken.None);

        calls.Value.ShouldBe(2);
        second.Value.Value.ShouldBe("token-2");
    }

    [Fact]
    public async Task Every_scope_has_its_own_token()
    {
        var cache = Cache();
        var calls = new Counter();

        var a = await cache.GetAsync("scope-a", Issue(calls), false, CancellationToken.None);
        var b = await cache.GetAsync("scope-b", Issue(calls), false, CancellationToken.None);

        calls.Value.ShouldBe(2);
        a.Value.Value.ShouldNotBe(b.Value.Value);
        cache.Count.ShouldBe(2);
    }

    [Fact]
    public async Task A_forced_request_ignores_a_fresh_token()
    {
        var cache = Cache();
        var calls = new Counter();

        await cache.GetAsync("scope-a", Issue(calls), false, CancellationToken.None);
        await cache.GetAsync("scope-a", Issue(calls), forceNew: true, CancellationToken.None);

        calls.Value.ShouldBe(2);
    }

    [Fact]
    public async Task A_failure_is_not_cached_and_drops_the_old_token()
    {
        var cache = Cache();
        var calls = new Counter();
        await cache.GetAsync("scope-a", Issue(calls, lifetimeSeconds: 10), false, CancellationToken.None); // inside the margin at once

        var failed = await cache.GetAsync("scope-a", _ => Task.FromResult<Result<AccessToken>>(Error.Conflict("X", "no")), false, CancellationToken.None);
        var again = await cache.GetAsync("scope-a", Issue(calls), false, CancellationToken.None);

        failed.IsFailure.ShouldBeTrue();
        again.IsSuccess.ShouldBeTrue();
        calls.Value.ShouldBe(2);
    }

    [Fact]
    public async Task Clear_forgets_every_token()
    {
        var cache = Cache();
        var calls = new Counter();
        await cache.GetAsync("scope-a", Issue(calls), false, CancellationToken.None);

        cache.Clear();
        await cache.GetAsync("scope-a", Issue(calls), false, CancellationToken.None);

        calls.Value.ShouldBe(2);
        cache.Count.ShouldBe(1);
    }

    [Fact]
    public async Task Concurrent_callers_share_one_request()
    {
        var cache = Cache();
        var calls = new Counter();
        var gate = new TaskCompletionSource();
        Task<Result<AccessToken>> Slow(CancellationToken ct) => Slowly();
        async Task<Result<AccessToken>> Slowly()
        {
            Interlocked.Increment(ref calls.Value);
            await gate.Task;
            return new AccessToken("t", _clock.UtcNow.AddHours(1));
        }

        var tasks = Enumerable.Range(0, 8).Select(_ => cache.GetAsync("scope-a", Slow, false, CancellationToken.None)).ToList();
        gate.SetResult();
        await Task.WhenAll(tasks);

        calls.Value.ShouldBe(1);
    }

    [Fact]
    public void The_key_changes_with_any_credential_part_and_never_shows_them()
    {
        var set = new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc);
        var key = TokenCache.KeyOf("tenant", "client", "api://x/.default", set);

        TokenCache.KeyOf("tenant2", "client", "api://x/.default", set).ShouldNotBe(key);
        TokenCache.KeyOf("tenant", "client2", "api://x/.default", set).ShouldNotBe(key);
        TokenCache.KeyOf("tenant", "client", "api://y/.default", set).ShouldNotBe(key);
        TokenCache.KeyOf("tenant", "client", "api://x/.default", set.AddSeconds(1)).ShouldNotBe(key);
        key.ShouldNotContain("tenant");
    }

    [Fact]
    public void A_token_never_prints_its_value()
    {
        new AccessToken("super-secret-token", DateTime.UtcNow).ToString().ShouldNotContain("super-secret-token");
    }
}
