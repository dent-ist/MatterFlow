using MatterFlow.SharedKernel.ValueObjects;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace MatterFlow.Data;

/// <summary>Stores a <see cref="BusinessNumber"/> as its normalized 5-character string (<c>char(5)</c>).</summary>
public sealed class BusinessNumberConverter()
    : ValueConverter<BusinessNumber, string>(v => v.Value, v => BusinessNumber.FromStored(v));
