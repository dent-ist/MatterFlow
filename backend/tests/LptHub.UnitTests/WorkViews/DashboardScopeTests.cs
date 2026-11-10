using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkManagement.Domain;
using MatterFlow.WorkViews.Application.Queries;
using Shouldly;

namespace MatterFlow.UnitTests.WorkViews;

/// <summary>The page-wide Dashboard scope (P1, #89): how "all", "mine" and a pod id resolve for a caller, the cache key, the drill-through query and the validation.</summary>
public class DashboardScopeTests
{
    private sealed class Pods(params (int Id, bool Active, bool Primary)[] membership) : IPodDirectory
    {
        public int[] Known { get; init; } = [1, 2, 3, 9];

        public Task<PodInfo?> FindAsync(int podId, CancellationToken cancellationToken = default) =>
            Task.FromResult<PodInfo?>(Known.Contains(podId) ? new PodInfo(podId, "Pod " + podId, true) : null);

        public Task<bool> IsAvailableForAssignmentAsync(int podId, CancellationToken cancellationToken = default) => Task.FromResult(Known.Contains(podId));

        public Task<IReadOnlyList<UserPodInfo>> GetUserPodsAsync(int userId, bool includeInactive = false, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<UserPodInfo>>([.. membership.Where(m => includeInactive || m.Active).Select(m => new UserPodInfo(new PodInfo(m.Id, "Pod " + m.Id, m.Active), m.Primary))]);

        public Task<PodInfo?> GetPrimaryPodAsync(int userId, CancellationToken cancellationToken = default) => Task.FromResult<PodInfo?>(null);

        public Task<IReadOnlyList<int>> GetMemberUserIdsAsync(int podId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<int>>([]);
    }

    private sealed class Me(int? id) : ICurrentUser
    {
        public int? UserId => id;

        public bool IsAuthenticated => id is not null;
    }

    private sealed class Perms(bool podView) : IPermissionChecker
    {
        public bool Has(string permissionCode) => podView && permissionCode == Permissions.Pod.View;

        public Result Require(string permissionCode) => Has(permissionCode) ? Result.Success() : Result.Failure(Error.Forbidden("no"));
    }

    private static DashboardScopeResolver Resolver(Pods pods, bool podView = false, int? user = 7) => new(null!, new Me(user), pods, new Perms(podView));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("all")]
    [InlineData("ALL")]
    public async Task No_scope_or_all_is_every_task_even_for_an_anonymous_caller(string? raw)
    {
        var result = await Resolver(new Pods(), user: null).ResolveAsync(raw, null, default);

        result.Value.IsAll.ShouldBeTrue();
        result.Value.Key.ShouldBe("all");
        result.Value.Scoped("status=NEW").ShouldBe("status=NEW");
    }

    [Fact]
    public async Task Mine_is_the_union_of_the_active_pods_of_the_caller_resolved_on_the_server()
    {
        var result = await Resolver(new Pods((3, true, false), (1, true, true), (2, false, false))).ResolveAsync("mine", null, default);

        result.Value.Value.ShouldBe("mine");
        result.Value.PodIds.Order().ShouldBe([1, 3]);
        result.Value.Key.ShouldBe("mine:1,3");
        result.Value.Scoped("status=NEW&overdue=true").ShouldBe("status=NEW&overdue=true&pod=1&pod=3");
    }

    [Fact]
    public async Task Mine_without_a_pod_matches_nothing_and_its_drill_through_matches_nothing()
    {
        var result = await Resolver(new Pods()).ResolveAsync("mine", null, default);

        result.Value.PodIds.ShouldBeEmpty();
        result.Value.Scoped("status=NEW").ShouldBe("status=NEW&pod=0");
        result.Value.Apply(new List<WorkTask>().AsQueryable()).ShouldBeEmpty();
    }

    [Fact]
    public async Task One_pod_of_the_caller_is_allowed_without_Pod_View_and_any_existing_pod_with_it()
    {
        var own = await Resolver(new Pods((2, true, true))).ResolveAsync("2", null, default);
        own.Value.PodIds.ShouldBe([2]);
        own.Value.Scoped("").ShouldBe("pod=2");

        var other = await Resolver(new Pods((2, true, true)), podView: true).ResolveAsync("3", null, default);
        other.Value.PodIds.ShouldBe([3]);
        other.Value.Key.ShouldBe("3:3");
    }

    [Fact]
    public async Task A_pod_the_caller_may_not_see_is_forbidden_and_an_unknown_one_is_a_validation_error()
    {
        var forbidden = await Resolver(new Pods((2, true, true))).ResolveAsync("3", null, default);
        forbidden.IsFailure.ShouldBeTrue();
        forbidden.Error!.Type.ShouldBe(ErrorType.Forbidden);

        var unknown = await Resolver(new Pods((2, true, true)), podView: true).ResolveAsync("77", null, default);
        unknown.Error!.Type.ShouldBe(ErrorType.Validation);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("1; DROP TABLE")]
    [InlineData("my")]
    [InlineData("1.5")]
    public async Task Anything_else_is_a_validation_error(string raw)
    {
        var result = await Resolver(new Pods((1, true, true)), podView: true).ResolveAsync(raw, null, default);

        result.IsFailure.ShouldBeTrue();
        result.Error!.Type.ShouldBe(ErrorType.Validation);
    }

    [Fact]
    public async Task The_legacy_pod_id_is_read_as_a_scope_and_podScope_wins()
    {
        var resolver = Resolver(new Pods((1, true, true), (2, true, false)));

        (await resolver.ResolveAsync(null, 2, default)).Value.PodIds.ShouldBe([2]);
        (await resolver.ResolveAsync("1", 2, default)).Value.PodIds.ShouldBe([1]);
        (await resolver.ResolveAsync("all", 2, default)).Value.IsAll.ShouldBeTrue();
    }

    [Fact]
    public void Apply_keeps_only_tasks_whose_pod_field_is_in_the_scope_and_never_tasks_without_a_pod()
    {
        var scope = new DashboardScope("mine", [1, 3]);
        var tasks = new int?[] { 1, 2, 3, null }.Select(pod => TaskIn(pod)).ToList();

        scope.Apply(tasks.AsQueryable()).Select(t => t.AssignedPodId).ShouldBe([1, 3]);
        DashboardScope.Everything.Apply(tasks.AsQueryable()).Count().ShouldBe(4);
    }

    [Fact]
    public void The_cache_key_differs_per_resolved_pods()
    {
        new DashboardScope("mine", [1, 2]).Key.ShouldNotBe(new DashboardScope("mine", [1]).Key);
        new DashboardScope("mine", [2, 1]).Key.ShouldBe(new DashboardScope("mine", [1, 2]).Key);
        new DashboardScope("1", [1]).Key.ShouldNotBe(DashboardScope.Everything.Key);
    }

    private static WorkTask TaskIn(int? pod)
    {
        var task = (WorkTask)System.Runtime.CompilerServices.RuntimeHelpers.GetUninitializedObject(typeof(WorkTask));
        typeof(WorkTask).GetProperty(nameof(WorkTask.AssignedPodId))!.SetValue(task, pod);
        return task;
    }
}
