using System.Data;
using MatterFlow.Reports.Domain.Parameters;
using Microsoft.Data.SqlClient;

namespace MatterFlow.Reports.Infrastructure;

/// <summary>Creates the typed <c>SqlParameter</c> for a bound value: explicit type, size, precision and scale; never <c>AddWithValue</c>.</summary>
internal static class SqlParameterFactory
{
    public static SqlParameter Create(BoundParameter p)
    {
        var parameter = new SqlParameter("@p_" + p.Name, p.DbType);
        switch (p.DbType)
        {
            case SqlDbType.NVarChar:
                parameter.Size = p.Size; // -1 = nvarchar(max) (the JSON array of a list)
                break;
            case SqlDbType.Decimal:
                parameter.Precision = p.Precision;
                parameter.Scale = p.Scale;
                break;
            case SqlDbType.DateTime2:
                parameter.Scale = p.Scale;
                break;
        }

        parameter.Value = p.Value ?? DBNull.Value;
        return parameter;
    }
}
