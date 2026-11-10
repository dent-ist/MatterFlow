using LptHub.Reports.Application;
using LptHub.SharedKernel.Identity;
using Microsoft.Extensions.Options;
using Shouldly;

namespace LptHub.UnitTests.Reports;

/// <summary>Favourites and the Recent line (issue #723): the report rule, idempotence, the limit and the clamp of the line.</summary>
public class ReportPersonalServiceTests
{
    private sealed class FakeUser(int? id) : ICurrentUser
    {
        public int? UserId => id;

        public bool IsAuthenticated => id is not null;
    }

    private sealed class FakeCatalog(params int[] runnable) : IReportCatalog
    {
        public Task<RunnableReport?> FindRunnableAsync(int reportId, int userId, CancellationToken cancellationToken) =>
            Task.FromResult<RunnableReport?>(runnable.Contains(reportId) ? new RunnableReport(reportId, "r", 1, 1, "SELECT 1", [], "[]", null, null) : null);

        public Task<RunnableDetail?> FindRunnableDetailAsync(int reportId, int userId, CancellationToken cancellationToken) => Task.FromResult<RunnableDetail?>(null);

        public Task<IReadOnlyList<RunnableListItem>> ListRunnableAsync(int userId, CancellationToken cancellationToken) => Task.FromResult<IReadOnlyList<RunnableListItem>>([]);
    }

    private sealed class FakeStore : IReportPersonalStore
    {
        public HashSet<(int User, int Report)> Marks { get; } = [];

        public int Writes { get; private set; }

        public int? LastTop { get; private set; }

        public Task<FavouriteWrite> AddFavouriteAsync(int reportId, int userId, int maxFavourites, CancellationToken cancellationToken)
        {
            Writes++;
            if (Marks.Contains((userId, reportId)))
                return Task.FromResult(FavouriteWrite.Ok);
            if (Marks.Count(m => m.User == userId) >= maxFavourites)
                return Task.FromResult(FavouriteWrite.LimitReached);
            Marks.Add((userId, reportId));
            return Task.FromResult(FavouriteWrite.Ok);
        }

        public Task RemoveFavouriteAsync(int reportId, int userId, CancellationToken cancellationToken)
        {
            Writes++;
            Marks.Remove((userId, reportId));
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<RecentReportRow>> ListRecentAsync(int userId, int top, CancellationToken cancellationToken)
        {
            LastTop = top;
            return Task.FromResult<IReadOnlyList<RecentReportRow>>([new RecentReportRow(1, "One", "Cat", new DateTime(2026, 11, 7, 8, 0, 0, DateTimeKind.Utc))]);
        }
    }

    private static ReportPersonalService Service(int? user, FakeStore store, int max = 2, params int[] runnable) =>
        new(new FakeUser(user), new FakeCatalog(runnable), store, Options.Create(new ReportsOptions { MaxFavouritesPerUser = max }));

    [Theory]
    [InlineData(null, 5)]
    [InlineData(0, 1)]
    [InlineData(-4, 1)]
    [InlineData(3, 3)]
    [InlineData(10, 10)]
    [InlineData(11, 10)]
    [InlineData(int.MaxValue, 10)]
    public void The_recent_line_defaults_to_five_and_is_held_between_one_and_ten(int? asked, int expected) =>
        ReportPersonalService.Clamp(asked).ShouldBe(expected);

    [Fact]
    public async Task A_report_the_person_may_not_run_is_404_for_add_and_remove_and_nothing_is_written()
    {
        var store = new FakeStore();
        var service = Service(7, store, 2, 1);

        var add = await service.SetFavouriteAsync(2, true, CancellationToken.None);
        var remove = await service.SetFavouriteAsync(2, false, CancellationToken.None);

        add.Problem!.Status.ShouldBe(404);
        remove.Problem!.Status.ShouldBe(404);
        add.Problem.Message.ShouldBe(ReportRunService.NotAvailableMessage);
        store.Writes.ShouldBe(0);
    }

    [Fact]
    public async Task Nobody_signed_in_gets_401()
    {
        var service = Service(null, new FakeStore(), 2, 1);

        (await service.SetFavouriteAsync(1, true, CancellationToken.None)).Problem!.Status.ShouldBe(401);
        (await service.RecentAsync(null, CancellationToken.None)).Problem!.Status.ShouldBe(401);
    }

    [Fact]
    public async Task Adding_twice_is_the_same_as_once_and_removing_something_not_set_is_fine()
    {
        var store = new FakeStore();
        var service = Service(7, store, 2, 1);

        (await service.SetFavouriteAsync(1, true, CancellationToken.None)).Problem.ShouldBeNull();
        (await service.SetFavouriteAsync(1, true, CancellationToken.None)).Problem.ShouldBeNull();
        store.Marks.ShouldBe([(7, 1)]);
        (await service.SetFavouriteAsync(1, false, CancellationToken.None)).Problem.ShouldBeNull();
        (await service.SetFavouriteAsync(1, false, CancellationToken.None)).Problem.ShouldBeNull();
        store.Marks.ShouldBeEmpty();
    }

    [Fact]
    public async Task At_the_limit_a_new_favourite_is_409_with_the_number_but_an_existing_one_can_be_added_again()
    {
        var store = new FakeStore();
        var service = Service(7, store, 2, 1, 2, 3);
        await service.SetFavouriteAsync(1, true, CancellationToken.None);
        await service.SetFavouriteAsync(2, true, CancellationToken.None);

        var over = await service.SetFavouriteAsync(3, true, CancellationToken.None);

        over.Problem!.Status.ShouldBe(409);
        over.Problem.Code.ShouldBe(ReportPersonalService.FavouriteLimitCode);
        over.Problem.Message.ShouldBe("You can have up to 2 favourite reports.");
        (await service.SetFavouriteAsync(2, true, CancellationToken.None)).Problem.ShouldBeNull();
        store.Marks.Count.ShouldBe(2);
        // Removing one frees a place.
        await service.SetFavouriteAsync(1, false, CancellationToken.None);
        (await service.SetFavouriteAsync(3, true, CancellationToken.None)).Problem.ShouldBeNull();
    }

    [Fact]
    public async Task The_limit_is_per_person()
    {
        var store = new FakeStore();
        await Service(7, store, 1, 1, 2).SetFavouriteAsync(1, true, CancellationToken.None);

        (await Service(8, store, 1, 1, 2).SetFavouriteAsync(2, true, CancellationToken.None)).Problem.ShouldBeNull();
        store.Marks.Count.ShouldBe(2);
    }

    [Fact]
    public async Task The_recent_line_asks_the_store_for_the_clamped_number()
    {
        var store = new FakeStore();
        var service = Service(7, store);

        var rows = await service.RecentAsync(99, CancellationToken.None);

        store.LastTop.ShouldBe(10);
        rows.Value.ShouldHaveSingleItem().Name.ShouldBe("One");
        await service.RecentAsync(null, CancellationToken.None);
        store.LastTop.ShouldBe(5);
    }
}
