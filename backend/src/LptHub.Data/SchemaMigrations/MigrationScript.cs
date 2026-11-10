using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace MatterFlow.Data.SchemaMigrations;

/// <summary>A discovered script: name, numeric prefix, normalized content and checksum.</summary>
public sealed partial class MigrationScript
{
    public const string NoTransactionDirective = "-- mf:no-transaction";

    private MigrationScript(string name, int prefix, string content)
    {
        Name = name;
        Prefix = prefix;
        Content = content;
        Checksum = ComputeChecksum(content);
        NoTransaction = content.TrimStart().StartsWith(NoTransactionDirective, StringComparison.OrdinalIgnoreCase);
    }

    public string Name { get; }

    public int Prefix { get; }

    /// <summary>Content with BOM removed, line endings normalized to LF and trailing whitespace trimmed.</summary>
    public string Content { get; }

    public string Checksum { get; }

    public bool NoTransaction { get; }

    public static MigrationScript Create(string name, string rawContent)
    {
        var match = NamePattern().Match(name);
        if (!match.Success)
        {
            throw new SchemaMigrationException(
                $"Script '{name}' does not match the naming convention NN-kebab-description.sql (regex {NamePattern()}).");
        }

        if (!int.TryParse(match.Groups["n"].Value, out var prefix))
        {
            throw new SchemaMigrationException($"Script '{name}' has an invalid numeric prefix.");
        }

        return new MigrationScript(name, prefix, Normalize(rawContent));
    }

    public static string Normalize(string raw)
    {
        var text = raw.TrimStart('﻿').Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n');
        return text.TrimEnd();
    }

    public static string ComputeChecksum(string normalizedContent) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(normalizedContent)));

    [GeneratedRegex(@"^(?<n>\d{2,6})-[a-z0-9][a-z0-9-]*\.sql$")]
    private static partial Regex NamePattern();
}
