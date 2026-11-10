using LptHub.Assets.Domain;
using LptHub.IntegrationTests.Fixtures;
using LptHub.Organization.Domain;
using LptHub.SharedKernel.Visibility;
using LptHub.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace LptHub.IntegrationTests.Visibility;

/// <summary>
/// Issue #1304: an entity loaded through a visibility helper must be TRACKED for a caller who is not "see all" while the sensitive-matter rule is on. The helpers filter with a subquery over the
/// access rows; if those rows are read with <c>AsNoTracking</c>, EF applies that to the whole statement and <c>SaveChanges</c> silently saves nothing. This is the root-cause guard (the
/// per-module write tests are in <c>LostWriteOrganizationTests</c>, <c>LostWriteWorkTests</c> and <c>LostWriteContentTests</c>).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class VisibilityFilterTrackingTests(SqlServerFixture sql)
{
    [Fact]
    public async Task Entities_loaded_through_the_visibility_helpers_are_tracked_for_a_caller_who_is_not_see_all()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        await using var _ = u.H.Factory;
        await using var scope = u.H.Factory.Services.CreateAsyncScope();
        var visibility = scope.ServiceProvider.GetRequiredService<IMatterVisibility>();
        var db = scope.ServiceProvider.GetRequiredService<DbContext>();
        visibility.Enabled.ShouldBeTrue();
        var persona = new Viewer(u.Unrelated, SeeAll: false);

        var project = await visibility.WhereMatterVisible(db.Set<Project>(), p => p.MatterId, persona).SingleAsync(p => p.Id == u.PN1);
        db.Entry(project).State.ShouldBe(EntityState.Unchanged, "WhereMatterVisible");

        var task = await visibility.WhereTaskVisible(db.Set<WorkTask>(), t => t.Id, persona).SingleAsync(t => t.Id == u.TN1);
        db.Entry(task).State.ShouldBe(EntityState.Unchanged, "WhereTaskVisible");

        var byAssignee = await visibility.WhereTaskVisibleBy(db.Set<WorkTask>(), t => t.MatterId, t => t.AssignedUserId, persona).SingleAsync(t => t.Id == u.TN1);
        byAssignee.ShouldBeSameAs(task);

        var flagged = await visibility.WhereTaskFlagVisible(db.Set<WorkTask>(), t => t.MatterId, t => t.IsMatterSensitive, t => t.AssignedUserId, persona).SingleAsync(t => t.Id == u.TN1);
        flagged.ShouldBeSameAs(task);

        var viaOr = await visibility.WhereMatterVisibleOr(db.Set<Project>(), p => p.MatterId, _ => p => false, persona).SingleAsync(p => p.Id == u.PN1);
        viaOr.ShouldBeSameAs(project);

        // The change is really saved.
        project.Description = "changed through the filter";
        await db.SaveChangesAsync();
        (await u.H.Factory.WithDbAsync(d => d.Set<Project>().AsNoTracking().Where(p => p.Id == u.PN1).Select(p => p.Description).SingleAsync())).ShouldBe("changed through the filter");

        // A hidden matter's project is not returned at all.
        (await visibility.WhereMatterVisible(db.Set<Project>(), p => p.MatterId, persona).AnyAsync(p => p.Id == u.PS2)).ShouldBeFalse();
    }
}
