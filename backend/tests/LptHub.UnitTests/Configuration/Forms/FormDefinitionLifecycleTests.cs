using System.Text.Json;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Configuration.Domain.Forms;
using MatterFlow.Configuration.Domain.Forms.Rules;
using MatterFlow.SharedKernel.Results;
using Shouldly;

namespace MatterFlow.UnitTests.Configuration.Forms;

public class FormDefinitionLifecycleTests
{
    private static JsonElement J(string json) => JsonDocument.Parse(json).RootElement.Clone();

    private static FormFieldSpec F(
        string key,
        string control = "TEXT",
        string? showWhen = null,
        string? requiredWhen = null,
        string? validation = null,
        string? defaultValue = null,
        bool filterable = false,
        string? section = null,
        string[]? options = null) => new()
        {
            Key = key,
            Label = key.ToUpperInvariant(),
            Control = control,
            ShowWhen = showWhen is null ? null : J(showWhen),
            RequiredWhen = requiredWhen is null ? null : J(requiredWhen),
            Validation = validation is null ? null : J(validation),
            Default = defaultValue is null ? null : J(defaultValue),
            IsFilterable = filterable,
            Section = section,
            Options = [.. (options ?? []).Select(o => new FormOptionSpec(o, o.ToUpperInvariant()))],
        };

    private static readonly IReadOnlyDictionary<string, FormControl> NoPrior = new Dictionary<string, FormControl>();

    private static string[] Codes(FormPublishValidator.Outcome outcome) => [.. outcome.Issues.Select(i => i.Code).Distinct().Order(StringComparer.Ordinal)];

    // ---- publish validator

    [Fact]
    public void Valid_definition_compiles_to_a_schema()
    {
        var outcome = FormPublishValidator.Validate(
            [
                F("kind", "SELECT", options: ["a", "b"], filterable: true),
                F("detail", showWhen: """{"op":"eq","field":"kind","value":"a"}""", defaultValue: "\"x\""),
                F("size", "NUMBER", validation: """{"min":0,"max":10}""", defaultValue: "5"),
            ],
            NoPrior);

        outcome.IsValid.ShouldBeTrue(string.Join("; ", outcome.Issues.Select(i => i.Message)));
        outcome.Schema.ShouldNotBeNull();
    }

    [Fact]
    public void An_empty_form_can_be_published()
    {
        FormPublishValidator.Validate([], NoPrior).IsValid.ShouldBeTrue();
    }

    [Fact]
    public void Cyclic_dangling_and_self_references_use_the_contract_codes()
    {
        var outcome = FormPublishValidator.Validate(
            [
                F("a", showWhen: """{"op":"isNotEmpty","field":"b"}"""),
                F("b", showWhen: """{"op":"isNotEmpty","field":"a"}"""),
                F("c", showWhen: """{"op":"eq","field":"ghost","value":"x"}"""),
                F("d", showWhen: """{"op":"isNotEmpty","field":"d"}"""),
            ],
            NoPrior);

        outcome.IsValid.ShouldBeFalse();
        outcome.Schema.ShouldBeNull();
        Codes(outcome).ShouldBe(["CIRCULAR_DEPENDENCY", "SELF_REFERENCE", "UNKNOWN_FIELD_REFERENCE"]);
        outcome.Issues.Single(i => i.Code == "UNKNOWN_FIELD_REFERENCE").FieldKey.ShouldBe("c");
    }

    [Fact]
    public void Filterable_fields_are_limited_to_five_and_to_value_controls()
    {
        var many = Enumerable.Range(1, 6).Select(i => F($"f{i}", filterable: true)).Append(F("note", "HELP_TEXT", filterable: true)).ToList();

        var outcome = FormPublishValidator.Validate(many, NoPrior);

        Codes(outcome).ShouldBe([FormPublishCodes.InvalidFilterableField, FormPublishCodes.TooManyFilterableFields]);
        FormPublishValidator.Validate([.. Enumerable.Range(1, 5).Select(i => F($"f{i}", filterable: true))], NoPrior).IsValid.ShouldBeTrue();
    }

    [Fact]
    public void A_field_key_cannot_change_data_type_between_versions_but_may_switch_within_a_family()
    {
        var prior = new Dictionary<string, FormControl> { ["qty"] = FormControl.Number, ["body"] = FormControl.Text, ["pick"] = FormControl.Select };

        FormPublishValidator.Validate([F("qty", "TEXT")], prior).Issues.Select(i => i.Code).ShouldBe([FormPublishCodes.FieldTypeChanged]);
        FormPublishValidator.Validate([F("body", "TEXTAREA"), F("pick", "RADIO", options: ["a"])], prior).IsValid.ShouldBeTrue();
        FormPublishValidator.Validate([F("pick", "MULTISELECT", options: ["a"])], prior).Issues.Select(i => i.Code).ShouldBe([FormPublishCodes.FieldTypeChanged]);
        FormPublishValidator.Validate([F("brand_new", "DATE")], prior).IsValid.ShouldBeTrue();
    }

    [Theory]
    [InlineData("NUMBER", """{"max":5}""", "9")]
    [InlineData("NUMBER", null, "\"nine\"")]
    [InlineData("TEXT", """{"maxLength":3}""", "\"toolong\"")]
    [InlineData("TEXT", """{"pattern":"^[0-9]+$"}""", "\"abc\"")]
    [InlineData("SELECT", null, "\"zzz\"")]
    [InlineData("HELP_TEXT", null, "\"x\"")]
    public void Invalid_defaults_are_rejected(string control, string? validation, string defaultValue)
    {
        var outcome = FormPublishValidator.Validate([F("f", control, validation: validation, defaultValue: defaultValue, options: control == "SELECT" ? ["a"] : null)], NoPrior);

        Codes(outcome).ShouldBe([FormPublishCodes.InvalidDefault]);
    }

    [Fact]
    public void A_default_is_checked_even_when_the_field_is_hidden_by_default()
    {
        var outcome = FormPublishValidator.Validate(
            [F("flag", "CHECKBOX"), F("count", "NUMBER", showWhen: """{"op":"isTrue","field":"flag"}""", validation: """{"max":3}""", defaultValue: "30")],
            NoPrior);

        Codes(outcome).ShouldBe([FormPublishCodes.InvalidDefault]);
    }

    [Fact]
    public void Missing_labels_are_reported_at_publish()
    {
        var spec = F("a") with { Label = " " };

        FormPublishValidator.Validate([spec], NoPrior).Issues.Select(i => i.Code).ShouldBe([FormPublishCodes.LabelRequired]);
    }

    [Fact]
    public void Section_membership_and_cycles_through_sections_are_checked()
    {
        var outcome = FormPublishValidator.Validate(
            [
                F("head", "SECTION_HEADING", showWhen: """{"op":"isNotEmpty","field":"inside"}"""),
                F("inside", section: "head"),
            ],
            NoPrior);

        Codes(outcome).ShouldBe(["CIRCULAR_DEPENDENCY"]);
    }

    // ---- draft checker

    [Fact]
    public void Draft_checker_accepts_a_well_formed_draft_even_with_semantic_problems()
    {
        // Cycles and dangling references are publish-time problems; a draft with them can be saved.
        FormDraftChecker.Check([F("a", showWhen: """{"op":"isNotEmpty","field":"b"}"""), F("b", showWhen: """{"op":"isNotEmpty","field":"a"}""")]).ShouldBeEmpty();
    }

    [Fact]
    public void Draft_checker_reports_shape_problems_with_request_paths()
    {
        var issues = FormDraftChecker.Check(
        [
            F("Bad Key"),
            F("dup"),
            F("dup"),
            F("odd", "WIDGET"),
            F("pick", "SELECT", showWhen: "\"nope\"", options: ["a", "a", "bad key"]),
            F("long") with { Label = new string('x', 201) },
        ]);

        issues.Select(i => (i.Path, i.Code)).ShouldBe(
            [
                ("fields[0].key", "INVALID_FIELD_KEY"),
                ("fields[2].key", "DUPLICATE_FIELD_KEY"),
                ("fields[3].control", "UNKNOWN_CONTROL"),
                ("fields[4].showWhen", "SCHEMA_VIOLATION"),
                ("fields[4].options[1].key", "DUPLICATE_OPTION_KEY"),
                ("fields[4].options[2].key", "INVALID_OPTION_KEY"),
                ("fields[5].label", "INVALID_LABEL"),
            ],
            ignoreOrder: true);
    }

    // ---- specs

    [Fact]
    public void Specs_convert_to_rule_definitions_with_all_members()
    {
        var specs = new[]
        {
            F("kind", "SELECT", options: ["a"], filterable: true) with { Required = true },
            F("note", showWhen: """{"op":"eq","field":"kind","value":"a"}""", validation: """{"maxLength":20,"pattern":"^a","patternMessage":"Starts with a"}"""),
        };

        var definitions = FormSpecs.ToDefinitions(specs);

        definitions.Select(d => d.Key).ShouldBe(["kind", "note"]);
        definitions[0].Control.ShouldBe(FormControl.Select);
        definitions[0].Required.ShouldBeTrue();
        definitions[0].IsFilterable.ShouldBeTrue();
        definitions[0].Options.Select(o => o.Key).ShouldBe(["a"]);
        definitions[1].ShowWhen.ShouldNotBeNull();
        definitions[1].Validation!.MaxLength.ShouldBe(20);
        definitions[1].Validation!.Pattern.ShouldBe("^a");
        FormSchema.Compile(definitions).IsValid.ShouldBeTrue();
    }

    [Fact]
    public void Specs_survive_an_entity_round_trip()
    {
        var specs = new[]
        {
            F("kind", "SELECT", options: ["a", "b"], filterable: true),
            F("note", showWhen: """{"op":"eq","field":"kind","value":"a"}""", defaultValue: "\"hi\"") with { HelpText = "Hint", Section = null },
        };

        var back = FormSpecs.FromEntities(FormSpecs.ToEntities(specs));

        FormDiff.Compare(specs, back).ShouldBeEmpty();
        back.Select(s => s.Key).ShouldBe(["kind", "note"]);
        back[1].HelpText.ShouldBe("Hint");
        back[0].Options.Select(o => o.Key).ShouldBe(["a", "b"]);
    }

    // ---- diff

    [Fact]
    public void Diff_lists_added_removed_and_changed_fields()
    {
        var older = new[] { F("a"), F("b", "NUMBER"), F("c", "CHECKBOX"), F("d", "SELECT", options: ["x"]) };
        var newer = new[]
        {
            F("c", "CHECKBOX"),
            F("a") with { Required = true, HelpText = "hint" },
            F("e", "DATE"),
            F("d", "SELECT", options: ["x", "y"]),
        };

        var changes = FormDiff.Compare(older, newer).ToDictionary(c => c.FieldKey);

        changes.Keys.ShouldBe(["a", "c", "d", "e", "b"], ignoreOrder: true);
        changes["e"].Kind.ShouldBe(FormFieldChangeKind.Added);
        changes["b"].Kind.ShouldBe(FormFieldChangeKind.Removed);
        changes["a"].Details.ShouldBe(["required", "helpText", "order"], ignoreOrder: true);
        changes["c"].Details.ShouldBe(["order"]);
        changes["d"].Details.ShouldBe(["options"]);
    }

    [Fact]
    public void Diff_ignores_json_whitespace_and_member_order()
    {
        var a = F("a", showWhen: """{"op":"eq","field":"b","value":1}""");
        var b = F("a", showWhen: """{ "value": 1, "field": "b", "op": "eq" }""");

        FormDiff.Compare([a], [b]).ShouldBeEmpty();
    }

    // ---- wire names and contract helpers

    [Fact]
    public void Enums_map_to_upper_snake_names_and_back()
    {
        WireNames.ToWire(FormOwnerKind.AssetType).ShouldBe("ASSET_TYPE");
        WireNames.ToWire(FormOwnerKind.Step).ShouldBe("STEP");
        WireNames.ToWire(FormVersionStatus.Published).ShouldBe("PUBLISHED");
        WireNames.ToWire(FormValueOwnerKind.StepInstance).ShouldBe("STEP_INSTANCE");
        WireNames.Parse<FormOwnerKind>("TASK_TYPE").ShouldBe(FormOwnerKind.TaskType);
        WireNames.TryParse<FormVersionStatus>("nope", out _).ShouldBeFalse();
    }

    [Fact]
    public void Changed_fields_compare_json_text()
    {
        var existing = new Dictionary<string, JsonElement> { ["a"] = J("1"), ["b"] = J("\"x\"") };
        var submitted = new Dictionary<string, JsonElement> { ["a"] = J("1"), ["b"] = J("\"y\""), ["c"] = J("true") };

        FormSubmissionOptions.ChangedFieldsOf(submitted, existing).ShouldBe(["b", "c"], ignoreOrder: true);
        FormSubmissionOptions.ChangedFieldsOf(submitted, null).Count.ShouldBe(3);
    }

    [Fact]
    public void Submission_errors_become_a_form_validation_failed_error_keyed_by_field()
    {
        var result = new FormSubmissionResult(
            1,
            1,
            [new FormSubmissionError("a", "REQUIRED", "A is required"), new FormSubmissionError("a", "PATTERN", "bad"), new FormSubmissionError("b", "OUT_OF_RANGE", "range")],
            new Dictionary<string, JsonElement>(),
            [],
            []);

        var error = result.ToError();

        error.ShouldNotBeNull();
        error.Code.ShouldBe(ErrorCodes.FormValidationFailed);
        error.Type.ShouldBe(ErrorType.Validation);
        error.FieldErrors!.Keys.ShouldBe(["form:a", "form:b"]);
        error.FieldErrors["form:a"].Select(e => e.Code).ShouldBe(["REQUIRED", "PATTERN"]);
        new FormSubmissionResult(1, 1, [], new Dictionary<string, JsonElement>(), [], []).ToError().ShouldBeNull();
    }
}
