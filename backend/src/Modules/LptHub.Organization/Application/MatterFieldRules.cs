using System.Text.RegularExpressions;
using LptHub.Organization.Domain;
using LptHub.SharedKernel.Results;

namespace LptHub.Organization.Application;

/// <summary>
/// Input rules of the matter fields (epic #1298): the DMS and DFS paths (a UNC path or an http/https address; drive letters are refused; UI spec section 3.3).
/// The value is trimmed; the function returns the cleaned value or a validation error against the request field.
/// </summary>
internal static partial class MatterFieldRules
{
    public const int MaxPathLength = 1000;

    /// <summary>Field codes of <see cref="ErrorCodes.InvalidPath"/>.</summary>
    public const string PathTooLong = "PATH_TOO_LONG";
    public const string PathDriveLetter = "PATH_DRIVE_LETTER";
    public const string PathCredentials = "PATH_CREDENTIALS";
    public const string PathFormat = "PATH_FORMAT";
    public const string PathDuplicate = "PATH_DUPLICATE";
    public const string TooManyPaths = "TOO_MANY_PATHS";

    public const string DuplicateMessage = "This path is already in the list.";

    // The messages are the ones of the UI spec (docs/ux/matter-fields/ui-spec.md section 3.3), so the screen and the API say the same.
    public const string DriveLetterMessage = @"Drive-letter paths such as C:\ are not accepted. Use a network path (\\server\share\...) or a web address (https://...).";
    public const string CredentialsMessage = "Remove the user name and password from the web address.";
    public const string FormatMessage = @"Enter a network path (\\server\share\...) or a web address starting with http:// or https://.";

    private static readonly char[] IllegalNameChars = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];

    /// <summary>
    /// Cleans a DMS/DFS path (UI spec 3.3). Blank (or null) clears the field and returns null. Otherwise it must be a UNC path (<c>\\server\share\folder\</c>)
    /// or an http/https address with a host, without spaces or <c>user:password@</c>. A leading letter and colon is refused first (<c>C:\</c>, <c>D:/x</c>).
    /// </summary>
    public static Result<string?> CleanPath(string? value, string field)
    {
        var text = value?.Trim();
        if (string.IsNullOrEmpty(text))
            return Result<string?>.Success(null);

        if (DriveLetter().IsMatch(text))
            return PathError(field, PathDriveLetter, DriveLetterMessage);
        if (text.Length > MaxPathLength)
            return PathError(field, PathTooLong, $"Use at most {MaxPathLength} characters.");
        if (text.Any(char.IsControl))
            return PathError(field, PathFormat, FormatMessage);

        if (text.StartsWith(@"\\", StringComparison.Ordinal))
            return IsUnc(text) ? text : PathError(field, PathFormat, FormatMessage);

        if (text.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || text.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            if (text.Any(char.IsWhiteSpace) || !Uri.TryCreate(text, UriKind.Absolute, out var uri) || uri.Host.Length == 0)
                return PathError(field, PathFormat, FormatMessage);

            // The authority is checked on the text as well: a '@' before the first '/', '?' or '#' means credentials, however the parser reads it.
            var authority = text[(text.IndexOf("://", StringComparison.Ordinal) + 3)..];
            var end = authority.IndexOfAny(['/', '?', '#']);
            if (end >= 0)
                authority = authority[..end];
            return authority.Contains('@', StringComparison.Ordinal) || uri.UserInfo.Length > 0
                ? PathError(field, PathCredentials, CredentialsMessage)
                : text;
        }

        return PathError(field, PathFormat, FormatMessage);
    }

    /// <summary>
    /// Cleans the list of one kind (epic #1389, issue #1391). Blank entries are skipped; every other entry is cleaned like <see cref="CleanPath"/>, except a path the matter already
    /// has (exact text), which is kept as it is. The same path twice (ignoring letter case) and more than <see cref="MatterPathKinds.MaxPerKind"/> paths are refused. The errors of every
    /// bad entry come back together, keyed <c>field[n]</c> with n the entry's place in the request (from 0); too many paths is keyed <c>field</c>.
    /// </summary>
    public static Result<string[]> CleanPaths(IReadOnlyList<string?>? values, string field, IReadOnlyCollection<string> current)
    {
        var errors = new Dictionary<string, IReadOnlyList<FieldError>>();
        var kept = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < (values?.Count ?? 0); i++)
        {
            var text = values![i]?.Trim();
            if (string.IsNullOrEmpty(text))
                continue;

            var key = $"{field}[{i}]";
            if (!current.Contains(text, StringComparer.Ordinal))
            {
                var clean = CleanPath(text, key);
                if (clean.IsFailure)
                {
                    errors[key] = clean.Error!.FieldErrors![key];
                    continue;
                }
            }

            if (!seen.Add(text))
            {
                errors[key] = [new FieldError(PathDuplicate, DuplicateMessage)];
                continue;
            }

            kept.Add(text);
        }

        if (kept.Count > MatterPathKinds.MaxPerKind && errors.Count == 0)
        {
            var message = $"Use at most {MatterPathKinds.MaxPerKind} paths of one kind.";
            errors[field] = [new FieldError(TooManyPaths, message)];
        }

        if (errors.Count > 0)
            return new Error(ErrorType.Validation, ErrorCodes.InvalidPath, errors.Values.First()[0].Message, errors);

        return kept.ToArray();
    }

    /// <summary>Server: letters, digits, '.', '-', '_'. Share and folders: any character except <c>\ / : * ? " &lt; &gt; |</c> (spaces allowed). No empty part, one optional trailing backslash.</summary>
    private static bool IsUnc(string text)
    {
        var parts = text[2..].Split('\\');
        if (parts.Length < 2)
            return false;

        var server = parts[0];
        if (server.Length == 0 || !server.All(c => c is (>= 'a' and <= 'z') or (>= 'A' and <= 'Z') or (>= '0' and <= '9') or '.' or '-' or '_'))
            return false;

        var names = parts[1..];
        for (var i = 0; i < names.Length; i++)
        {
            var name = names[i];
            if (name.Length == 0)
            {
                if (i == names.Length - 1 && i > 0)
                    continue; // a single trailing backslash after the share or a folder
                return false;
            }

            if (name.IndexOfAny(IllegalNameChars) >= 0 || name.Trim().Length == 0)
                return false;
        }

        return true;
    }

    private static Error PathError(string field, string fieldCode, string message) =>
        new(
            ErrorType.Validation,
            ErrorCodes.InvalidPath,
            message,
            new Dictionary<string, IReadOnlyList<FieldError>> { [field] = [new FieldError(fieldCode, message)] });

    [GeneratedRegex("^[A-Za-z]:", RegexOptions.CultureInvariant)]
    private static partial Regex DriveLetter();
}
