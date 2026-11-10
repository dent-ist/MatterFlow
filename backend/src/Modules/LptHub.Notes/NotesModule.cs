using MatterFlow.Notes.Application;
using Microsoft.Extensions.DependencyInjection;

namespace MatterFlow.Notes;

/// <summary>Composition entry point of the Notes module (matter notes, their tags, references, lock and templates).</summary>
public static class NotesModule
{
    /// <summary>Registers the Notes module's services and exposes its controllers via an application part.</summary>
    public static IServiceCollection AddNotesModule(this IServiceCollection services)
    {
        services.AddControllers().AddApplicationPart(typeof(NotesModule).Assembly);

        services.AddScoped<NoteAccess>();
        services.AddScoped<NoteService>();
        services.AddScoped<NoteTagService>();
        services.AddScoped<NoteTemplateService>();
        services.AddScoped<MatterFlow.Notes.Contracts.INoteLabels, NoteLabels>();
        return services;
    }
}
