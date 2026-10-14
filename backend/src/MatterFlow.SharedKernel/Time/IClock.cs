namespace MatterFlow.SharedKernel.Time;

/// <summary>Source of the current instant. Inject instead of reading <c>DateTime.UtcNow</c> so time is testable.</summary>
public interface IClock
{
    DateTime UtcNow { get; }
}

public sealed class SystemClock : IClock
{
    public DateTime UtcNow => DateTime.UtcNow;
}
