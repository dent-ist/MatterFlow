using System.Data;
using System.Text.Json;
using LptHub.Reports.Domain;
using LptHub.Reports.Domain.Parameters;
using Shouldly;

namespace LptHub.UnitTests.Reports;

/// <summary>
/// The security corpora of issue #725 (spec 16.3 a and b) as data files: the validator corpus (bypass attempts and inert look-alikes) and the injection values,
/// run through the binder for every parameter type. The same injection values run through the real report login in the integration suite.
/// </summary>
[Trait("Suite", "ReportsSecurity")]
public class ReportSecurityCorpusTests
{
    private static readonly BuiltInContext Ctx = new(7, "Ann Example", new DateOnly(2026, 10, 22), new DateTime(2026, 10, 22, 14, 30, 0, DateTimeKind.Utc), [3, 5], 3, -240);

    public static TheoryData<string> ValidatorIds()
    {
        var data = new TheoryData<string>();
        foreach (var entry in ReportCorpusFiles.Validator)
            data.Add(entry.Id);
        return data;
    }

    // ---- validator corpus (b) ----

    [Fact]
    public void The_validator_corpus_is_a_data_file_with_at_least_sixty_refused_statements_and_unique_ids()
    {
        ReportCorpusFiles.Validator.Count(e => !e.Valid).ShouldBeGreaterThanOrEqualTo(60);
        ReportCorpusFiles.Validator.Count(e => e.Valid).ShouldBeGreaterThanOrEqualTo(10);
        ReportCorpusFiles.Validator.Select(e => e.Id).Distinct().Count().ShouldBe(ReportCorpusFiles.Validator.Count);
        ReportCorpusFiles.Validator.Where(e => !e.Valid).ShouldAllBe(e => e.Codes.Length > 0);
    }

    [Theory]
    [MemberData(nameof(ValidatorIds))]
    public void Every_corpus_entry_gets_the_expected_verdict(string id)
    {
        var entry = ReportCorpusFiles.Validator.Single(e => e.Id == id);

        var result = SqlValidator.Validate(entry.Sql);

        var codes = string.Join(", ", result.Errors.Select(e => e.Code));
        if (entry.Valid)
        {
            result.IsValid.ShouldBeTrue($"{id} {entry.Note}: [{entry.Sql}] -> {codes}");
            return;
        }

        result.IsValid.ShouldBeFalse($"{id} {entry.Note}: [{entry.Sql}] was ACCEPTED");
        result.Errors.Select(e => e.Code).Intersect(entry.Codes).ShouldNotBeEmpty($"{id}: expected one of {string.Join(", ", entry.Codes)} but got {codes} for [{entry.Sql}]");
        foreach (var error in result.Errors)
        {
            error.Position.ShouldBeInRange(0, Math.Max(entry.Sql.Length, 1));
            error.Message.ShouldNotBeNullOrWhiteSpace();
            error.Message.ShouldNotContain("@p_"); // the engine's own parameter names never reach the author
        }
    }

    [Fact]
    public void The_engine_path_that_compiles_placeholders_first_gives_the_same_verdict_as_the_plain_validator()
    {
        foreach (var entry in ReportCorpusFiles.Validator)
        {
            var (_, validation) = ReportSqlCompiler.CompileAndValidate(entry.Sql, []);

            validation.IsValid.ShouldBe(entry.Valid, $"{entry.Id}: [{entry.Sql}]");
        }
    }

    // ---- injection values (a) ----

    private static ReportParameterDefinition Def(string name, ReportParameterType type, Func<ReportParameterDefinition, ReportParameterDefinition>? configure = null)
    {
        var d = new ReportParameterDefinition { Name = name, Type = type, Label = name };
        return configure is null ? d : configure(d);
    }

    private static BindResult Bind(ReportParameterDefinition def, JsonElement value) =>
        ParameterBinder.Bind([def], new Dictionary<string, JsonElement>(StringComparer.Ordinal) { [def.Name] = value }, Ctx, null);

    private static JsonElement S(string text) => JsonSerializer.SerializeToElement(text);

    /// <summary>Whatever the binder lets through is a value of exactly the declared SQL type; whatever it refuses names the parameter.</summary>
    private static void ShouldBeTypedOrRefused(BindResult result, string name, SqlDbType expected, string payload)
    {
        foreach (var error in result.Errors)
        {
            error.Name.ShouldBe(name, $"[{payload}]");
            error.Code.ShouldNotBeNullOrWhiteSpace();
        }

        if (!result.IsValid)
        {
            result.Parameters.ShouldBeEmpty($"[{payload}]");
            return;
        }

        foreach (var p in result.Parameters.Where(p => !p.IsNull))
        {
            p.DbType.ShouldBe(expected, $"[{payload}]");
            (p.Value switch
            {
                string => SqlDbType.NVarChar,
                decimal => SqlDbType.Decimal,
                long => SqlDbType.BigInt,
                int => SqlDbType.Int,
                bool => SqlDbType.Bit,
                DateTime => SqlDbType.Date,
                _ => SqlDbType.Variant,
            }).ShouldBe(expected, $"[{payload}] value {p.Value}");
        }
    }

    [Fact]
    public void The_injection_corpus_is_a_data_file()
    {
        ReportCorpusFiles.InjectionText.Count.ShouldBeGreaterThanOrEqualTo(40);
        ReportCorpusFiles.InjectionNumbers.Count.ShouldBeGreaterThanOrEqualTo(10);
        ReportCorpusFiles.InjectionDates.Count.ShouldBeGreaterThanOrEqualTo(10);
        ReportCorpusFiles.InjectionIds.Count.ShouldBeGreaterThanOrEqualTo(10);
    }

    [Fact]
    public void Text_values_bind_unchanged_as_nvarchar_and_the_sql_text_never_depends_on_them()
    {
        var def = Def("T", ReportParameterType.Text);
        var sqlBefore = ReportSqlCompiler.Compile("SELECT :T AS echo /* marker */", [def]).SqlText;

        foreach (var payload in ReportCorpusFiles.InjectionText)
        {
            var result = Bind(def, S(payload));

            if (payload.Length == 0)
                continue; // an empty text is "no value"
            result.Errors.ShouldBeEmpty($"[{payload}]");
            var p = result.Parameters.ShouldHaveSingleItem();
            p.DbType.ShouldBe(SqlDbType.NVarChar);
            p.Value.ShouldBe(payload);
            ReportSqlCompiler.Compile("SELECT :T AS echo /* marker */", [def]).SqlText.ShouldBe(sqlBefore);
        }

        sqlBefore.ShouldBe("SELECT @p_T AS echo /* marker */");
    }

    [Fact]
    public void Text_values_with_a_nul_character_or_beyond_the_limit_are_refused_by_name()
    {
        var def = Def("T", ReportParameterType.Text);

        Bind(def, S("a\0b")).Errors.ShouldHaveSingleItem().Code.ShouldBe(ParameterErrorCodes.InvalidType);
        Bind(def, S(new string('x', 401))).Errors.ShouldHaveSingleItem().Code.ShouldBe(ParameterErrorCodes.TooLong);
        Bind(def, S(new string('x', 400))).IsValid.ShouldBeTrue();
        var huge = Bind(def, S(new string('\'', 2_000_000)));
        huge.Errors.ShouldHaveSingleItem().Code.ShouldBe(ParameterErrorCodes.TooLong);
        Bind(def, JsonSerializer.SerializeToElement(new[] { "a" })).Errors.ShouldHaveSingleItem().Code.ShouldBe(ParameterErrorCodes.InvalidType); // not text
        Bind(def, JsonSerializer.SerializeToElement(new { a = 1 })).Errors.ShouldHaveSingleItem().Code.ShouldBe(ParameterErrorCodes.InvalidType);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Number_values_are_typed_numbers_or_refused(bool integerOnly)
    {
        var def = Def("N", ReportParameterType.Number, d => d with { IntegerOnly = integerOnly });

        foreach (var payload in ReportCorpusFiles.InjectionNumbers)
            ShouldBeTypedOrRefused(Bind(def, S(payload)), "N", integerOnly ? SqlDbType.BigInt : SqlDbType.Decimal, payload);

        foreach (var payload in ReportCorpusFiles.InjectionText)
            ShouldBeTypedOrRefused(Bind(def, S(payload)), "N", integerOnly ? SqlDbType.BigInt : SqlDbType.Decimal, payload);
    }

    [Fact]
    public void Date_values_that_are_not_dates_are_refused_with_the_parameter_name()
    {
        var def = Def("D", ReportParameterType.Date);

        foreach (var payload in ReportCorpusFiles.InjectionDates.Concat(ReportCorpusFiles.InjectionText).Where(p => p.Length > 0))
        {
            var result = Bind(def, S(payload));

            ShouldBeTypedOrRefused(result, "D", SqlDbType.Date, payload);
            // The relative keywords of the form (today, startOfMonth, ...) are the only way a word becomes a date.
            if (!result.IsValid)
                result.Errors.ShouldHaveSingleItem().Code.ShouldBe(ParameterErrorCodes.InvalidDate, $"[{payload}]");
        }
    }

    [Fact]
    public void Lookup_ids_are_positive_whole_numbers_single_or_in_a_list()
    {
        var single = Def("L", ReportParameterType.Lookup, d => d with { LookupKind = LookupKind.Matter });
        var multi = Def("M", ReportParameterType.Lookup, d => d with { LookupKind = LookupKind.Matter, LookupMulti = true });

        foreach (var payload in ReportCorpusFiles.InjectionIds.Concat(ReportCorpusFiles.InjectionText).Where(p => p.Length > 0))
        {
            var one = Bind(single, S(payload));
            ShouldBeTypedOrRefused(one, "L", SqlDbType.Int, payload);

            var many = Bind(multi, JsonSerializer.SerializeToElement(new[] { payload }));
            if (many.IsValid)
            {
                var list = many.Parameters.ShouldHaveSingleItem();
                list.DbType.ShouldBe(SqlDbType.NVarChar);
                JsonDocument.Parse((string)list.Value!).RootElement.EnumerateArray().ShouldAllBe(e => e.ValueKind == JsonValueKind.Number, $"[{payload}]");
            }
            else
            {
                many.Parameters.ShouldBeEmpty();
            }
        }

        Bind(single, JsonSerializer.SerializeToElement(1.5)).IsValid.ShouldBeFalse();
        Bind(single, JsonSerializer.SerializeToElement(new[] { 1 })).IsValid.ShouldBeFalse();
        Bind(single, JsonSerializer.SerializeToElement(new { id = 1 })).IsValid.ShouldBeFalse();
        Bind(single, JsonSerializer.SerializeToElement(2147483647)).IsValid.ShouldBeTrue();
    }

    [Fact]
    public void Yes_no_takes_only_true_and_false()
    {
        var def = Def("Y", ReportParameterType.YesNo);

        foreach (var payload in ReportCorpusFiles.InjectionText.Concat(ReportCorpusFiles.InjectionNumbers).Where(p => p.Length > 0 && p is not ("true" or "false")))
        {
            var result = Bind(def, S(payload));

            result.IsValid.ShouldBeFalse($"[{payload}]");
            result.Errors.ShouldHaveSingleItem().Name.ShouldBe("Y");
        }

        Bind(def, JsonSerializer.SerializeToElement(1)).IsValid.ShouldBeFalse();
        Bind(def, JsonSerializer.SerializeToElement(true)).IsValid.ShouldBeTrue();
    }

    [Fact]
    public void A_single_choice_is_always_one_of_the_listed_values_and_binds_the_listed_text()
    {
        var onlyOk = Def("C", ReportParameterType.Single, d => d with { OptionsKind = OptionsKind.Fixed, Options = [new("ok", "Ok")] });
        var everything = Def("C", ReportParameterType.Single, d => d with
        {
            OptionsKind = OptionsKind.Fixed,
            Options = ReportCorpusFiles.InjectionText.Where(t => t.Length is > 0 and <= ReportParameterDefinition.MaxChoiceTextLength).Select(t => new ParameterOption(t, t)).ToList(),
        });

        foreach (var payload in ReportCorpusFiles.InjectionText.Where(t => t is not "ok"))
        {
            var refused = Bind(onlyOk, S(payload));
            if (payload.Length > 0)
                refused.Errors.ShouldHaveSingleItem().Code.ShouldBe(ParameterErrorCodes.NotInOptions, $"[{payload}]");
        }

        foreach (var payload in ReportCorpusFiles.InjectionText.Where(t => t.Length is > 0 and <= ReportParameterDefinition.MaxChoiceTextLength))
        {
            var accepted = Bind(everything, S(payload));
            accepted.Errors.ShouldBeEmpty($"[{payload}]");
            var p = accepted.Parameters.ShouldHaveSingleItem();
            p.DbType.ShouldBe(SqlDbType.NVarChar);
            p.Value.ShouldBe(payload);
        }
    }

    [Fact]
    public void A_multi_choice_binds_one_json_array_built_by_the_serializer_and_refuses_anything_unlisted()
    {
        var listed = ReportCorpusFiles.InjectionText.Where(t => t.Length is > 0 and <= ReportParameterDefinition.MaxChoiceTextLength).Distinct().ToList();
        var everything = Def("M", ReportParameterType.Multi, d => d with { OptionsKind = OptionsKind.Fixed, Options = listed.Select(t => new ParameterOption(t, t)).ToList(), MaxSelected = 1000 });
        var onlyOk = Def("M", ReportParameterType.Multi, d => d with { OptionsKind = OptionsKind.Fixed, Options = [new("ok", "Ok")] });

        var all = Bind(everything, JsonSerializer.SerializeToElement(listed));

        all.Errors.ShouldBeEmpty();
        var parameter = all.Parameters.ShouldHaveSingleItem();
        parameter.DbType.ShouldBe(SqlDbType.NVarChar);
        parameter.Size.ShouldBe(-1);
        JsonDocument.Parse((string)parameter.Value!).RootElement.EnumerateArray().Select(e => e.GetString()).ShouldBe(listed); // every hostile string came back as one string element
        foreach (var payload in listed.Where(t => t is not "ok"))
            Bind(onlyOk, JsonSerializer.SerializeToElement(new[] { "ok", payload })).Errors.ShouldHaveSingleItem().Code.ShouldBe(ParameterErrorCodes.NotInOptions, $"[{payload}]");
    }

    [Fact]
    public void A_date_range_with_a_hostile_end_is_refused_by_name()
    {
        var def = Def("R", ReportParameterType.DateRange);

        foreach (var payload in ReportCorpusFiles.InjectionDates.Concat(ReportCorpusFiles.InjectionText).Where(p => p.Length > 0))
        {
            foreach (var shape in new[] { new { from = payload, to = "2026-01-01" }, new { from = "2026-01-01", to = payload } })
            {
                var result = Bind(def, JsonSerializer.SerializeToElement(shape));
                if (result.IsValid)
                    result.Parameters.ShouldAllBe(p => p.DbType == SqlDbType.Date, $"[{payload}]");
                else
                    result.Errors.ShouldHaveSingleItem().Name.ShouldBe("R");
            }
        }
    }

    [Fact]
    public void Parameter_names_from_the_request_are_never_trusted()
    {
        var def = Def("T", ReportParameterType.Text);

        foreach (var payload in ReportCorpusFiles.InjectionText.Where(p => p.Trim().Length > 0))
        {
            var result = ParameterBinder.Bind([def], new Dictionary<string, JsonElement> { [payload] = S("x") }, Ctx, null);

            result.IsValid.ShouldBeFalse($"[{payload}]");
            result.Errors.ShouldAllBe(e => e.Name.Length <= 64, $"[{payload}] an echoed name is cut short");
        }
    }

    [Fact]
    public void Built_in_values_cannot_be_supplied_in_any_spelling()
    {
        var def = Def("T", ReportParameterType.Text);

        foreach (var name in BuiltInParameters.Names)
        {
            foreach (var spelling in new[] { name, name.ToLowerInvariant(), " " + name + " ", char.ToUpperInvariant(name[0]) + name[1..].ToLowerInvariant() })
            {
                var result = ParameterBinder.Bind([def], new Dictionary<string, JsonElement> { [spelling] = JsonSerializer.SerializeToElement(1) }, Ctx, null);

                result.Errors.ShouldContain(e => e.Code == ParameterErrorCodes.BuiltInNotAllowed, $"[{spelling}]");
                result.IsValid.ShouldBeFalse();
            }
        }
    }

    [Fact]
    public void Absurdly_large_lists_are_refused_before_any_element_is_read()
    {
        var multi = Def("M", ReportParameterType.Multi, d => d with { OptionsKind = OptionsKind.Fixed, Options = [new("a", "A")], MaxSelected = 1000 });
        var lookup = Def("L", ReportParameterType.Lookup, d => d with { LookupKind = LookupKind.Matter, LookupMulti = true });
        var watch = System.Diagnostics.Stopwatch.StartNew();

        var tooManyChoices = Bind(multi, JsonSerializer.SerializeToElement(Enumerable.Repeat("a", 200_000)));
        var tooManyIds = Bind(lookup, JsonSerializer.SerializeToElement(Enumerable.Range(1, 200_000)));
        var oneMoreThanTheCeiling = Bind(lookup with { MaxSelected = 5000 }, JsonSerializer.SerializeToElement(Enumerable.Range(1, 1001)));

        tooManyChoices.Errors.ShouldHaveSingleItem().Code.ShouldBe(ParameterErrorCodes.TooMany);
        tooManyIds.Errors.ShouldHaveSingleItem().Code.ShouldBe(ParameterErrorCodes.TooMany);
        oneMoreThanTheCeiling.Errors.ShouldHaveSingleItem().Code.ShouldBe(ParameterErrorCodes.TooMany); // a stored setting cannot lift the ceiling of 1,000
        watch.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(5));
    }
}
