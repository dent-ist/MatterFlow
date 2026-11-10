using System.Text;
using System.Text.RegularExpressions;

namespace MatterFlow.Data.SchemaMigrations;

/// <summary>Splits a script on lines containing only GO, ignoring GO inside block comments, strings and bracketed identifiers.</summary>
public static partial class SqlBatchSplitter
{
    public static IReadOnlyList<string> Split(string script)
    {
        var batches = new List<string>();
        var current = new StringBuilder();
        var inBlockComment = false;
        var inString = false;
        var inBracket = false;

        foreach (var line in script.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n'))
        {
            if (!inBlockComment && !inString && !inBracket && GoLine().IsMatch(line))
            {
                Flush();
                continue;
            }

            current.Append(line).Append('\n');

            for (var i = 0; i < line.Length; i++)
            {
                var c = line[i];
                var next = i + 1 < line.Length ? line[i + 1] : '\0';

                if (inBlockComment)
                {
                    if (c == '*' && next == '/')
                    {
                        inBlockComment = false;
                        i++;
                    }
                }
                else if (inString)
                {
                    if (c == '\'')
                    {
                        inString = false; // a doubled quote ('') toggles off then on again
                    }
                }
                else if (inBracket)
                {
                    if (c == ']')
                    {
                        inBracket = false;
                    }
                }
                else if (c == '-' && next == '-')
                {
                    break;
                }
                else if (c == '/' && next == '*')
                {
                    inBlockComment = true;
                    i++;
                }
                else if (c == '\'')
                {
                    inString = true;
                }
                else if (c == '[')
                {
                    inBracket = true;
                }
            }
        }

        Flush();
        return batches;

        void Flush()
        {
            var text = current.ToString().Trim();
            if (text.Length > 0)
            {
                batches.Add(text);
            }

            current.Clear();
        }
    }

    [GeneratedRegex(@"^\s*GO\s*(--.*)?$", RegexOptions.IgnoreCase)]
    private static partial Regex GoLine();
}
