using System.Text.RegularExpressions;
using MatterFlow.SharedKernel.Audit;

namespace MatterFlow.Audit.Application;

/// <summary>
/// Last line of defence for the audit browser: the viewer holds Audit.View and may read full values, but secrets and tokens are never returned
/// (security review). A value is masked as a whole when its field key names a secret, or when its text looks like a credential
/// (JWT, bearer token, <c>password=...</c>, private key block, connection string password).
/// </summary>
internal static partial class AuditValueGuard
{
    /// <summary>True when values stored under this field key must never be shown.</summary>
    public static bool IsSensitiveKey(string? fieldKey) => !string.IsNullOrEmpty(fieldKey) && SensitiveKey().IsMatch(fieldKey);

    /// <summary>True when the text itself looks like a secret.</summary>
    public static bool LooksLikeSecret(string? text) => !string.IsNullOrEmpty(text) && SecretText().IsMatch(text);

    /// <summary>The value to return: masked for a sensitive key or secret-looking text, otherwise truncated for display.</summary>
    public static string? Guard(string? value, bool sensitiveKey, out bool truncated, out bool redacted)
    {
        truncated = false;
        redacted = false;
        if (string.IsNullOrEmpty(value))
            return value;

        if (sensitiveKey || LooksLikeSecret(value))
        {
            redacted = true;
            return Redaction.Masked;
        }

        return Redaction.Truncate(value, out truncated);
    }

    [GeneratedRegex(@"(pass(word|phrase|wd)|pwd|secret|token|api[_\-\s]?key|credential|private[_\-\s]?key|connection[_\-\s]?string|authorization|bearer|cookie|session[_\-\s]?id)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex SensitiveKey();

    [GeneratedRegex(
        @"(eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]*)|(\bbearer\s+[A-Za-z0-9._~+/=\-]{12,})|(\b(password|pwd|passwd|secret|api[_\-]?key|access[_\-]?token|refresh[_\-]?token|client[_\-]?secret)\s*[=:])|(-----BEGIN [A-Z ]*PRIVATE KEY-----)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex SecretText();
}
