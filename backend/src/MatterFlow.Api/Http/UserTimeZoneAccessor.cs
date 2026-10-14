using MatterFlow.SharedKernel.Time;

namespace MatterFlow.Api.Http;

/// <summary>Request-scoped resolution of <see cref="IUserTimeZone"/> from the <c>X-Time-Zone</c> header (addendum M).</summary>
public static class UserTimeZoneAccessor
{
    public const string HeaderName = "X-Time-Zone";
    public const string FirmZoneConfigKey = "Firm:TimeZoneId";

    public static IServiceCollection AddUserTimeZone(this IServiceCollection services)
    {
        services.AddHttpContextAccessor();
        services.AddScoped<IUserTimeZone>(sp =>
        {
            var header = sp.GetRequiredService<IHttpContextAccessor>().HttpContext?.Request.Headers[HeaderName].FirstOrDefault();
            var firmZone = sp.GetRequiredService<IConfiguration>()[FirmZoneConfigKey];
            return UserTimeZone.Resolve(header, firmZone ?? UserTimeZone.DefaultFirmZoneId);
        });
        return services;
    }
}
