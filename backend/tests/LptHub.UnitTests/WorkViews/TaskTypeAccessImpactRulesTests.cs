using LptHub.SharedKernel.Tasks;
using LptHub.WorkViews.Application.Queries;
using Shouldly;

namespace LptHub.UnitTests.WorkViews;

/// <summary>The access rule behind the Task Type access preview (design sections 1.1 and 1.2): empty Edit or Assign lists mean no extra limit, roles add up, System Admin sees everything.</summary>
public class TaskTypeAccessImpactRulesTests
{
    private const int A = 1, B = 2, C = 3;

    private static TaskTypeAccessImpactReader.Person Person(bool admin = false, params int[] roles) => new(1, roles.ToHashSet(), admin, true);

    private static TaskTypeAccessSets Sets(int[] view, int[]? edit = null, int[]? assign = null) => new(view, edit ?? [], assign ?? []);

    [Fact]
    public void A_type_with_no_View_role_is_open_to_everyone_whatever_roles_a_person_holds()
    {
        TaskTypeAccessImpactReader.CanView(Person(false), Sets([])).ShouldBeTrue();
        TaskTypeAccessImpactReader.CanEdit(Person(false), Sets([])).ShouldBeTrue();
    }

    [Fact]
    public void A_restricted_type_is_visible_to_a_person_with_any_of_its_View_roles_and_to_nobody_else()
    {
        var sets = Sets([A, B]);

        TaskTypeAccessImpactReader.CanView(Person(false, B), sets).ShouldBeTrue();
        TaskTypeAccessImpactReader.CanView(Person(false, C), sets).ShouldBeFalse();
        TaskTypeAccessImpactReader.CanView(Person(false), sets).ShouldBeFalse();
        TaskTypeAccessImpactReader.CanView(Person(false, C, A), sets).ShouldBeTrue("roles add up");
    }

    [Fact]
    public void System_Admin_sees_and_edits_everything()
    {
        var sets = Sets([A], [A]);

        TaskTypeAccessImpactReader.CanView(Person(true), sets).ShouldBeTrue();
        TaskTypeAccessImpactReader.CanEdit(Person(true), sets).ShouldBeTrue();
    }

    [Fact]
    public void An_empty_Edit_list_lets_every_viewer_edit_and_a_filled_one_limits_editing_to_its_roles()
    {
        TaskTypeAccessImpactReader.CanEdit(Person(false, B), Sets([A, B])).ShouldBeTrue();

        var onlyA = Sets([A, B], [A]);
        TaskTypeAccessImpactReader.CanEdit(Person(false, A), onlyA).ShouldBeTrue();
        TaskTypeAccessImpactReader.CanEdit(Person(false, B), onlyA).ShouldBeFalse("B may see but not change");
        TaskTypeAccessImpactReader.CanEdit(Person(false, C), onlyA).ShouldBeFalse("editing needs viewing first");
    }
}
