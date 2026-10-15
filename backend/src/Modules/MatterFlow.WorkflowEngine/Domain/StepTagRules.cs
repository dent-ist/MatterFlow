using System.Globalization;
using MatterFlow.SharedKernel.Results;

namespace MatterFlow.WorkflowEngine.Domain;

/// <summary>A normalised step tag: <see cref="Key"/> is the case-insensitive identity, <see cref="Name"/> the display text.</summary>
public readonly record struct NormalizedTag(string Key, string Name);

/// <summary>
/// The rules for free-form step tags (library step metadata): trim, collapse inner whitespace to one space, at most
/// <see cref="MaxLength"/> characters, at most <see cref="MaxPerStep"/> per step, no control characters, and case-insensitive uniqueness
/// per step where the first spelling wins. The key is the invariant lower-case text, so "relativity" and "Relativity" are one tag.
/// </summary>
public static class StepTagRules
{
    public const int MaxLength = 40;

    public const int MaxPerStep = 20;

    /// <summary>The identity of a (normalised) tag name: invariant lower case.</summary>
    public static string KeyOf(string name) => name.ToLowerInvariant();

    /// <summary>
    /// Normalises one tag. Fails with <c>TAG_INVALID</c> when it is empty after trimming or holds a control or invisible formatting
    /// character, and with <c>TAG_TOO_LONG</c> when it is longer than <see cref="MaxLength"/> characters.
    /// </summary>
    public static Result<NormalizedTag> Normalize(string? raw)
    {
        if (raw is null)
        {
            return Invalid("A tag cannot be empty.");
        }

        foreach (var ch in raw)
        {
            if (char.IsControl(ch) || char.GetUnicodeCategory(ch) == UnicodeCategory.Format)
            {
                return Invalid("A tag cannot contain control characters.");
            }
        }

        var name = CollapseWhitespace(raw);
        if (name.Length == 0)
        {
            return Invalid("A tag cannot be empty.");
        }

        if (name.Length > MaxLength)
        {
            return Error.Validation("tags", ErrorCodes.TagTooLong, $"A tag can have at most {MaxLength} characters.", ErrorCodes.TagTooLong);
        }

        return new NormalizedTag(KeyOf(name), name);
    }

    /// <summary>
    /// Normalises a tag list: every tag must be valid, duplicates (ignoring case) are dropped keeping the first spelling and the entered
    /// order, and at most <see cref="MaxPerStep"/> distinct tags remain (<c>TOO_MANY_TAGS</c> otherwise).
    /// </summary>
    public static Result<IReadOnlyList<NormalizedTag>> NormalizeAll(IEnumerable<string?> raw)
    {
        var result = new List<NormalizedTag>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in raw)
        {
            var tag = Normalize(item);
            if (tag.IsFailure)
            {
                return tag.Error!;
            }

            if (seen.Add(tag.Value.Key))
            {
                result.Add(tag.Value);
            }
        }

        if (result.Count > MaxPerStep)
        {
            return Error.Validation("tags", ErrorCodes.TooManyTags, $"A step can have at most {MaxPerStep} tags.", ErrorCodes.TooManyTags);
        }

        return result;
    }

    private static Error Invalid(string message) => Error.Validation("tags", ErrorCodes.TagInvalid, message, ErrorCodes.TagInvalid);

    private static string CollapseWhitespace(string text)
    {
        var builder = new System.Text.StringBuilder(text.Length);
        var pendingSpace = false;
        foreach (var ch in text)
        {
            if (char.IsWhiteSpace(ch))
            {
                pendingSpace = builder.Length > 0;
                continue;
            }

            if (pendingSpace)
            {
                builder.Append(' ');
                pendingSpace = false;
            }

            builder.Append(ch);
        }

        return builder.ToString();
    }
}
