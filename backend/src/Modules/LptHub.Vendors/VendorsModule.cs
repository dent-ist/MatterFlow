using LptHub.Vendors.Application;
using LptHub.Vendors.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LptHub.Vendors;

/// <summary>Composition entry point of the Vendors module (vendors, their contacts, the Services and Areas lists and the vendor-to-matter links).</summary>
public static class VendorsModule
{
    /// <summary>Registers the Vendors module's services and exposes its controllers via an application part.</summary>
    public static IServiceCollection AddVendorsModule(this IServiceCollection services)
    {
        services.AddControllers().AddApplicationPart(typeof(VendorsModule).Assembly);

        services.AddScoped<VendorAccess>();
        services.AddScoped<VendorService>();
        services.AddScoped<VendorContactService>();
        services.AddScoped<VendorMatterService>();
        services.AddScoped(sp =>
        {
            var db = sp.GetRequiredService<DbContext>();
            return new VendorOptionService<VendorServiceOption>(db, "A service named", async ct =>
                (IReadOnlyDictionary<int, int>)await db.Set<VendorServiceChoice>().AsNoTracking()
                    .GroupBy(c => c.VendorServiceOptionId).Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count, ct));
        });
        services.AddScoped(sp =>
        {
            var db = sp.GetRequiredService<DbContext>();
            return new VendorOptionService<VendorAreaOption>(db, "An area named", async ct =>
                (IReadOnlyDictionary<int, int>)await db.Set<VendorAreaChoice>().AsNoTracking()
                    .GroupBy(c => c.VendorAreaOptionId).Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count, ct));
        });
        return services;
    }
}
