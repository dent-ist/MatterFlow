using MatterFlow.Configuration.Domain.Forms.Rules;
using Shouldly;

namespace MatterFlow.UnitTests.Configuration.Forms;

public class FormRulesEdgeCaseTests
{
    private static FormSchema Schema(string fieldsJson)
    {
        var result = FormSchema.Compile(FormSchemaJson.ParseFields($"{{\"fields\":{fieldsJson}}}"));
        result.Errors.ShouldBeEmpty();
        return result.Schema!;
    }

    private static FormEvaluationResult Run(FormSchema schema, string valuesJson, FormEvaluationMode mode = FormEvaluationMode.Submit) =>
        FormEvaluator.Evaluate(schema, FormValues.FromJson(valuesJson), mode);

    private static string[] Codes(FormEvaluationResult r) => [.. r.Errors.Select(e => $"{e.FieldKey}:{e.Code.ToWireName()}")];

    [Fact]
    public void Empty_values_differ_from_false_and_zero()
    {
        var schema = Schema("""
            [{"key":"flag","control":"CHECKBOX","required":true},
             {"key":"count","control":"NUMBER","required":true},
             {"key":"note","control":"TEXT","required":true}]
            """);

        var zeroAndFalse = Run(schema, """{"flag":false,"count":0,"note":"x"}""");
        zeroAndFalse.Errors.ShouldBeEmpty();
        zeroAndFalse.Normalized.ToJson().ShouldBe("{\"flag\":false,\"count\":0,\"note\":\"x\"}");

        Codes(Run(schema, """{"flag":null,"count":"","note":"   "}""")).ShouldBe(["count:REQUIRED", "flag:REQUIRED", "note:REQUIRED"]);
        Codes(Run(schema, "{}")).ShouldBe(["count:REQUIRED", "flag:REQUIRED", "note:REQUIRED"]);
    }

    [Fact]
    public void Non_ascii_whitespace_is_not_empty()
    {
        var schema = Schema("""[{"key":"note","control":"TEXT","required":true}]""");
        Run(schema, "{\"note\":\"\\u00A0\"}").Errors.ShouldBeEmpty();
    }

    [Theory]
    [InlineData("2026-02-29", "INVALID_TYPE")]
    [InlineData("2024-02-29", "OUT_OF_RANGE")]
    [InlineData("0000-01-01", "INVALID_TYPE")]
    [InlineData("9999-12-31", "OUT_OF_RANGE")]
    [InlineData("2026-01-01T00:00:00Z", "INVALID_TYPE")]
    [InlineData("2026-1-01", "INVALID_TYPE")]
    [InlineData("2025-12-31", "OUT_OF_RANGE")]
    [InlineData("2027-01-01", "OUT_OF_RANGE")]
    [InlineData("2026-01-01", null)]
    [InlineData("2026-12-31", null)]
    public void Date_field_validation(string value, string? expectedCode)
    {
        var schema = Schema("""[{"key":"d","control":"DATE","validation":{"min":"2026-01-01","max":"2026-12-31"}}]""");
        var result = Run(schema, $"{{\"d\":\"{value}\"}}");
        Codes(result).ShouldBe(expectedCode is null ? [] : [$"d:{expectedCode}"]);
    }

    [Theory]
    [InlineData("2026-03-01T10:00:00Z", true)]
    [InlineData("2026-03-01T10:00:00.1Z", true)]
    [InlineData("2026-03-01T10:00:00.1234567Z", true)]
    [InlineData("2026-03-01T10:00:00.12345678Z", false)]
    [InlineData("2026-03-01T24:00:00Z", false)]
    [InlineData("2026-03-01T10:60:00Z", false)]
    [InlineData("2026-03-01T10:00:00z", false)]
    [InlineData("2026-03-01 10:00:00Z", false)]
    [InlineData("2026-02-30T10:00:00Z", false)]
    public void Datetime_strict_format(string value, bool valid)
    {
        var schema = Schema("""[{"key":"at","control":"DATETIME"}]""");
        Run(schema, $"{{\"at\":\"{value}\"}}").IsValid.ShouldBe(valid);
    }

    [Fact]
    public void Date_rules_compare_chronologically()
    {
        var schema = Schema("""
            [{"key":"d","control":"DATE"},
             {"key":"late","control":"TEXT","showWhen":{"op":"gt","field":"d","value":"2026-06-30"}}]
            """);
        Run(schema, """{"d":"2026-07-01"}""").Visible["late"].ShouldBeTrue();
        Run(schema, """{"d":"2026-06-30"}""").Visible["late"].ShouldBeFalse();
        Run(schema, "{}").Visible["late"].ShouldBeFalse();
    }

    [Fact]
    public void Multiselect_accepts_only_offered_options_and_keeps_order()
    {
        var schema = Schema("""
            [{"key":"gate","control":"CHECKBOX"},
             {"key":"outputs","control":"MULTISELECT","options":[
                {"key":"pdf"},{"key":"tiff"},
                {"key":"native","availableWhen":{"op":"isTrue","field":"gate"}}]}]
            """);

        var ok = Run(schema, """{"gate":true,"outputs":["tiff","native","pdf"]}""");
        ok.Errors.ShouldBeEmpty();
        ok.Options["outputs"].ShouldBe(["pdf", "tiff", "native"]);
        ok.Normalized["outputs"].GetRawText().ShouldBe("""["tiff","native","pdf"]""");

        var unavailable = Run(schema, """{"gate":false,"outputs":["pdf","native","bogus"]}""");
        Codes(unavailable).ShouldBe(["outputs:OPTION_NOT_ALLOWED"]);
        unavailable.Normalized.ContainsKey("outputs").ShouldBeTrue();

        Codes(Run(schema, """{"outputs":["pdf","pdf"]}""")).ShouldBe(["outputs:INVALID_TYPE"]);
        Codes(Run(schema, """{"outputs":"pdf"}""")).ShouldBe(["outputs:INVALID_TYPE"]);
        Codes(Run(schema, """{"outputs":[1]}""")).ShouldBe(["outputs:INVALID_TYPE"]);
    }

    [Fact]
    public void Options_are_reported_for_hidden_fields_but_values_are_dropped()
    {
        var schema = Schema("""
            [{"key":"gate","control":"CHECKBOX"},
             {"key":"pick","control":"SELECT","showWhen":{"op":"isTrue","field":"gate"},"options":[{"key":"a"}]}]
            """);
        var result = Run(schema, """{"gate":false,"pick":"zzz"}""");
        result.Errors.ShouldBeEmpty();
        result.Options["pick"].ShouldBe(["a"]);
        result.Normalized.ContainsKey("pick").ShouldBeFalse();
    }

    [Fact]
    public void Required_checkbox_false_is_valid_but_draft_never_emits_required()
    {
        var schema = Schema("""[{"key":"agree","control":"CHECKBOX","required":true},{"key":"n","control":"NUMBER","required":true}]""");
        Run(schema, """{"agree":false,"n":0}""").Errors.ShouldBeEmpty();

        var draft = Run(schema, """{"n":"x"}""", FormEvaluationMode.Draft);
        Codes(draft).ShouldBe(["n:INVALID_TYPE"]);
        draft.Required["agree"].ShouldBeTrue();
    }

    [Fact]
    public void Number_equality_is_numeric_and_refs_require_positive_integers()
    {
        var schema = Schema("""
            [{"key":"n","control":"NUMBER"},
             {"key":"same","control":"TEXT","showWhen":{"op":"eq","field":"n","value":1}},
             {"key":"owner","control":"USER_REF"}]
            """);
        Run(schema, """{"n":1.0}""").Visible["same"].ShouldBeTrue();
        Run(schema, """{"owner":3.0}""").Errors.ShouldBeEmpty();
        Codes(Run(schema, """{"owner":0}""")).ShouldBe(["owner:INVALID_TYPE"]);
        Codes(Run(schema, """{"owner":-2}""")).ShouldBe(["owner:INVALID_TYPE"]);
        Codes(Run(schema, """{"owner":1.5}""")).ShouldBe(["owner:INVALID_TYPE"]);
        Codes(Run(schema, """{"owner":"3"}""")).ShouldBe(["owner:INVALID_TYPE"]);
        Codes(Run(schema, """{"owner":true}""")).ShouldBe(["owner:INVALID_TYPE"]);
    }

    [Fact]
    public void Pattern_uses_portable_semantics_and_patterns_outside_the_subset_are_rejected_at_compile_time()
    {
        var schema = Schema("""
            [{"key":"digits","control":"TEXT","validation":{"pattern":"^\\d+$"}}]
            """);
        Run(schema, """{"digits":"123"}""").Errors.ShouldBeEmpty();
        Codes(Run(schema, "{\"digits\":\"\\u0661\\u0662\"}")).ShouldBe(["digits:PATTERN"]);

        var broken = FormSchema.Compile(FormSchemaJson.ParseFields("""{"fields":[{"key":"broken","control":"TEXT","validation":{"pattern":"("}}]}"""));
        broken.IsValid.ShouldBeFalse();
        broken.Errors.Select(e => e.Code).ShouldBe([FormDefinitionErrorCode.InvalidPattern]);
    }

    [Theory]
    [InlineData("a.b", true)]
    [InlineData("^(?:[A-Z]{2}|\\d{3,})-[a-z0-9_.-]*?x$", true)]
    [InlineData("[a-z-]+", true)]
    [InlineData("a|", true)]
    [InlineData("(a+)?", true)]
    [InlineData("(a+)+", false)]
    [InlineData("(a*){2,}", false)]
    [InlineData("a{2,1}", false)]
    [InlineData("a{1000}", false)]
    [InlineData("a**", false)]
    [InlineData("a++", false)]
    [InlineData("^*", false)]
    [InlineData("\\bx*", true)]
    [InlineData("\\b*", false)]
    [InlineData("[\\b]", false)]
    [InlineData("[\\d-z]", false)]
    [InlineData("a)", false)]
    [InlineData("a]", false)]
    [InlineData("a}", false)]
    [InlineData("\\", false)]
    [InlineData("\\s", false)]
    [InlineData("\\1", false)]
    [InlineData("(?=a)", false)]
    [InlineData("[a", false)]
    public void Portable_subset_accepts_and_rejects_as_documented(string pattern, bool accepted)
    {
        PortablePattern.TryTranslate(pattern, out _).ShouldBe(accepted);
    }

    [Fact]
    public void Slow_but_portable_pattern_times_out_as_no_match_and_does_not_hang()
    {
        // Polynomial (n^5) backtracking is still in the subset (separated unbounded quantifiers); the timeout is the backstop.
        var schema = Schema("""[{"key":"t","control":"TEXT","validation":{"pattern":"^.*a.*a.*a.*a.*a.*b$"}}]""");

        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        var result = Run(schema, $"{{\"t\":\"{new string('a', 400)}\"}}");
        stopwatch.Stop();

        Codes(result).ShouldBe(["t:PATTERN"]);
        stopwatch.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(1));
    }

    [Fact]
    public void Regex_time_is_budgeted_per_evaluation_not_per_field()
    {
        // SEC-05 reproduction: 40 fields x 250 ms took 10 s. The budget (0.5 s) skips the remaining checks of the same evaluation.
        var fields = string.Join(',', Enumerable.Range(0, 40).Select(i => $$$"""{"key":"f{{{i}}}","control":"TEXT","validation":{"pattern":"^.*a.*a.*a.*a.*a.*b$"}}"""));
        var schema = Schema($"[{fields}]");
        var values = string.Join(',', Enumerable.Range(0, 40).Select(i => $"\"f{i}\":\"{new string('a', 400)}\""));

        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        var result = Run(schema, $"{{{values}}}");
        stopwatch.Stop();

        result.Errors.Count.ShouldBe(40);
        stopwatch.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(1.5));
    }

    [Theory]
    [InlineData("(a|aa)+$")]
    [InlineData("^(\\w|\\d)+$")]
    [InlineData("(a?){30}a{30}")]
    [InlineData("^(a+)+$")]
    [InlineData("^(a*)*$")]
    [InlineData("^(a{1,5}){1,5}$")]
    [InlineData("^(?:png|jpg)*$")]
    [InlineData("^a*a*b$")]
    [InlineData("^[A-Z]+[0-9]*$")]
    public void Backtracking_hazard_patterns_are_rejected_at_publish(string pattern)
    {
        PortablePattern.TryTranslate(pattern, out _).ShouldBeFalse(pattern);

        var fields = $"{{\"fields\":[{{\"key\":\"t\",\"control\":\"TEXT\",\"validation\":{{\"pattern\":{System.Text.Json.JsonSerializer.Serialize(pattern)}}}}}]}}";
        FormSchema.Compile(FormSchemaJson.ParseFields(fields)).Errors.Select(e => e.Code).ShouldContain(FormDefinitionErrorCode.InvalidPattern);
    }

    [Theory]
    [InlineData("^(\\d{3}-){2}\\d{4}$")]
    [InlineData("^(?:png|jpg)?\\.[a-z]{3}$")]
    [InlineData("^(a+)?b$")]
    [InlineData("^\\d+\\.\\d+$")]
    [InlineData("^[A-Z]+\\d{1,10}$")]
    [InlineData("^.*foo.*bar.*$")]
    public void Safe_shapes_stay_in_the_subset(string pattern) => PortablePattern.TryTranslate(pattern, out _).ShouldBeTrue(pattern);

    [Fact]
    public void Text_without_max_length_is_capped_by_the_platform_default()
    {
        var schema = Schema("""[{"key":"t","control":"TEXT"},{"key":"a","control":"TEXTAREA"},{"key":"u","control":"TEXT","validation":{"maxLength":5000}}]""");

        Codes(Run(schema, $"{{\"t\":\"{new string('x', 1000)}\",\"a\":\"{new string('x', 20000)}\",\"u\":\"{new string('x', 4000)}\"}}")).ShouldBeEmpty();
        Codes(Run(schema, $"{{\"t\":\"{new string('x', 1001)}\",\"a\":\"{new string('x', 20001)}\"}}")).ShouldBe(["a:TOO_LONG", "t:TOO_LONG"]);
    }

    [Fact]
    public void Hidden_field_cascade_and_section_chain()
    {
        var schema = Schema("""
            [{"key":"gate","control":"CHECKBOX"},
             {"key":"sec","control":"SECTION_HEADING","showWhen":{"op":"isTrue","field":"gate"}},
             {"key":"inner","control":"TEXT","section":"sec","required":true},
             {"key":"dependent","control":"TEXT","required":true,"showWhen":{"op":"isNotEmpty","field":"inner"}}]
            """);
        var hidden = Run(schema, """{"gate":false,"inner":"v","dependent":"w"}""");
        hidden.Errors.ShouldBeEmpty();
        hidden.Visible["inner"].ShouldBeFalse();
        hidden.Visible["dependent"].ShouldBeFalse();
        hidden.Normalized.Count.ShouldBe(1);

        Codes(Run(schema, """{"gate":true,"inner":"v"}""")).ShouldBe(["dependent:REQUIRED"]);
    }

    [Fact]
    public void Evaluation_does_not_depend_on_field_order()
    {
        var schema = Schema("""
            [{"key":"c","control":"TEXT","required":true,"showWhen":{"op":"isTrue","field":"b"}},
             {"key":"b","control":"CHECKBOX","showWhen":{"op":"isTrue","field":"a"}},
             {"key":"a","control":"CHECKBOX"}]
            """);
        var result = Run(schema, """{"a":true,"b":true}""");
        result.Visible["c"].ShouldBeTrue();
        Codes(result).ShouldBe(["c:REQUIRED"]);
    }

    [Fact]
    public void Compile_reports_each_definition_problem_class_and_never_throws_on_odd_rule_json()
    {
        var bad = FormSchema.Compile(FormSchemaJson.ParseFields("""
            {"fields":[
              {"key":"a","control":"TEXT","showWhen":"nope"},
              {"key":"b","control":"TEXT","showWhen":{"op":"in","field":"a","value":[]}},
              {"key":"c","control":"CHECKBOX","showWhen":{"op":"eq","field":"a","value":true}},
              {"key":"d","control":"DATETIME"},
              {"key":"e","control":"TEXT","showWhen":{"op":"eq","field":"d","value":"x"}}]}
            """));
        bad.IsValid.ShouldBeFalse();
        bad.Errors.Select(e => e.Code).Distinct().Order().ShouldBe(
            [FormDefinitionErrorCode.SchemaViolation, FormDefinitionErrorCode.OperatorTypeMismatch, FormDefinitionErrorCode.LiteralTypeMismatch]);
    }

    [Fact]
    public void Values_round_trip_through_json_and_report_unknown_keys()
    {
        var values = FormValues.FromJson("""{"requires_ocr":true,"ocr_language":"eng","volume":120.5,"outputs":["pdf","tiff"],"src_asset":42}""");
        values.Count.ShouldBe(5);
        values.ToJson().ShouldBe("""{"requires_ocr":true,"ocr_language":"eng","volume":120.5,"outputs":["pdf","tiff"],"src_asset":42}""");
        values.Without("volume").ContainsKey("volume").ShouldBeFalse();
        FormValues.FromJson(null).Count.ShouldBe(0);
        Should.Throw<FormatException>(() => FormValues.FromJson("[1]"));
    }

    [Fact]
    public void Index_extraction_is_typed_per_filterable_field()
    {
        var schema = Schema("""
            [{"key":"title","control":"TEXT","isFilterable":true},
             {"key":"volume","control":"NUMBER","isFilterable":true},
             {"key":"urgent","control":"CHECKBOX","isFilterable":true},
             {"key":"due","control":"DATE","isFilterable":true},
             {"key":"seen_at","control":"DATETIME","isFilterable":true},
             {"key":"mode","control":"SELECT","isFilterable":true,"options":[{"key":"fast"}]},
             {"key":"outputs","control":"MULTISELECT","isFilterable":true,"options":[{"key":"pdf"},{"key":"tiff"}]},
             {"key":"asset","control":"ASSET_REF","isFilterable":true},
             {"key":"free","control":"TEXT"},
             {"key":"missing","control":"NUMBER","isFilterable":true}]
            """);
        var result = Run(schema, """
            {"title":"T","volume":120.5,"urgent":false,"due":"2026-03-01","seen_at":"2026-03-01T10:00:00Z",
             "mode":"fast","outputs":["tiff","pdf"],"asset":42,"free":"ignored"}
            """);
        result.Errors.ShouldBeEmpty();

        var entries = FormIndexExtractor.Extract(schema, result.Normalized);
        entries.ShouldBe(
        [
            new FormIndexEntry("title", ValueText: "T"),
            new FormIndexEntry("volume", ValueNumber: 120.5m),
            new FormIndexEntry("urgent", ValueBool: false),
            new FormIndexEntry("due", ValueDate: new DateOnly(2026, 3, 1)),
            new FormIndexEntry("seen_at", ValueDateTime: new DateTime(2026, 3, 1, 10, 0, 0, DateTimeKind.Utc)),
            new FormIndexEntry("mode", ValueText: "fast"),
            new FormIndexEntry("outputs", ValueText: "tiff"),
            new FormIndexEntry("outputs", ValueText: "pdf"),
            new FormIndexEntry("asset", ValueNumber: 42m),
        ]);
    }

    [Fact]
    public void Asset_forms_index_every_number_and_select_field_but_other_non_filterable_fields_stay_out()
    {
        var schema = Schema("""
            [{"key":"size_gb","control":"NUMBER"},
             {"key":"kind","control":"SELECT","options":[{"key":"a"},{"key":"b"}]},
             {"key":"flag","control":"CHECKBOX"},
             {"key":"note","control":"TEXT"},
             {"key":"pages","control":"NUMBER","isFilterable":true}]
            """);
        var result = Run(schema, """{"size_gb":3.5,"kind":"b","flag":true,"note":"x","pages":7}""");
        result.Errors.ShouldBeEmpty();

        FormIndexExtractor.Extract(schema, result.Normalized, alwaysIndexNumberAndSelect: true).ShouldBe(
        [
            new FormIndexEntry("size_gb", ValueNumber: 3.5m),
            new FormIndexEntry("kind", ValueText: "b"),
            new FormIndexEntry("pages", ValueNumber: 7m),
        ]);

        // Without the rule only the filterable field is indexed (unchanged behaviour for every other owner).
        FormIndexExtractor.Extract(schema, result.Normalized).ShouldBe([new FormIndexEntry("pages", ValueNumber: 7m)]);
    }
}
