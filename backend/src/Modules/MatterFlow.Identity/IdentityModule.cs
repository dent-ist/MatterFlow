using MatterFlow.Identity.Access;
using MatterFlow.Identity.Authentication;
using MatterFlow.Identity.Authorization;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.DirectoryLookup;
using MatterFlow.Identity.Seeding;
using MatterFlow.SharedKernel.Identity;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Negotiate;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace MatterFlow.Identity;

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

        services.AddScoped<CurrentUser>();
        services.Replace(ServiceDescriptor.Scoped<ICurrentUser>(sp => sp.GetRequiredService<CurrentUser>()));
        services.AddScoped<IPermissionChecker>(sp => sp.GetRequiredService<CurrentUser>());

        services.AddScoped<IAuthorizationHandler, AccessAuthorizationHandler>();
        services.AddSingleton<IAuthorizationPolicyProvider, PermissionPolicyProvider>();
        services.AddAuthorizationBuilder()
            .AddPolicy(AccessPolicies.Authenticated, p => p.RequireAuthenticatedUser().AddRequirements(new ActiveUserRequirement()))
            // Fail closed: a controller action without an explicit policy needs an active, non-pending user (see FailClosedConvention).
            .AddPolicy(AccessPolicies.NonPending, p => p.RequireAuthenticatedUser().AddRequirements(new NonPendingRequirement()));
        services.Configure<MvcOptions>(o => o.Conventions.Add(new FailClosedConvention()));

        return services;
    }
}
