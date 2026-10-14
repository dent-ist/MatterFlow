using System.Text;

namespace MatterFlow.Configuration.Domain.Forms.Rules;

/// <summary>
/// The portable regular-expression subset of contracts/form-rules.md section 3.1: validates a pattern and translates it to
/// a .NET <c>RegexOptions.ECMAScript</c> pattern that matches exactly like the same pattern in JavaScript. Only <c>.</c> and
/// <c>$</c> need rewriting; everything else in the subset already agrees between the engines.
/// </summary>
public static class PortablePattern
{
    private const int MaxPatternLength = 200;
    private const string SyntaxChars = "^$\\.*+?()[]{}|/-";

    // JavaScript '.' excludes \n, \r, U+2028 and U+2029; .NET excludes only \n.
    private const string AnyCharacter = "[^\\n\\r\\u2028\\u2029]";

    // JavaScript '$' (no multiline) matches only at the very end; .NET also matches before a final \n.
    private const string EndOfInput = "(?![\\s\\S])";

    /// <summary>True when <paramref name="pattern"/> is in the portable subset; <paramref name="translated"/> is then the .NET pattern.</summary>
    public static bool TryTranslate(string pattern, out string translated)
    {
        var parser = new Parser(pattern);
        if (parser.Run())
        {
            translated = parser.Output;
            return true;
        }

        translated = string.Empty;
        return false;
    }

    private readonly record struct Atom(bool Quantifiable, bool IsGroup, bool Unbounded);

    private sealed class Parser
    {
        private readonly string _p;
        private readonly StringBuilder _out = new();
        private int _i;

        public Parser(string pattern)
        {
            _p = pattern;
        }

        public string Output => _out.ToString();

        public bool Run() =>
            _p.Length is >= 1 and <= MaxPatternLength && ParseAlt() is not null && _i == _p.Length;

        private static bool IsQuantifierStart(char c) => c is '*' or '+' or '?' or '{';

        private static bool IsDigit(char c) => c is >= '0' and <= '9';

        private bool? ParseAlt()
        {
            var unbounded = false;
            while (true)
            {
                if (ParseSeq() is not { } seq)
                {
                    return null;
                }

                unbounded |= seq;
                if (_i < _p.Length && _p[_i] == '|')
                {
                    _out.Append('|');
                    _i++;
                    continue;
                }

                return unbounded;
            }
        }

        private bool? ParseSeq()
        {
            var unbounded = false;
            while (_i < _p.Length && _p[_i] != '|' && _p[_i] != ')')
            {
                if (ParseAtom() is not { } atom)
                {
                    return null;
                }

                unbounded |= atom.Unbounded;
                if (_i < _p.Length && IsQuantifierStart(_p[_i]))
                {
                    if (!atom.Quantifiable || ParseQuantifier() is not { } quantifierUnbounded)
                    {
                        return null;
                    }

                    if (quantifierUnbounded && atom.IsGroup && atom.Unbounded)
                    {
                        return null;
                    }

                    unbounded |= quantifierUnbounded;
                }
            }

            return unbounded;
        }

        private Atom? ParseAtom()
        {
            var c = _p[_i];
            switch (c)
            {
                case '(':
                    return ParseGroup();
                case '[':
                    return ParseClass();
                case '\\':
                    return ParseEscape();
                case '^':
                    _i++;
                    _out.Append('^');
                    return new Atom(false, false, false);
                case '$':
                    _i++;
                    _out.Append(EndOfInput);
                    return new Atom(false, false, false);
                case '.':
                    _i++;
                    _out.Append(AnyCharacter);
                    return new Atom(true, false, false);
                case '*' or '+' or '?' or '{' or '}' or ']':
                    return null;
                default:
                    _i++;
                    _out.Append(c);
                    return new Atom(true, false, false);
            }
        }

        private Atom? ParseGroup()
        {
            _i++;
            _out.Append('(');
            if (_i < _p.Length && _p[_i] == '?')
            {
                if (_i + 1 >= _p.Length || _p[_i + 1] != ':')
                {
                    return null;
                }

                _out.Append("?:");
                _i += 2;
            }

            if (ParseAlt() is not { } inner || _i >= _p.Length || _p[_i] != ')')
            {
                return null;
            }

            _i++;
            _out.Append(')');
            return new Atom(true, true, inner);
        }

        private Atom? ParseEscape()
        {
            if (_i + 1 >= _p.Length)
            {
                return null;
            }

            var e = _p[_i + 1];
            _i += 2;
            if (e is 'b' or 'B')
            {
                _out.Append('\\').Append(e);
                return new Atom(false, false, false);
            }

            if ("dDwWtnrfv".Contains(e, StringComparison.Ordinal) || SyntaxChars.Contains(e, StringComparison.Ordinal))
            {
                _out.Append('\\').Append(e);
                return new Atom(true, false, false);
            }

            return null;
        }

        /// <summary>One escaped or literal character usable as a class range end; its code, or -1.</summary>
        private int ParseSingle()
        {
            if (_i >= _p.Length)
            {
                return -1;
            }

            var c = _p[_i];
            if (c is ']' or '[' or '-')
            {
                return -1;
            }

            if (c != '\\')
            {
                _i++;
                return c;
            }

            if (_i + 1 >= _p.Length)
            {
                return -1;
            }

            var e = _p[_i + 1];
            var code = e switch
            {
                't' => 9,
                'n' => 10,
                'r' => 13,
                'f' => 12,
                'v' => 11,
                _ => SyntaxChars.Contains(e, StringComparison.Ordinal) ? e : -1,
            };
            if (code >= 0)
            {
                _i += 2;
            }

            return code;
        }

        private Atom? ParseClass()
        {
            var start = _i;
            _i++;
            if (_i < _p.Length && _p[_i] == '^')
            {
                _i++;
            }

            var items = 0;
            var previous = -1;
            while (true)
            {
                if (_i >= _p.Length)
                {
                    return null;
                }

                var c = _p[_i];
                if (c == ']')
                {
                    if (items == 0)
                    {
                        return null;
                    }

                    _i++;
                    _out.Append(_p, start, _i - start);
                    return new Atom(true, false, false);
                }

                if (c == '[')
                {
                    return null;
                }

                if (c == '-')
                {
                    if (items == 0 || (_i + 1 < _p.Length && _p[_i + 1] == ']'))
                    {
                        _i++;
                        items++;
                        previous = -1;
                        continue;
                    }

                    if (previous < 0)
                    {
                        return null;
                    }

                    _i++;
                    var high = ParseSingle();
                    if (high < 0 || high < previous)
                    {
                        return null;
                    }

                    previous = -1;
                    continue;
                }

                if (c == '\\' && _i + 1 < _p.Length && "dDwW".Contains(_p[_i + 1], StringComparison.Ordinal))
                {
                    _i += 2;
                    items++;
                    previous = -1;
                    continue;
                }

                var code = ParseSingle();
                if (code < 0)
                {
                    return null;
                }

                items++;
                previous = code;
            }
        }

        /// <summary>Parses a quantifier (and optional lazy marker); returns whether it is unbounded, or null when malformed.</summary>
        private bool? ParseQuantifier()
        {
            var start = _i;
            bool unbounded;
            var c = _p[_i];
            if (c is '*' or '+' or '?')
            {
                _i++;
                unbounded = c != '?';
            }
            else
            {
                _i++;
                if (!ReadCount(out var low))
                {
                    return null;
                }

                var high = low;
                if (_i < _p.Length && _p[_i] == ',')
                {
                    _i++;
                    high = ReadCount(out var parsedHigh) ? parsedHigh : int.MaxValue;
                }

                if (_i >= _p.Length || _p[_i] != '}' || high < low)
                {
                    return null;
                }

                _i++;
                unbounded = high == int.MaxValue;
            }

            if (_i < _p.Length && _p[_i] == '?')
            {
                _i++;
            }

            if (_i < _p.Length && IsQuantifierStart(_p[_i]))
            {
                return null;
            }

            _out.Append(_p, start, _i - start);
            return unbounded;
        }

        /// <summary>Reads 1 to 3 ASCII digits; false (nothing consumed) when none.</summary>
        private bool ReadCount(out int value)
        {
            value = 0;
            var digits = 0;
            while (digits < 3 && _i < _p.Length && IsDigit(_p[_i]))
            {
                value = (value * 10) + (_p[_i] - '0');
                _i++;
                digits++;
            }

            return digits > 0;
        }
    }
}
