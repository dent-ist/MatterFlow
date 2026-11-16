using System.Net;
using System.Text;
using LptHub.Integrations.Application;
using LptHub.SharedKernel.Time;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace LptHub.UnitTests.Integrations;

internal sealed class TestClock(DateTime start) : IClock
{
    public DateTime UtcNow { get; set; } = start;
}

/// <summary>A scripted HTTP handler: records every request (with its body) and answers with the next scripted response, or throws.</summary>
internal sealed class ScriptedHandler : HttpMessageHandler
{
    private readonly Queue<Func<HttpRequestMessage, HttpResponseMessage>> _script = new();

    public List<(Uri Uri, string Body, string? Authorization)> Requests { get; } = [];

    public ScriptedHandler Then(HttpStatusCode status, string body = "{}")
    {
        _script.Enqueue(_ => new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        return this;
    }

    public ScriptedHandler ThenThrow(Exception ex)
    {
        _script.Enqueue(_ => throw ex);
        return this;
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken);
        Requests.Add((request.RequestUri!, body, request.Headers.Authorization?.ToString()));
        return _script.Count == 0 ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{}") } : _script.Dequeue()(request);
    }
}

internal sealed class HandlerFactory(HttpMessageHandler handler) : IHttpClientFactory
{
    public HttpClient CreateClient(string name) => new(handler, disposeHandler: false) { Timeout = TimeSpan.FromSeconds(5) };
}

/// <summary>Collects every formatted log line, so a test can prove that no secret or token reached a log.</summary>
internal sealed class CapturingLogger<T> : ILogger<T>
{
    public List<string> Lines { get; } = [];

    public IDisposable? BeginScope<TState>(TState state)
        where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
        Lines.Add(formatter(state, exception) + (exception is null ? string.Empty : " " + exception));
}

internal static class TestOptions
{
    public static IOptions<IntegrationsOptions> Default(Action<IntegrationsOptions>? change = null)
    {
        var o = new IntegrationsOptions();
        change?.Invoke(o);
        return Options.Create(o);
    }
}
