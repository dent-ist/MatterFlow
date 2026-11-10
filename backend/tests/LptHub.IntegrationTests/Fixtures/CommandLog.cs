using Microsoft.Extensions.Logging;

namespace MatterFlow.IntegrationTests.Fixtures;

/// <summary>
/// Captures the text of every SQL command EF Core executes (add as a logger provider and enable the
/// <c>Microsoft.EntityFrameworkCore.Database.Command</c> category at Information). Each entry keeps the header line, which carries the command
/// timeout (<c>CommandTimeout='15'</c>), followed by the statement.
/// </summary>
public sealed class CommandLog : ILoggerProvider
{
    private readonly object _gate = new();
    private readonly List<string> _statements = [];

    public ILogger CreateLogger(string categoryName) => categoryName == "Microsoft.EntityFrameworkCore.Database.Command" ? new Capture(this) : new Silent();

    public void Clear()
    {
        lock (_gate)
            _statements.Clear();
    }

    public List<string> Snapshot()
    {
        lock (_gate)
            return [.. _statements];
    }

    public void Dispose()
    {
    }

    private void Add(string message)
    {
        lock (_gate)
            _statements.Add(message);
    }

    private sealed class Capture(CommandLog owner) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel == LogLevel.Information;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            var message = formatter(state, exception);
            if (message.StartsWith("Executed DbCommand", StringComparison.Ordinal))
                owner.Add(message);
        }
    }

    private sealed class Silent : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => false;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
        }
    }
}
