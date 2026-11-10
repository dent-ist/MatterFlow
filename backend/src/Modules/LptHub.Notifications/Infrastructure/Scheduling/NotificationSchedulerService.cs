using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace MatterFlow.Notifications.Infrastructure.Scheduling;

/// <summary>
/// The timer of the notification scheduler (issue #741): a <see cref="BackgroundService"/> that calls <see cref="NotificationScheduler.RunOnceAsync"/>
/// every five minutes in a fresh scope. It starts with the host, which only starts listening after the schema migration and the startup seeds
/// have finished, so it never runs against an old schema. A failed run is logged and the next tick tries again. On IIS the application pool must
/// stay running (see docs/runbook.md, "Notification scheduler").
/// </summary>
public sealed class NotificationSchedulerService(
    IServiceScopeFactory scopes,
    IOptions<NotificationSchedulerOptions> options,
    IConfiguration configuration,
    IClock clock,
    NotificationSchedulerState state,
    ILogger<NotificationSchedulerService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var settings = options.Value;
        if (!settings.Enabled)
        {
            logger.LogInformation("Notification scheduler is disabled (Notifications:Scheduler:Enabled=false).");
            return;
        }

        if (string.IsNullOrWhiteSpace(configuration.GetConnectionString("MatterFlow")) && string.IsNullOrWhiteSpace(configuration.GetConnectionString("Default")))
        {
            logger.LogInformation("Notification scheduler: no database configured, not starting.");
            return;
        }

        state.Started(clock.UtcNow);
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(Math.Max(0, settings.InitialDelaySeconds)), stoppingToken);
            using var timer = new PeriodicTimer(TimeSpan.FromMinutes(Math.Max(1, settings.IntervalMinutes)));
            do
            {
                await RunTickAsync(stoppingToken);
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // host is stopping
        }
    }

    private async Task RunTickAsync(CancellationToken stoppingToken)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<NotificationScheduler>().RunOnceAsync(stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            state.Failed(clock.UtcNow, "run");
            logger.LogError(ex, "Notification scheduler run failed; trying again at the next tick.");
        }
    }
}

/// <summary>
/// Health of the scheduler: Healthy while runs complete, Degraded (never Unhealthy, the app still serves people) when no run has completed for
/// 30 minutes. Listed on <c>/health/live</c>; <c>/health/ready</c> is unchanged. Disabled is reported as Healthy.
/// </summary>
public sealed class NotificationSchedulerHealthCheck(NotificationSchedulerState state, IOptions<NotificationSchedulerOptions> options, IClock clock) : IHealthCheck
{
    public Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        var settings = options.Value;
        if (!settings.Enabled)
            return Task.FromResult(HealthCheckResult.Healthy("Notification scheduler is disabled."));

        var since = state.LastSuccessUtc ?? state.StartedUtc;
        if (since is null)
            return Task.FromResult(HealthCheckResult.Healthy("Notification scheduler has not started yet."));

        var age = clock.UtcNow - since.Value;
        return Task.FromResult(age > TimeSpan.FromMinutes(settings.DegradedAfterMinutes)
            ? HealthCheckResult.Degraded($"Notification scheduler: no completed run for {(int)age.TotalMinutes} minutes.")
            : HealthCheckResult.Healthy("Notification scheduler is running."));
    }
}
