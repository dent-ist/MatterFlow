using MatterFlow.Assets.Domain;
using Shouldly;

namespace MatterFlow.UnitTests.Assets;

/// <summary>The disposition transition matrix (epic #851, issue #865) and the size units.</summary>
public class AssetDispositionRulesTests
{
    private static readonly string[] All = AssetDisposition.All.ToArray();

    private static AssetDispositionRules.Refusal? Check(string from, string to, bool edit = true, bool dispose = true, string? note = "because") =>
        AssetDispositionRules.Check(from, to, edit, dispose, note);

    [Fact]
    public void Any_of_active_inactive_and_pending_can_move_to_any_other_state_with_the_right_permissions_and_a_note_for_disposed()
    {
        foreach (var from in new[] { AssetDisposition.Active, AssetDisposition.Inactive, AssetDisposition.PendingDisposition })
        {
            foreach (var to in All)
                Check(from, to).ShouldBeNull($"{from} -> {to}");
        }
    }

    [Fact]
    public void Disposed_needs_a_note_and_a_pending_disposition_does_not()
    {
        Check(AssetDisposition.Active, AssetDisposition.Disposed, note: null)!.Code.ShouldBe(AssetDispositionRules.NoteRequiredCode);
        Check(AssetDisposition.Active, AssetDisposition.Disposed, note: "   ")!.Code.ShouldBe(AssetDispositionRules.NoteRequiredCode);
        Check(AssetDisposition.Active, AssetDisposition.PendingDisposition, note: null).ShouldBeNull();
        Check(AssetDisposition.Active, AssetDisposition.Inactive, note: null).ShouldBeNull();
    }

    [Fact]
    public void Pending_and_disposed_need_Asset_Dispose_while_active_and_inactive_need_Asset_Edit()
    {
        foreach (var to in new[] { AssetDisposition.PendingDisposition, AssetDisposition.Disposed })
        {
            var refusal = Check(AssetDisposition.Active, to, edit: true, dispose: false)!;
            refusal.Forbidden.ShouldBeTrue(to);
            Check(AssetDisposition.Active, to, edit: false, dispose: true).ShouldBeNull(to);
        }

        foreach (var to in new[] { AssetDisposition.Active, AssetDisposition.Inactive })
        {
            Check(AssetDisposition.PendingDisposition, to, edit: false, dispose: true)!.Forbidden.ShouldBeTrue(to);
            Check(AssetDisposition.PendingDisposition, to, edit: true, dispose: false).ShouldBeNull(to);
        }
    }

    [Fact]
    public void Disposed_is_final_except_for_a_correction_back_to_inactive_by_a_disposer_with_a_note()
    {
        foreach (var to in new[] { AssetDisposition.Active, AssetDisposition.PendingDisposition })
        {
            var refusal = Check(AssetDisposition.Disposed, to)!;
            refusal.Code.ShouldBe(AssetDispositionRules.DisposedIsFinalCode);
            refusal.Conflict.ShouldBeTrue();
        }

        Check(AssetDisposition.Disposed, AssetDisposition.Inactive).ShouldBeNull();
        Check(AssetDisposition.Disposed, AssetDisposition.Inactive, note: null)!.Code.ShouldBe(AssetDispositionRules.NoteRequiredCode);
        Check(AssetDisposition.Disposed, AssetDisposition.Inactive, edit: true, dispose: false)!.Forbidden.ShouldBeTrue();
    }

    [Fact]
    public void Staying_in_the_same_state_is_allowed_and_an_unknown_code_or_a_long_note_is_not()
    {
        foreach (var state in All)
            Check(state, state, edit: false, dispose: false, note: null).ShouldBeNull(state);

        Check(AssetDisposition.Active, "GONE")!.Code.ShouldBe(AssetDispositionRules.InvalidCode);
        Check(AssetDisposition.Active, AssetDisposition.Inactive, note: new string('x', AssetDispositionRules.MaxNoteLength + 1))!.Code.ShouldBe("TOO_LONG");
    }

    [Fact]
    public void SetDisposition_keeps_IsActive_equal_to_Active()
    {
        var asset = new Asset();
        asset.IsActive.ShouldBeTrue();
        foreach (var code in All)
        {
            asset.SetDisposition(code, DateTime.UtcNow, 1, "n");
            asset.IsActive.ShouldBe(code == AssetDisposition.Active, code);
            asset.DispositionCode.ShouldBe(code);
        }
    }

    [Fact]
    public void Sizes_convert_within_the_size_family_and_items_never_become_bytes()
    {
        AssetSize.ToBytes(1m, "KB").ShouldBe(1024L);
        AssetSize.ToBytes(1.5m, "GB").ShouldBe(1610612736L);
        AssetSize.ToBytes(2m, "TB").ShouldBe(2L * 1024 * 1024 * 1024 * 1024);
        AssetSize.ToBytes(7m, "B").ShouldBe(7L);
        AssetSize.ToBytes(40m, "Items").ShouldBeNull();
        AssetSize.ToBytes(1m, "furlongs").ShouldBeNull();
        AssetSize.ToBytes(decimal.MaxValue, "TB").ShouldBeNull();
        AssetSize.IsByteUnit("GB").ShouldBeTrue();
        AssetSize.IsByteUnit("Items").ShouldBeFalse();
        AssetSize.IsKnownUnit("Items").ShouldBeTrue();
        AssetSize.IsKnownUnit("gb").ShouldBeFalse();
    }
}
