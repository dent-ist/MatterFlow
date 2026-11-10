using System.Data;
using MatterFlow.Assets.Domain;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace MatterFlow.Assets.Application;

/// <summary>The number taken for a new asset: the text to store and the counter value it was built from.</summary>
/// <param name="Number">The text, for example <c>90003-80008_001</c>.</param>
/// <param name="Sequence">The counter value, 1 for the first asset of the matter.</param>
public sealed record AssignedAssetNumber(string Number, int Sequence);

/// <summary>
/// Takes the next automatic Asset Number of an asset type for a matter (issue #1297). The counter row of (asset type, matter) is read and advanced by ONE statement
/// (<c>UPDATE ... WITH (UPDLOCK, ROWLOCK) ... OUTPUT deleted.NextNumber</c>) inside the transaction of the asset insert: the row lock is held until that transaction ends, so concurrent
/// creates for the same (type, matter) queue on the row and each gets its own number, and a create that rolls back gives its number back with the rolled-back counter (no gap, no duplicate).
/// The first use of a pair inserts the row under a key-range lock (<c>UPDLOCK, HOLDLOCK</c>), so two first users cannot both insert it. All values are parameters; nothing from the pattern, the
/// CM Number or the request is ever part of the SQL text. The counter only goes up: deleting or deactivating an asset does not touch it, so a number is never reused. The unique index
/// <c>UQ_Asset_AssetNumber</c> remains the last line of defence.
/// </summary>
public sealed class AssetNumberGenerator(DbContext db)
{
    // One batch, one round trip. @taken receives the value the counter had BEFORE this call (the number to hand out).
    private const string TakeNextSql = """
        DECLARE @taken TABLE (Number INT NOT NULL);

        UPDATE dbo.AssetNumberCounter WITH (UPDLOCK, ROWLOCK)
           SET NextNumber = NextNumber + 1, ModifiedAt = SYSUTCDATETIME()
        OUTPUT deleted.NextNumber INTO @taken (Number)
         WHERE AssetTypeId = @assetTypeId AND ScopeKey = @scopeKey;

        IF NOT EXISTS (SELECT 1 FROM @taken)
        BEGIN
            -- First use of this (asset type, scope): the row is created already advanced past number 1. UPDLOCK + HOLDLOCK takes a key-range lock on the missing key, so a concurrent
            -- first user waits here (until this transaction ends) instead of inserting a second row.
            INSERT dbo.AssetNumberCounter (AssetTypeId, ScopeKey, NextNumber)
            SELECT @assetTypeId, @scopeKey, 2
             WHERE NOT EXISTS (SELECT 1 FROM dbo.AssetNumberCounter WITH (UPDLOCK, HOLDLOCK) WHERE AssetTypeId = @assetTypeId AND ScopeKey = @scopeKey);

            IF @@ROWCOUNT = 1
                INSERT @taken (Number) VALUES (1);
            ELSE
                -- A concurrent first user created the row and committed while this call waited: take the next number from it.
                UPDATE dbo.AssetNumberCounter WITH (UPDLOCK, ROWLOCK)
                   SET NextNumber = NextNumber + 1, ModifiedAt = SYSUTCDATETIME()
                OUTPUT deleted.NextNumber INTO @taken (Number)
                 WHERE AssetTypeId = @assetTypeId AND ScopeKey = @scopeKey;
        END

        SELECT TOP (1) Number FROM @taken;
        """;

    /// <summary>
    /// Takes the next number for the matter. The caller must already hold the transaction that inserts the asset (the counter and the asset commit or roll back together); without one
    /// this throws, because a counter that commits on its own would leave gaps.
    /// </summary>
    /// <param name="type">The asset type, with its numbering settings (numbering must be on).</param>
    /// <param name="matterId">The matter the asset belongs to (the counter's scope key while the scope is per matter).</param>
    /// <param name="cmNumber">The matter's CM Number (client number, a hyphen, matter number: <c>90003-80008</c>).</param>
    public async Task<AssignedAssetNumber> TakeNextAsync(AssetType type, int matterId, string cmNumber, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(type);
        if (!type.NumberingEnabled)
            throw new InvalidOperationException($"Asset type {type.Id} does not number its assets.");
        if (type.NumberingScope != AssetNumbering.ScopeMatter)
            throw new NotSupportedException($"Numbering scope {type.NumberingScope} is not supported.");
        if (db.Database.CurrentTransaction is not { } transaction)
            throw new InvalidOperationException("The asset number must be taken inside the transaction that inserts the asset.");

        // Parse before touching the counter: a pattern that cannot be rendered must not burn a number. (Saved patterns are validated; this guards against a row edited by hand.)
        var parsed = AssetNumbering.Parse(type.NumberingPattern);
        if (!parsed.IsValid)
            throw new InvalidOperationException($"The numbering pattern of asset type {type.Id} is invalid ({parsed.Code}).");

        var connection = db.Database.GetDbConnection();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction.GetDbTransaction();
        command.CommandText = TakeNextSql;
        command.Parameters.Add(new SqlParameter("@assetTypeId", SqlDbType.Int) { Value = type.Id });
        command.Parameters.Add(new SqlParameter("@scopeKey", SqlDbType.Int) { Value = matterId });
        var taken = await command.ExecuteScalarAsync(ct);
        var sequence = Convert.ToInt32(taken, System.Globalization.CultureInfo.InvariantCulture);

        return new AssignedAssetNumber(parsed.Pattern!.Render(cmNumber, sequence), sequence);
    }
}
