using System.Net.Mail;
using MatterFlow.SharedKernel.Results;

namespace MatterFlow.WorkManagement.Domain;

/// <summary>Field validation for Task text fields. Each method returns a field error or null.</summary>
public static class TaskValidation
{
    public const int TitleMaxLength = 200;
    public const int DescriptionMaxLength = 20000;
    public const int RequestorNameMaxLength = 200;
    public const int EmailMaxLength = 254;

    public static FieldError? ValidateTitle(string? title)
    {
        if (string.IsNullOrWhiteSpace(title))
            return new FieldError("REQUIRED", "A title is required.");
        return title.Trim().Length > TitleMaxLength
            ? new FieldError("TOO_LONG", $"A title may have at most {TitleMaxLength} characters.")
            : null;
    }

    public static FieldError? ValidateDescription(string? description) =>
        description is not null && description.Length > DescriptionMaxLength
            ? new FieldError("TOO_LONG", $"A description may have at most {DescriptionMaxLength} characters.")
            : null;

    public static FieldError? ValidateRequestorName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
            return new FieldError("REQUIRED", "A requestor name is required.");
        return name.Trim().Length > RequestorNameMaxLength
            ? new FieldError("TOO_LONG", $"A requestor name may have at most {RequestorNameMaxLength} characters.")
            : null;
    }

    /// <summary>The email is optional; if present it must be a plain address (no display name).</summary>
    public static FieldError? ValidateRequestorEmail(string? email)
    {
        if (string.IsNullOrWhiteSpace(email))
            return null;
        var e = email.Trim();
        if (e.Length > EmailMaxLength)
            return new FieldError("TOO_LONG", $"An email may have at most {EmailMaxLength} characters.");
        return IsValidEmail(e) ? null : new FieldError("INVALID_EMAIL", "The email address is not valid.");
    }

    private static bool IsValidEmail(string e)
    {
        if (e.Any(char.IsWhiteSpace) || e.Count(c => c == '@') != 1)
            return false;
        if (!MailAddress.TryCreate(e, out var addr) || addr.Address != e)
            return false;
        var domain = e[(e.IndexOf('@') + 1)..];
        return domain.Contains('.') && !domain.StartsWith('.') && !domain.EndsWith('.') && !domain.Contains("..", StringComparison.Ordinal);
    }
}
