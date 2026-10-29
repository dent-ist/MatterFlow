using System.Data.Common;
using MatterFlow.SharedKernel.Data;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace MatterFlow.Data;

/// <summary>
/// Adds <c>OPTION (USE HINT ('DISABLE_PARAMETER_SNIFFING'))</c> to a SELECT that carries <see cref="QueryPlanTags.StablePlan"/> (issue #938), so its plan is made for the average
/// caller instead of the first one after a restart. Only commands that carry the tag are touched.
/// </summary>
public sealed class StablePlanInterceptor : DbCommandInterceptor
{
    private const string Hint = "\nOPTION (USE HINT ('DISABLE_PARAMETER_SNIFFING'))";

    public override InterceptionResult<DbDataReader> ReaderExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
    {
        Apply(command);
        return base.ReaderExecuting(command, eventData, result);
    }

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
    {
        Apply(command);
        return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
    }

    internal static void Apply(DbCommand command)
    {
        var text = command.CommandText;
        if (!text.StartsWith("-- " + QueryPlanTags.StablePlan, StringComparison.Ordinal) || text.Contains("OPTION (", StringComparison.OrdinalIgnoreCase))
            return;

        command.CommandText = text.TrimEnd().TrimEnd(';') + Hint;
    }
}
