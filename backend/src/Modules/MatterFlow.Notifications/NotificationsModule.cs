using MatterFlow.Notifications.Application;
using MatterFlow.Notifications.Contracts;
using MatterFlow.Notifications.Infrastructure.Scheduling;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace MatterFlow.Notifications;

/// <summary>Composition entry point of the Notifications module.</summary>
public static class NotificationsModule
{
    /// <summary>Registers the Notifications module's services and exposes its controllers via an application part.</summary>
    public static IServiceCollection AddNotificationsModule(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddControllers().AddApplicationPart(typeof(NotificationsModule).Assembly);

        services.AddScoped<INotificationPublisher, NotificationPublisher>();
        services.AddScoped<NotificationVisibility>();
        services.AddScoped<NotificationService>();
        services.AddScoped<NotificationPreferenceService>();

        // The scheduler (issue #741): a timer, the jobs, and a degraded-not-failed health entry on /health/live.
        services.Configure<NotificationSchedulerOptions>(configuration.GetSection(NotificationSchedulerOptions.SectionName));
        services.AddSingleton<NotificationSchedulerState>();
        services.AddScoped<ScheduledNotificationWriter>();
        services.AddScoped<INotificationJob, TaskDueJob>();
        services.AddScoped<INotificationJob, TaskStalledJob>();
        services.AddScoped<INotificationJob, NotificationRetentionJob>();
        services.AddScoped<NotificationScheduler>();
        services.AddHostedService<NotificationSchedulerService>();
        services.AddHealthChecks().AddCheck<NotificationSchedulerHealthCheck>("notification-scheduler", HealthStatus.Degraded, tags: ["scheduler"]);
        return services;
    }
}
