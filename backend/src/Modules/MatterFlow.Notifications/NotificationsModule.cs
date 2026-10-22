using MatterFlow.Notifications.Application;
using MatterFlow.Notifications.Contracts;
using Microsoft.Extensions.DependencyInjection;

namespace MatterFlow.Notifications;

/// <summary>Composition entry point of the Notifications module.</summary>
public static class NotificationsModule
{
    /// <summary>Registers the Notifications module's services and exposes its controllers via an application part.</summary>
    public static IServiceCollection AddNotificationsModule(this IServiceCollection services)
    {
        services.AddControllers().AddApplicationPart(typeof(NotificationsModule).Assembly);

        services.AddScoped<INotificationPublisher, NotificationPublisher>();
        services.AddScoped<NotificationVisibility>();
        services.AddScoped<NotificationService>();
        services.AddScoped<NotificationPreferenceService>();
        return services;
    }
}
