using LptHub.Identity.Access;
using LptHub.Identity.Authentication;
using LptHub.Identity.Authorization;
using LptHub.Identity.Contracts;
using LptHub.Identity.DirectoryLookup;
using LptHub.Identity.Pods;
using LptHub.Identity.Seeding;
using LptHub.SharedKernel.Identity;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Negotiate;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace LptHub.Identity;

/// <summary>Composition entry point of the Identity module.</summary>
public static class IdentityModule
{
    /// <summary>
    /// Registers authentication (Windows/Negotiate in production, Dev elsewhere), the AppUser resolver with its per-user permission cache,
    /// permission-based authorization (policies resolved from <c>Perm:&lt;code&gt;</c> names, fail-closed default for unannotated actions), the Identity startup seed,
    /// and exposes its controllers via an application part.
    /// </summary>
    public static IServiceCollection AddIdentityModule(this IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        services.AddControllers().AddApplicationPart(typeof(IdentityModule).Assembly);

        var provider = AuthProviderSelection.Resolve(configuration, environment);
        var authentication = services.AddAuthentication(provider == AuthProvider.Dev ? DevAuthOptions.SchemeName : NegotiateDefaults.AuthenticationScheme);
        if (provider == AuthProvider.Dev)
        {
            authentication.AddScheme<DevSchemeOptions, DevAuthenticationHandler>(DevAuthOptions.SchemeName, _ => { });
            services.Configure<DevAuthOptions>(configuration.GetSection("Auth:Dev"));
            if (!environment.IsDevelopment())
                services.PostConfigure<DevAuthOptions>(o => o.QueryName = string.Empty); // header only in the Test environment
        }
        else
        {
            authentication.AddNegotiate();
        }

        services.Configure<BootstrapOptions>(configuration.GetSection("Bootstrap"));
        services.Configure<ActiveDirectoryOptions>(configuration.GetSection("ActiveDirectory"));
        services.Configure<AccessCacheOptions>(configuration.GetSection("Authorization"));

        services.AddSingleton<UserAccessCache>();
        services.AddSingleton<IUserAccessInvalidator>(sp => sp.GetRequiredService<UserAccessCache>());
        services.AddSingleton<IDirectoryProfileProvider, ActiveDirectoryProfileProvider>();
        services.AddScoped<IUserResolver, UserResolver>();
        services.AddScoped<IdentitySeeder>();
        services.AddScoped<PodService>();
        services.AddScoped<People.PersonService>();
        services.AddScoped<IPodDirectory, PodDirectory>();
        services.AddScoped<IUserDirectory, Application.UserDirectory>();
        services.AddScoped<Application.MatterManagerEligibility>();
        services.AddScoped<IMatterManagerEligibility>(sp => sp.GetRequiredService<Application.MatterManagerEligibility>());
        services.TryAddScoped<LptHub.SharedKernel.Tasks.IUserTaskCounts, LptHub.SharedKernel.Tasks.NoTasksUserTaskCounts>();
        services.TryAddScoped<LptHub.SharedKernel.Tasks.IAssigneeLoadReader, LptHub.SharedKernel.Tasks.NoTasksAssigneeLoadReader>();
        services.TryAddScoped<LptHub.SharedKernel.Tasks.IAssigneeExperienceReader, LptHub.SharedKernel.Tasks.NoTasksAssigneeExperienceReader>();
        // The one assignee ranking every picker uses (#757); a smarter rule replaces this registration only.
        services.AddSingleton<IAssigneeRanker, Application.LoadBalancedAssigneeRanker>();
        services.AddScoped<Application.UserAdministration>();
        services.AddScoped<Holidays.HolidayLoader>();
        services.AddScoped<Holidays.HolidayCalendarService>();
        services.AddScoped<Application.CalendarAccess>();
        services.AddScoped<ICalendarAccess>(sp => sp.GetRequiredService<Application.CalendarAccess>());
        services.AddScoped<Application.AbsenceService>();
        services.AddScoped<Application.UserAvailabilityService>();
        services.AddScoped<IUserAvailabilityReader>(sp => sp.GetRequiredService<Application.UserAvailabilityService>());
        services.AddScoped<Application.RoleAdministration>();
        services.AddScoped<Views.UserViewService>();
        services.AddScoped<LandingPages.LandingPageService>();

        services.Configure<LptHub.SharedKernel.Visibility.SensitiveMatterAccessOptions>(configuration.GetSection(LptHub.SharedKernel.Visibility.SensitiveMatterAccessOptions.Section));
        services.AddScoped<MatterVisibility>();
        services.AddScoped<LptHub.SharedKernel.Visibility.IMatterVisibility>(sp => sp.GetRequiredService<MatterVisibility>());
        services.AddScoped<LptHub.SharedKernel.Visibility.IManagedMatterScope, ManagedMatterScope>();

        services.AddScoped<CurrentUser>();
        services.Replace(ServiceDescriptor.Scoped<ICurrentUser>(sp => sp.GetRequiredService<CurrentUser>()));
        services.AddScoped<IPermissionChecker>(sp => sp.GetRequiredService<CurrentUser>());

        services.AddScoped<IAuthorizationHandler, AccessAuthorizationHandler>();
        services.AddSingleton<IAuthorizationPolicyProvider, PermissionPolicyProvider>();
        services.AddAuthorizationBuilder()
            .AddPolicy(AccessPolicies.Authenticated, p => p.RequireAuthenticatedUser().AddRequirements(new ActiveUserRequirement()))
            // Fail closed: a controller action without an explicit policy needs an active, non-pending user (see FailClosedConvention).
            .AddPolicy(AccessPolicies.NonPending, p => p.RequireAuthenticatedUser().AddRequirements(new NonPendingRequirement()));
        services.Configure<MvcOptions>(o =>
        {
            o.Conventions.Add(new FailClosedConvention());
            o.Filters.Add<ViewerPreparationFilter>();
        });

        return services;
    }
}
