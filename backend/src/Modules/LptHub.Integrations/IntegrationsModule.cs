using LptHub.Integrations.Application;
using LptHub.Integrations.Contracts;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace LptHub.Integrations;

/// <summary>
/// Composition entry point of the Integrations module (epic #1389, issue #1395): the ONE Microsoft Entra ID connection and the integrations that use it (Matter Lookup, Ethical Wall, Other), their tokens
/// (<see cref="IIntegrationTokenProvider"/>), Test Connection, and the Matter Lookup call behind the Lookup button. The client secret is encrypted with ASP.NET Core Data Protection; the key ring lives in
/// <c>DataProtection:KeysPath</c>, never in the database.
/// </summary>
public static class IntegrationsModule
{
    /// <summary>The configuration key of the folder that holds the Data Protection key ring.</summary>
    public const string KeysPathKey = "DataProtection:KeysPath";

    public static IServiceCollection AddIntegrationsModule(this IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        services.AddControllers().AddApplicationPart(typeof(IntegrationsModule).Assembly);
        services.Configure<IntegrationsOptions>(configuration.GetSection(IntegrationsOptions.SectionName));
        var options = configuration.GetSection(IntegrationsOptions.SectionName).Get<IntegrationsOptions>() ?? new IntegrationsOptions();

        AddKeyStore(services, configuration, environment);

        var local = environment.IsDevelopment() || environment.IsEnvironment("Test");
        var simulate = options.Simulator.Enabled && local;
        var entra = services.AddHttpClient(EntraTokenClient.ClientName, c => c.Timeout = TimeSpan.FromSeconds(Math.Clamp(options.TokenTimeoutSeconds, 1, 120)));
        var api = services.AddHttpClient(IntegrationTester.ApiClientName, c => c.Timeout = TimeSpan.FromSeconds(Math.Clamp(options.ApiTimeoutSeconds, 1, 120)));
        if (simulate)
        {
            entra.ConfigurePrimaryHttpMessageHandler(sp => new SimulatedEndpointsHandler(sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<IntegrationsOptions>>()));
            api.ConfigurePrimaryHttpMessageHandler(sp => new SimulatedEndpointsHandler(sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<IntegrationsOptions>>()));
        }
        else
        {
            // An integration address never redirects the call (and its token) somewhere else.
            api.ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false, ConnectTimeout = TimeSpan.FromSeconds(5) });
        }

        services.AddSingleton<TokenCache>();
        services.AddScoped<ISecretProtector, DataProtectionSecretProtector>();
        services.AddScoped<ConnectionAccess>();
        services.AddScoped<EntraTokenClient>();
        services.AddScoped<IntegrationTokenProvider>();
        services.AddScoped<IIntegrationTokenProvider>(sp => sp.GetRequiredService<IntegrationTokenProvider>());
        services.AddScoped<IIntegrationRegistry, IntegrationRegistry>();
        services.AddScoped<IntegrationTester>();
        services.AddScoped<EntraConnectionService>();
        services.AddScoped<IntegrationService>();
        services.AddScoped<IMatterLookupClient, ProvisionalMatterLookupClient>();
        services.AddScoped<MatterLookupService>();
        return services;
    }

    /// <summary>
    /// Data Protection key ring. With <c>DataProtection:KeysPath</c> the keys are files in that folder (on Windows also encrypted with the machine's DPAPI unless <c>DataProtection:ProtectWithDpapi</c> is false); the
    /// application name is fixed so a renamed site keeps reading its keys. Development and Test fall back to the framework default (the secret can be stored); any other environment without a path
    /// cannot store a secret (the page says so) rather than encrypt with a key that disappears on restart.
    /// </summary>
    private static void AddKeyStore(IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        var builder = services.AddDataProtection().SetApplicationName("LptHub");
        var path = configuration[KeysPathKey];
        var durable = !string.IsNullOrWhiteSpace(path);
        if (durable)
        {
            builder.PersistKeysToFileSystem(new DirectoryInfo(path!));
            if (OperatingSystem.IsWindows() && configuration.GetValue("DataProtection:ProtectWithDpapi", true))
                builder.ProtectKeysWithDpapi(protectToLocalMachine: true);
        }

        services.AddSingleton(new KeyStoreStatus(durable || environment.IsDevelopment() || environment.IsEnvironment("Test")));
    }
}
