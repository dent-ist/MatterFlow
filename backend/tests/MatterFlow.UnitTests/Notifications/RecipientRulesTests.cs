using MatterFlow.Notifications.Contracts;
using MatterFlow.Notifications.Domain;
using Shouldly;

namespace MatterFlow.UnitTests.Notifications;

/// <summary>The central recipient rules (README section 3): actor never, one per person per action by priority, switches honoured.</summary>
public class RecipientRulesTests
{
    private static NotificationRequest Request(NotificationEventType type, int? actor, params int[] recipients) =>
        new(type, NotificationObjectKinds.Task, 7, 1, actor, "m", "k", recipients);

    private static readonly Func<int, NotificationEventType, bool> NoneOff = (_, _) => false;

    [Fact]
    public void The_actor_is_never_notified()
    {
        var plan = RecipientRules.Plan([Request(NotificationEventType.TaskAssigned, actor: 5, 5, 6)], NoneOff);

        plan.Select(p => p.RecipientUserId).ShouldBe([6]);
    }

    [Fact]
    public void A_person_hit_by_two_rules_gets_only_the_higher_priority_event()
    {
        // A manager (2) who is also the assignee gets "assigned to you" and not "new task on your matter".
        var plan = RecipientRules.Plan(
            [
                Request(NotificationEventType.MatterTaskCreated, 1, 2, 3),
                Request(NotificationEventType.TaskAssigned, 1, 2),
            ],
            NoneOff);

        plan.Count.ShouldBe(2);
        plan.Single(p => p.RecipientUserId == 2).Request.EventType.ShouldBe(NotificationEventType.TaskAssigned);
        plan.Single(p => p.RecipientUserId == 3).Request.EventType.ShouldBe(NotificationEventType.MatterTaskCreated);
    }

    [Fact]
    public void A_duplicate_recipient_in_one_request_collapses()
    {
        RecipientRules.Plan([Request(NotificationEventType.PodTaskUnassigned, 1, 4, 4, 4)], NoneOff).Count.ShouldBe(1);
    }

    [Fact]
    public void A_switched_off_type_creates_nothing_and_the_next_best_event_still_arrives()
    {
        bool Off(int user, NotificationEventType type) => user == 2 && type == NotificationEventType.TaskAssigned;
        var plan = RecipientRules.Plan(
            [
                Request(NotificationEventType.TaskAssigned, 1, 2),
                Request(NotificationEventType.MatterTaskCreated, 1, 2),
            ],
            Off);

        plan.Single().Request.EventType.ShouldBe(NotificationEventType.MatterTaskCreated);
        RecipientRules.Plan([Request(NotificationEventType.TaskAssigned, 1, 2)], Off).ShouldBeEmpty();
    }

    [Fact]
    public void A_mention_follows_the_comment_switch()
    {
        bool Off(int user, NotificationEventType type) => type == NotificationEventType.TaskComment;

        RecipientRules.Plan([Request(NotificationEventType.TaskMention, 1, 2)], Off).ShouldBeEmpty();
        NotificationEventType.TaskMention.PreferenceType().ShouldBe(NotificationEventType.TaskComment);
    }

    [Fact]
    public void Codes_round_trip_and_priorities_follow_the_readme_table()
    {
        foreach (var type in NotificationEventTypes.Switchable)
        {
            NotificationEventTypes.TryParse(type.Code(), out var parsed).ShouldBeTrue();
            parsed.ShouldBe(type);
        }

        NotificationEventTypes.TryParse("3", out _).ShouldBeFalse();
        NotificationEventTypes.TryParse("Nope", out _).ShouldBeFalse();
        NotificationEventTypes.TryParse(null, out _).ShouldBeFalse();
        NotificationEventTypes.Switchable.Count.ShouldBe(8);
        NotificationEventType.TaskAssigned.Priority().ShouldBeLessThan(NotificationEventType.MatterTaskCreated.Priority());
        NotificationEventType.TaskMention.Priority().ShouldBe(NotificationEventType.TaskComment.Priority());
    }
}
