using MatterFlow.SharedKernel.Audit;
using MatterFlow.SharedKernel.Entities;

namespace MatterFlow.Organization.Domain;

/// <summary>
/// A calendar item of a matter (UI update epic #953, UI-05): a hearing, a deposition, a filing deadline. <see cref="EventDate"/> is a floating calendar date and
/// <see cref="EventTime"/> an optional wall-clock time (null = all day); neither carries a time zone. The type is one of the eight fixed codes of
/// <c>MatterEventTypes</c>. Created and changed by the matter's managers and holders of <c>Matter.Edit</c>; seen by everyone who sees the matter.
/// </summary>
[Audited]
public class MatterEvent : AuditedEntity<int>, IAuditScoped
{
    public int MatterId { get; set; }

    public string EventTypeCode { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    public DateOnly EventDate { get; set; }

    public TimeOnly? EventTime { get; set; }

    public string? Note { get; set; }

    int? IAuditScoped.AuditMatterId => MatterId;

    long? IAuditScoped.AuditTaskId => null;
}
