using System.Linq.Expressions;
using MatterFlow.Identity.Access;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Visibility;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Organization;

/// <summary>
/// "Matters managed by me" resolved once (epic #758, PX-02, #760): every endpoint that means it goes through <c>IManagedMatterScope</c> and so through the
/// visibility hook of the sensitive-matter epic. A recording decorator proves each of them calls the hook; with the go-live switch on the hook actually hides.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class ManagedScopeSeamTests(SqlServerFixture sql)
{
    private sealed class Recording(IMatterVisibility inner) : IMatterVisibility
    {
        public int Calls;

        public bool Enabled => inner.Enabled;

        public Viewer Current => inner.Current;

        public Task<Viewer> ForAsync(int userId, CancellationToken cancellationToken = default) => inner.ForAsync(userId, cancellationToken);

        public IQueryable<MatterAccessRow> VisibleMatters(Viewer? viewer = null)
        {
            Calls++;
            return inner.VisibleMatters(viewer);
        }

        public IQueryable<TaskAccessRow> VisibleTasks(Viewer? viewer = null)
        {
            Calls++;
            return inner.VisibleTasks(viewer);
        }

        public IQueryable<T> WhereMatterVisible<T>(IQueryable<T> source, Expression<Func<T, int>> matterId, Viewer? viewer = null)
        {
            Calls++;
            return inner.WhereMatterVisible(source, matterId, viewer);
        }

        public IQueryable<T> WhereTaskVisible<T>(IQueryable<T> source, Expression<Func<T, long>> taskId, Viewer? viewer = null)
        {
            Calls++;
            return inner.WhereTaskVisible(source, taskId, viewer);
        }

        public IQueryable<T> WhereMatterVisibleOr<T>(IQueryable<T> source, Expression<Func<T, int>> matterId, Func<int, Expression<Func<T, bool>>> alsoVisible, Viewer? viewer = null)
        {
            Calls++;
            return inner.WhereMatterVisibleOr(source, matterId, alsoVisible, viewer);
        }

        public IQueryable<T> WhereMatterRowVisibleOr<T>(IQueryable<T> source, Expression<Func<T, bool>> isSensitive, Expression<Func<T, int?>> primaryManagerId, Expression<Func<T, int?>> secondaryManagerId, Func<int, Expression<Func<T, bool>>> alsoVisible, Viewer? viewer = null)
        {
            Calls++;
            return inner.WhereMatterRowVisibleOr(source, isSensitive, primaryManagerId, secondaryManagerId, alsoVisible, viewer);
        }

        public IQueryable<T> WhereTaskVisibleBy<T>(IQueryable<T> source, Expression<Func<T, int>> matterId, Expression<Func<T, int?>> assignedUserId, Viewer? viewer = null)
        {
            Calls++;
            return inner.WhereTaskVisibleBy(source, matterId, assignedUserId, viewer);
        }

        public IQueryable<T> WhereMatterRowVisible<T>(IQueryable<T> source, Expression<Func<T, bool>> isSensitive, Expression<Func<T, int?>> primaryManagerId, Expression<Func<T, int?>> secondaryManagerId, Viewer? viewer = null)
        {
            Calls++;
            return inner.WhereMatterRowVisible(source, isSensitive, primaryManagerId, secondaryManagerId, viewer);
        }

        public IQueryable<T> WhereTaskRowVisible<T>(IQueryable<T> source, Expression<Func<T, bool>> isSensitive, Expression<Func<T, int?>> primaryManagerId, Expression<Func<T, int?>> secondaryManagerId, Expression<Func<T, int?>> assignedUserId, Viewer? viewer = null)
        {
            Calls++;
            return inner.WhereTaskRowVisible(source, isSensitive, primaryManagerId, secondaryManagerId, assignedUserId, viewer);
        }

        public Task<bool> CanSeeMatterAsync(int matterId, CancellationToken cancellationToken = default) => inner.CanSeeMatterAsync(matterId, cancellationToken);

        public Task<bool> CanSeeTaskAsync(long taskId, CancellationToken cancellationToken = default) => inner.CanSeeTaskAsync(taskId, cancellationToken);

        public Error NotFound() => inner.NotFound();
    }

    private static (WebApplicationFactory<Program> Factory, List<Recording> Recorders) WithRecorder(DatabaseApiFactory factory)
    {
        var recorders = new List<Recording>();
        var wrapped = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IMatterVisibility>();
            services.AddScoped<IMatterVisibility>(sp =>
            {
                var recording = new Recording(ActivatorUtilities.CreateInstance<MatterVisibility>(sp));
                lock (recorders)
                    recorders.Add(recording);
                return recording;
            });
        }));
        return (wrapped, recorders);
    }

    private static HttpClient Client(WebApplicationFactory<Program> factory, string user)
    {
        var http = factory.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", user);
        return http;
    }

    [Fact]
    public async Task Every_managed_by_endpoint_passes_through_the_visibility_hook()
    {
        var fx = await PmScopeFixture.BuildAsync(new DatabaseApiFactory(await sql.CreateDatabaseAsync()));
        var (wrapped, recorders) = WithRecorder(fx.Harness.Factory);
        try
        {
            var pm = Client(wrapped, @"KE\pmfew");
            var director = Client(wrapped, @"KE\fxdirector");
            var calls = new (string Name, HttpClient Client, string Url)[]
            {
                ("matters managedByMe", pm, "/api/v1/matters?managedByMe=true"),
                ("matters managerId", director, $"/api/v1/matters?managerId={fx.PmManyId}"),
                ("matters primaryManagerId", director, $"/api/v1/matters?primaryManagerId={fx.PmManyId}"),
                ("matters secondaryManagerId", director, $"/api/v1/matters?secondaryManagerId={fx.PmManyId}"),
                ("task queue managedByMe", pm, "/api/v1/task-queue?managedByMe=true"),
                ("task queue managerId", director, $"/api/v1/task-queue?managerId={fx.PmManyId}&role=primary"),
                ("my matters mine", pm, "/api/v1/my-matters/summary?fresh=true"),
                ("my matters all", director, "/api/v1/my-matters/summary?fresh=true&scope=all"),
                ("my matters all, named manager", director, $"/api/v1/my-matters/summary?fresh=true&scope=all&managerId={fx.PmManyId}"),
            };

            foreach (var (name, client, url) in calls)
            {
                int before;
                lock (recorders)
                    before = recorders.Sum(r => r.Calls);
                await OkAsync(await client.GetAsync(url));
                int after;
                lock (recorders)
                    after = recorders.Sum(r => r.Calls);
                after.ShouldBeGreaterThan(before, $"{name} ({url}) did not call the visibility hook");
            }
        }
        finally
        {
            await wrapped.DisposeAsync();
            await fx.Harness.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task With_the_switch_on_managed_by_lists_leave_out_matters_the_caller_may_not_see_and_with_it_off_nothing_changes()
    {
        var cs = await sql.CreateDatabaseAsync();
        var fx = await PmScopeFixture.BuildAsync(new DatabaseApiFactory(cs) { ExtraSettings = [("Features:SensitiveMatterAccess", "true")] });
        try
        {
            async Task<int[]> Ids(HttpClient c, string q) => PmScopeFixture.MatterIds(await OkAsync(await c.GetAsync("/api/v1/matters?pageSize=100&" + q)));
            var other = fx.ManagedKeys(fx.PmOtherId);
            other.ShouldContain("sensitiveManaged");
            other.ShouldContain("sensitiveOther");

            // PmOther manages two sensitive matters: sees them. The Director may ask for PmOther's matters but is not entitled to the sensitive ones.
            (await Ids(fx.PmOther, "managedByMe=true")).ShouldBe(fx.IdsOf(other));
            (await Ids(fx.Director, $"managerId={fx.PmOtherId}")).ShouldBe(fx.IdsOf(other.Except(["sensitiveManaged", "sensitiveOther"])));
            (await Ids(fx.Director, $"primaryManagerId={fx.PmOtherId}")).ShouldNotContain(fx.Matters["sensitiveManaged"]);
            // The administrator holds every permission: all of them.
            (await Ids(fx.Admin, $"managerId={fx.PmOtherId}")).ShouldBe(fx.IdsOf(other));

            // The task queue and My Matters follow the same rule through the same seam.
            var queue = await OkAsync(await fx.Director.GetAsync($"/api/v1/task-queue?pageSize=100&managerId={fx.PmOtherId}"));
            queue.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("taskId").GetInt64()).ShouldNotContain(fx.Tasks["sensitiveManaged"]);
            var summary = await OkAsync(await fx.Director.GetAsync($"/api/v1/my-matters/summary?fresh=true&scope=all&managerId={fx.PmOtherId}"));
            summary.GetProperty("matters").GetProperty("count").GetInt32().ShouldBe(other.Count - 2);
            var all = await OkAsync(await fx.Director.GetAsync("/api/v1/my-matters/summary?fresh=true&scope=all"));
            all.GetProperty("matters").GetProperty("count").GetInt32().ShouldBe(fx.Matters.Count + 1 - fx.SensitiveKeys.Count);
        }
        finally
        {
            await fx.Harness.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task The_all_scope_still_needs_AssignManagers_with_the_same_answer()
    {
        var fx = await PmScopeFixture.BuildAsync(new DatabaseApiFactory(await sql.CreateDatabaseAsync()));
        try
        {
            var denied = await ProblemAsync(await fx.PmFew.GetAsync("/api/v1/my-matters/summary?scope=all"), System.Net.HttpStatusCode.Forbidden, "PERMISSION_DENIED");
            denied.GetProperty("meta").GetProperty("permission").GetString().ShouldBe("Matter.AssignManagers");
            var queue = await ProblemAsync(await fx.PmFew.GetAsync($"/api/v1/task-queue?managerId={fx.PmManyId}"), System.Net.HttpStatusCode.Forbidden, "PERMISSION_DENIED");
            queue.GetProperty("meta").GetProperty("permission").GetString().ShouldBe("Matter.AssignManagers");
        }
        finally
        {
            await fx.Harness.Factory.DisposeAsync();
        }
    }
}
