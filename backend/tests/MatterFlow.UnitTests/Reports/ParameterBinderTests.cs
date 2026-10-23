using System.Data;
using System.Text.Json;
using MatterFlow.Reports.Domain;
using MatterFlow.Reports.Domain.Parameters;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>Server-side coercion of every parameter type, boundary values, built-ins, defaults and error names (spec 5.1, 5.3; issue #694).</summary>
public class ParameterBinderTests
{
    private static readonly BuiltInContext Ctx = new(7, "Ann Example", new DateOnly(2026, 10, 22), new DateTime(2026, 10, 22, 14, 30, 0, DateTimeKind.Utc), [3, 5], 3, -240);

    private static JsonElement J(string json) => JsonDocument.Parse(json).RootElement.Clone();

    private static Dictionary<string, JsonElement> Values(params (string Name, string Json)[] values) => values.ToDictionary(v => v.Name, v => J(v.Json), StringComparer.Ordinal);

    private static ReportParameterDefinition Def(string name, ReportParameterType type, Func<ReportParameterDefinition, ReportParameterDefinition>? configure = null)
    {
        var d = new ReportParameterDefinition { Name = name, Type = type, Label = name };
        return configure is null ? d : configure(d);
    }

    private static BindResult Bind(ReportParameterDefinition def, params (string Name, string Json)[] values) => ParameterBinder.Bind([def], Values(values), Ctx, null);

    private static BoundParameter Only(BindResult r)
    {
        r.Errors.ShouldBeEmpty(string.Join("; ", r.Errors.Select(e => e.Code + " " + e.Message)));
        return r.Parameters.ShouldHaveSingleItem();
    }

    private static ParameterError OnlyError(BindResult r, string name, string code)
    {
        r.Parameters.ShouldBeEmpty();
        var e = r.Errors.ShouldHaveSingleItem();
        e.Name.ShouldBe(name);
        e.Code.ShouldBe(code);
        return e;
    }

    // ---- number ----

    [Theory]
    [InlineData("0", "0")]
    [InlineData("12.5", "12.5")]
    [InlineData("-3", "-3")]
    [InlineData("\"12.50\"", "12.50")]
    [InlineData("9999999999999999999999999999", "9999999999999999999999999999")]
    [InlineData("0.0000000001", "0.0000000001")]
    public void Numbers_bind_as_decimal_38_10(string json, string expected)
    {
        var p = Only(Bind(Def("N", ReportParameterType.Number), ("n", json)));

        p.DbType.ShouldBe(SqlDbType.Decimal);
        (p.Precision, p.Scale).ShouldBe(((byte)38, (byte)10));
        p.Value.ShouldBe(decimal.Parse(expected, System.Globalization.CultureInfo.InvariantCulture));
    }

    [Theory]
    [InlineData("\"abc\"", ParameterErrorCodes.InvalidType)]
    [InlineData("true", ParameterErrorCodes.InvalidType)]
    [InlineData("[1]", ParameterErrorCodes.InvalidType)]
    [InlineData("{}", ParameterErrorCodes.InvalidType)]
    [InlineData("1e500", ParameterErrorCodes.InvalidType)]
    [InlineData("\"1; DROP TABLE x\"", ParameterErrorCodes.InvalidType)]
    [InlineData("\"0x10\"", ParameterErrorCodes.InvalidType)]
    [InlineData("0.00000000001", ParameterErrorCodes.OutOfRange)]
    [InlineData("10000000000000000000000000000", ParameterErrorCodes.OutOfRange)]
    public void Invalid_numbers_are_refused_with_the_parameter_name(string json, string code)
    {
        OnlyError(Bind(Def("N", ReportParameterType.Number), ("N", json)), "N", code);
    }

    [Fact]
    public void Integer_only_numbers_bind_as_bigint_and_refuse_fractions()
    {
        var def = Def("N", ReportParameterType.Number, d => d with { IntegerOnly = true });

        var p = Only(Bind(def, ("N", "9223372036854775807")));
        p.DbType.ShouldBe(SqlDbType.BigInt);
        p.Value.ShouldBe(long.MaxValue);
        Only(Bind(def, ("N", "-9223372036854775808"))).Value.ShouldBe(long.MinValue);
        Only(Bind(def, ("N", "5.0"))).Value.ShouldBe(5L);
        OnlyError(Bind(def, ("N", "5.5")), "N", ParameterErrorCodes.InvalidType);
        OnlyError(Bind(def, ("N", "9223372036854775808")), "N", ParameterErrorCodes.InvalidType);
    }

    [Fact]
    public void Number_min_and_max_are_inclusive()
    {
        var def = Def("N", ReportParameterType.Number, d => d with { Min = 1, Max = 10 });

        Only(Bind(def, ("N", "1")));
        Only(Bind(def, ("N", "10")));
        OnlyError(Bind(def, ("N", "0.9999")), "N", ParameterErrorCodes.OutOfRange);
        OnlyError(Bind(def, ("N", "10.0001")), "N", ParameterErrorCodes.OutOfRange);
    }

    // ---- date ----

    [Theory]
    [InlineData("\"2026-10-22\"", "2026-10-22")]
    [InlineData("\"0001-01-01\"", "0001-01-01")]
    [InlineData("\"9999-12-31\"", "9999-12-31")]
    [InlineData("\"2024-02-29\"", "2024-02-29")]
    [InlineData("\"today\"", "2026-10-22")]
    [InlineData("\"today-30\"", "2026-09-22")]
    [InlineData("\"startOfMonth\"", "2026-10-01")]
    public void Dates_bind_as_date(string json, string expected)
    {
        var p = Only(Bind(Def("D", ReportParameterType.Date), ("D", json)));

        p.DbType.ShouldBe(SqlDbType.Date);
        ((DateTime)p.Value!).ShouldBe(DateTime.Parse(expected, System.Globalization.CultureInfo.InvariantCulture));
    }

    [Theory]
    [InlineData("\"2026-02-30\"")]
    [InlineData("\"2025-02-29\"")]
    [InlineData("\"22/10/2026\"")]
    [InlineData("\"2026-10-22T10:00:00\"")]
    [InlineData("\"2026-1-5\"")]
    [InlineData("\"yesterday\"")]
    [InlineData("20261022")]
    [InlineData("\"'; DROP TABLE x; --\"")]
    public void Invalid_dates_are_refused(string json)
    {
        OnlyError(Bind(Def("D", ReportParameterType.Date), ("D", json)), "D", ParameterErrorCodes.InvalidDate);
    }

    // ---- text ----

    [Fact]
    public void Text_binds_as_nvarchar_400_unchanged_and_enforces_the_length()
    {
        var def = Def("Q", ReportParameterType.Text);
        var quote = "O'Brien \" -- ; ’ ＇ DROP TABLE x";

        var p = Only(Bind(def, ("Q", JsonSerializer.Serialize(quote))));
        p.DbType.ShouldBe(SqlDbType.NVarChar);
        p.Size.ShouldBe(400);
        p.Value.ShouldBe(quote);

        Only(Bind(def, ("Q", JsonSerializer.Serialize(new string('x', 400)))));
        OnlyError(Bind(def, ("Q", JsonSerializer.Serialize(new string('x', 401)))), "Q", ParameterErrorCodes.TooLong);
        OnlyError(Bind(def, ("Q", "5")), "Q", ParameterErrorCodes.InvalidType);
        OnlyError(Bind(def, ("Q", "\"a\\u0000b\"")), "Q", ParameterErrorCodes.InvalidType);
    }

    [Fact]
    public void Text_max_length_setting_lowers_the_limit_but_never_raises_it_above_400()
    {
        var short5 = Def("Q", ReportParameterType.Text, d => d with { MaxLength = 5 });
        var big = Def("Q", ReportParameterType.Text, d => d with { MaxLength = 5000 });

        Only(Bind(short5, ("Q", "\"12345\"")));
        OnlyError(Bind(short5, ("Q", "\"123456\"")), "Q", ParameterErrorCodes.TooLong);
        OnlyError(Bind(big, ("Q", JsonSerializer.Serialize(new string('x', 401)))), "Q", ParameterErrorCodes.TooLong);
    }

    // ---- yes/no ----

    [Theory]
    [InlineData("true", true)]
    [InlineData("false", false)]
    [InlineData("\"true\"", true)]
    [InlineData("\"false\"", false)]
    public void Yes_no_binds_as_bit(string json, bool expected)
    {
        var p = Only(Bind(Def("Y", ReportParameterType.YesNo), ("Y", json)));

        p.DbType.ShouldBe(SqlDbType.Bit);
        p.Value.ShouldBe(expected);
    }

    [Theory]
    [InlineData("1")]
    [InlineData("\"yes\"")]
    [InlineData("[]")]
    public void Yes_no_refuses_everything_else(string json)
    {
        OnlyError(Bind(Def("Y", ReportParameterType.YesNo), ("Y", json)), "Y", ParameterErrorCodes.InvalidType);
    }

    // ---- single choice ----

    private static ReportParameterDefinition TextChoice(bool multi = false) =>
        Def("C", multi ? ReportParameterType.Multi : ReportParameterType.Single, d => d with
        {
            ValueType = ChoiceValueType.Text,
            OptionsKind = OptionsKind.Fixed,
            Options = [new("Open", "Open"), new("O'Neil", "O'Neil"), new("x\" OR 1=1 --", "tricky")],
        });

    private static ReportParameterDefinition IntChoice(bool multi = false) =>
        Def("C", multi ? ReportParameterType.Multi : ReportParameterType.Single, d => d with
        {
            ValueType = ChoiceValueType.Int,
            OptionsKind = OptionsKind.Fixed,
            Options = [new("1", "One"), new("2", "Two"), new("-5", "Minus")],
        });

    [Fact]
    public void A_single_text_choice_must_be_in_the_list_and_binds_the_listed_text()
    {
        var def = TextChoice();

        var p = Only(Bind(def, ("C", "\"O'Neil\"")));
        p.DbType.ShouldBe(SqlDbType.NVarChar);
        p.Size.ShouldBe(200);
        p.Value.ShouldBe("O'Neil");
        Only(Bind(def, ("C", "\"x\\\" OR 1=1 --\""))).Value.ShouldBe("x\" OR 1=1 --");
        OnlyError(Bind(def, ("C", "\"open\"")), "C", ParameterErrorCodes.NotInOptions); // case-sensitive: the list decides
        OnlyError(Bind(def, ("C", "\"Open' OR '1'='1\"")), "C", ParameterErrorCodes.NotInOptions);
        OnlyError(Bind(def, ("C", "\"Αpen\"")), "C", ParameterErrorCodes.NotInOptions);
        OnlyError(Bind(def, ("C", JsonSerializer.Serialize(new string('x', 5000)))), "C", ParameterErrorCodes.NotInOptions);
        OnlyError(Bind(def, ("C", "true")), "C", ParameterErrorCodes.NotInOptions);
    }

    [Fact]
    public void A_single_int_choice_binds_as_int_from_a_number_or_numeric_text()
    {
        var def = IntChoice();

        Only(Bind(def, ("C", "2"))).Value.ShouldBe(2);
        Only(Bind(def, ("C", "\"-5\""))).Value.ShouldBe(-5);
        Only(Bind(def, ("C", "1"))).DbType.ShouldBe(SqlDbType.Int);
        OnlyError(Bind(def, ("C", "3")), "C", ParameterErrorCodes.NotInOptions);
        OnlyError(Bind(def, ("C", "1.5")), "C", ParameterErrorCodes.NotInOptions);
        OnlyError(Bind(def, ("C", "\"1 OR 1=1\"")), "C", ParameterErrorCodes.NotInOptions);
        OnlyError(Bind(def, ("C", "4294967297")), "C", ParameterErrorCodes.NotInOptions);
    }

    [Fact]
    public void A_choice_with_no_options_accepts_nothing()
    {
        var def = Def("C", ReportParameterType.Single);

        OnlyError(Bind(def, ("C", "\"a\"")), "C", ParameterErrorCodes.NotInOptions);
    }

    // ---- multi choice and multi lookup ----

    [Fact]
    public void Multi_choice_binds_one_json_array_in_order_without_duplicates()
    {
        var text = Only(Bind(TextChoice(multi: true), ("C", "[\"Open\",\"O'Neil\",\"Open\"]")));
        text.DbType.ShouldBe(SqlDbType.NVarChar);
        text.Size.ShouldBe(-1);
        text.ListKind.ShouldBe(ListKind.Text);
        JsonSerializer.Deserialize<string[]>((string)text.Value!).ShouldBe(["Open", "O'Neil"]); // the writer escapes ' as \u0027; it is still the same JSON string

        var ints = Only(Bind(IntChoice(multi: true), ("C", "[2,\"1\",2]")));
        ints.ListKind.ShouldBe(ListKind.Int);
        ints.Value.ShouldBe("[2,1]");
    }

    [Fact]
    public void A_multi_choice_array_is_built_by_the_serializer_so_quotes_and_unicode_stay_inside_their_string()
    {
        var p = Only(Bind(TextChoice(multi: true), ("C", "[\"x\\\" OR 1=1 --\"]")));

        var parsed = JsonDocument.Parse((string)p.Value!).RootElement;
        parsed.GetArrayLength().ShouldBe(1);
        parsed[0].GetString().ShouldBe("x\" OR 1=1 --");
    }

    [Fact]
    public void An_empty_selection_binds_an_empty_array_unless_the_parameter_is_required()
    {
        Only(Bind(TextChoice(multi: true), ("C", "[]"))).Value.ShouldBe("[]");
        Only(Bind(TextChoice(multi: true))).Value.ShouldBe("[]");
        OnlyError(Bind(TextChoice(multi: true) with { IsRequired = true }, ("C", "[]")), "C", ParameterErrorCodes.Required);
        OnlyError(Bind(TextChoice(multi: true) with { IsRequired = true }), "C", ParameterErrorCodes.Required);
    }

    [Theory]
    [InlineData("\"Open\"")]
    [InlineData("{}")]
    [InlineData("5")]
    public void A_multi_choice_must_be_an_array(string json)
    {
        OnlyError(Bind(TextChoice(multi: true), ("C", json)), "C", ParameterErrorCodes.InvalidType);
    }

    [Fact]
    public void One_bad_element_refuses_the_whole_list()
    {
        OnlyError(Bind(TextChoice(multi: true), ("C", "[\"Open\",\"nope\"]")), "C", ParameterErrorCodes.NotInOptions);
        OnlyError(Bind(IntChoice(multi: true), ("C", "[1,[2]]")), "C", ParameterErrorCodes.NotInOptions);
    }

    [Theory]
    [InlineData(0, true)]
    [InlineData(1, true)]
    [InlineData(200, true)]
    [InlineData(201, false)]
    public void The_default_selection_cap_is_200(int count, bool ok)
    {
        var def = Def("L", ReportParameterType.Lookup, d => d with { LookupKind = LookupKind.Matter, LookupMulti = true });
        var json = "[" + string.Join(",", Enumerable.Range(1, count)) + "]";

        if (ok)
            Only(Bind(def, ("L", json)));
        else
            OnlyError(Bind(def, ("L", json)), "L", ParameterErrorCodes.TooMany);
    }

    [Theory]
    [InlineData(1000, true)]
    [InlineData(1001, false)]
    public void The_selection_cap_can_be_raised_but_never_above_1000(int count, bool ok)
    {
        var def = Def("L", ReportParameterType.Lookup, d => d with { LookupKind = LookupKind.Matter, LookupMulti = true, MaxSelected = 5000 });
        var json = "[" + string.Join(",", Enumerable.Range(1, count)) + "]";

        var result = Bind(def, ("L", json));
        if (ok)
            Only(result).Value.ShouldBe(json);
        else
            OnlyError(result, "L", ParameterErrorCodes.TooMany);
    }

    // ---- lookups ----

    [Fact]
    public void A_single_lookup_is_a_positive_int_id()
    {
        var def = Def("M", ReportParameterType.Lookup, d => d with { LookupKind = LookupKind.Matter });

        Only(Bind(def, ("M", "42"))).Value.ShouldBe(42);
        Only(Bind(def, ("M", "\"42\""))).Value.ShouldBe(42);
        Only(Bind(def, ("M", "2147483647"))).Value.ShouldBe(int.MaxValue);
        foreach (var bad in new[] { "0", "-1", "2147483648", "1.5", "\"x\"", "[1]", "true" })
            OnlyError(Bind(def, ("M", bad)), "M", ParameterErrorCodes.InvalidType);
    }

    [Fact]
    public void A_multi_lookup_binds_ids_as_one_int_array()
    {
        var def = Def("M", ReportParameterType.Lookup, d => d with { LookupKind = LookupKind.Pod, LookupMulti = true });

        var p = Only(Bind(def, ("M", "[3,\"4\",3]")));

        p.Value.ShouldBe("[3,4]");
        p.ListKind.ShouldBe(ListKind.Int);
        OnlyError(Bind(def, ("M", "[3,0]")), "M", ParameterErrorCodes.InvalidType);
        OnlyError(Bind(def, ("M", "[\"1 OR 1=1\"]")), "M", ParameterErrorCodes.InvalidType);
    }

    // ---- date range ----

    [Fact]
    public void A_date_range_binds_two_date_parameters_named_from_and_to()
    {
        var def = Def("P", ReportParameterType.DateRange);

        var r = Bind(def, ("P", "{\"from\":\"2026-10-01\",\"to\":\"2026-10-22\"}"));

        r.Errors.ShouldBeEmpty();
        r.Parameters.Select(p => p.Name).ShouldBe(["P_FROM", "P_TO"]);
        r.Parameters.ShouldAllBe(p => p.DbType == SqlDbType.Date);
        ((DateTime)r.Parameters[1].Value!).ShouldBe(new DateTime(2026, 10, 22));
    }

    [Fact]
    public void A_date_range_may_be_one_day_but_not_backwards()
    {
        var def = Def("P", ReportParameterType.DateRange);

        Bind(def, ("P", "{\"from\":\"2026-10-22\",\"to\":\"2026-10-22\"}")).Errors.ShouldBeEmpty();
        OnlyError(Bind(def, ("P", "{\"from\":\"2026-10-23\",\"to\":\"2026-10-22\"}")), "P", ParameterErrorCodes.RangeOrder);
        OnlyError(Bind(def, ("P", "{\"from\":\"nope\",\"to\":\"2026-10-22\"}")), "P", ParameterErrorCodes.InvalidDate);
        OnlyError(Bind(def, ("P", "\"2026-10-22\"")), "P", ParameterErrorCodes.InvalidType);
    }

    [Fact]
    public void An_optional_range_may_be_open_ended_and_a_required_one_may_not()
    {
        var optional = Def("P", ReportParameterType.DateRange);
        var required = optional with { IsRequired = true };

        var open = Bind(optional, ("P", "{\"from\":\"2026-10-01\"}"));
        open.Errors.ShouldBeEmpty();
        open.Parameters[0].IsNull.ShouldBeFalse();
        open.Parameters[1].IsNull.ShouldBeTrue();
        Bind(optional).Parameters.ShouldAllBe(p => p.IsNull);
        OnlyError(Bind(required, ("P", "{\"from\":\"2026-10-01\"}")), "P", ParameterErrorCodes.Required);
        OnlyError(Bind(required), "P", ParameterErrorCodes.Required);
    }

    // ---- required, empty, NULL ----

    [Theory]
    [InlineData(ReportParameterType.Number)]
    [InlineData(ReportParameterType.Date)]
    [InlineData(ReportParameterType.Text)]
    [InlineData(ReportParameterType.YesNo)]
    public void An_optional_scalar_without_a_value_binds_null(ReportParameterType type)
    {
        Only(Bind(Def("X", type))).IsNull.ShouldBeTrue();
        Only(Bind(Def("X", type), ("X", "null"))).IsNull.ShouldBeTrue();
        Only(Bind(Def("X", type), ("X", "\"\""))).IsNull.ShouldBeTrue();
    }

    [Theory]
    [InlineData(ReportParameterType.Number)]
    [InlineData(ReportParameterType.Date)]
    [InlineData(ReportParameterType.Text)]
    [InlineData(ReportParameterType.YesNo)]
    [InlineData(ReportParameterType.Single)]
    [InlineData(ReportParameterType.Lookup)]
    public void A_required_parameter_without_a_value_or_default_is_an_error_naming_it(ReportParameterType type)
    {
        var def = Def("X", type, d => d with { IsRequired = true, Label = "The label" });

        var e = OnlyError(Bind(def), "X", ParameterErrorCodes.Required);
        e.Message.ShouldContain("The label");
        OnlyError(Bind(def, ("X", "null")), "X", ParameterErrorCodes.Required);
    }

    // ---- defaults ----

    [Fact]
    public void A_missing_value_falls_back_to_the_default_and_relative_dates_use_the_firm_today()
    {
        var date = Def("D", ReportParameterType.Date, d => d with { IsRequired = true, Default = J("\"startOfMonth\"") });
        var range = Def("P", ReportParameterType.DateRange, d => d with { IsRequired = true, Default = J("{\"from\":\"startOfMonth\",\"to\":\"today\"}") });
        var pods = Def("PODS", ReportParameterType.Lookup, d => d with { LookupKind = LookupKind.Pod, LookupMulti = true, Default = J("\"myPods\"") });
        var literal = Def("N", ReportParameterType.Number, d => d with { Default = J("7") });

        ((DateTime)Only(Bind(date)).Value!).ShouldBe(new DateTime(2026, 10, 1));
        var r = Bind(range);
        r.Errors.ShouldBeEmpty();
        ((DateTime)r.Parameters[0].Value!).ShouldBe(new DateTime(2026, 10, 1));
        ((DateTime)r.Parameters[1].Value!).ShouldBe(new DateTime(2026, 10, 22));
        Only(Bind(pods)).Value.ShouldBe("[3,5]");
        Only(Bind(literal)).Value.ShouldBe(7m);
        Only(Bind(literal, ("N", "9"))).Value.ShouldBe(9m);
    }

    [Theory]
    [InlineData("thisMonth", "2026-10-01", "2026-10-31")]
    [InlineData("lastMonth", "2026-09-01", "2026-09-30")]
    [InlineData("last30Days", "2026-09-22", "2026-10-22")]
    [InlineData("thisYear", "2026-01-01", "2026-12-31")]
    public void Range_presets_resolve_in_the_firm_time_zone(string preset, string from, string to)
    {
        var def = Def("P", ReportParameterType.DateRange, d => d with { Default = J($"\"{preset}\"") });

        var value = ParameterDefaults.Resolve(def, Ctx)!.Value;

        (value.GetProperty("from").GetString(), value.GetProperty("to").GetString()).ShouldBe((from, to));
    }

    // ---- built-ins and unknown names ----

    [Theory]
    [InlineData("CURRENT_USER_ID")]
    [InlineData("current_user_id")]
    [InlineData("TODAY")]
    [InlineData("NOW_UTC")]
    [InlineData("CURRENT_POD_IDS")]
    public void A_request_that_supplies_a_built_in_name_is_refused(string name)
    {
        var r = Bind(Def("X", ReportParameterType.Text), (name, "1"));

        r.Errors.ShouldContain(e => e.Code == ParameterErrorCodes.BuiltInNotAllowed && e.Name == name.ToUpperInvariant());
    }

    [Fact]
    public void An_unknown_parameter_is_refused_and_its_name_is_echoed_short()
    {
        var r = Bind(Def("X", ReportParameterType.Text), (new string('z', 500), "1"));

        var e = r.Errors.ShouldHaveSingleItem();
        e.Code.ShouldBe(ParameterErrorCodes.UnknownParameter);
        e.Name.Length.ShouldBeLessThanOrEqualTo(64);
    }

    [Fact]
    public void Built_ins_used_by_the_query_are_resolved_on_the_server()
    {
        var used = new HashSet<string>(StringComparer.Ordinal) { "CURRENT_USER_ID", "CURRENT_USER_NAME", "TODAY", "NOW_UTC", "CURRENT_POD_IDS", "CURRENT_PRIMARY_POD_ID", "FIRM_TIME_ZONE_OFFSET_MINUTES" };

        var r = ParameterBinder.Bind([], new Dictionary<string, JsonElement>(), Ctx, used);

        r.Errors.ShouldBeEmpty();
        var by = r.Parameters.ToDictionary(p => p.Name);
        by["CURRENT_USER_ID"].Value.ShouldBe(7);
        by["CURRENT_USER_NAME"].Value.ShouldBe("Ann Example");
        ((DateTime)by["TODAY"].Value!).ShouldBe(new DateTime(2026, 10, 22));
        by["NOW_UTC"].DbType.ShouldBe(SqlDbType.DateTime2);
        by["CURRENT_POD_IDS"].Value.ShouldBe("[3,5]");
        by["CURRENT_POD_IDS"].ListKind.ShouldBe(ListKind.Int);
        by["CURRENT_PRIMARY_POD_ID"].Value.ShouldBe(3);
        by["FIRM_TIME_ZONE_OFFSET_MINUTES"].Value.ShouldBe(-240);
    }

    [Fact]
    public void Without_a_primary_pod_that_built_in_is_null()
    {
        var used = new HashSet<string>(StringComparer.Ordinal) { "CURRENT_PRIMARY_POD_ID" };

        var r = ParameterBinder.Bind([], new Dictionary<string, JsonElement>(), Ctx with { PrimaryPodId = null }, used);

        r.Parameters.ShouldHaveSingleItem().IsNull.ShouldBeTrue();
    }

    [Fact]
    public void A_placeholder_without_a_definition_is_an_error()
    {
        var used = new HashSet<string>(StringComparer.Ordinal) { "MISSING", "X" };

        var r = ParameterBinder.Bind([Def("X", ReportParameterType.Text)], Values(("X", "\"a\"")), Ctx, used);

        r.Errors.ShouldHaveSingleItem().Name.ShouldBe("MISSING");
        r.Errors[0].Code.ShouldBe(ParameterErrorCodes.Undefined);
    }

    [Fact]
    public void Only_the_parameters_the_query_uses_are_bound()
    {
        var defs = new[] { Def("A", ReportParameterType.Text), Def("B", ReportParameterType.Text), Def("P", ReportParameterType.DateRange) };
        var used = new HashSet<string>(StringComparer.Ordinal) { "A", "P_TO" };

        var r = ParameterBinder.Bind(defs, Values(("A", "\"1\""), ("B", "\"2\"")), Ctx, used);

        r.Errors.ShouldBeEmpty();
        r.Parameters.Select(p => p.Name).ShouldBe(["A", "P_TO"]);
    }

    [Fact]
    public void A_bad_value_for_an_unused_parameter_is_still_reported()
    {
        var defs = new[] { Def("A", ReportParameterType.Number) };

        var r = ParameterBinder.Bind(defs, Values(("A", "\"x\"")), Ctx, new HashSet<string>(StringComparer.Ordinal));

        r.Errors.ShouldHaveSingleItem().Name.ShouldBe("A");
    }

    [Fact]
    public void Several_errors_are_all_reported_each_with_its_own_name()
    {
        var defs = new[] { Def("A", ReportParameterType.Number), Def("B", ReportParameterType.Date), Def("C", ReportParameterType.Text) };

        var r = ParameterBinder.Bind(defs, Values(("A", "\"x\""), ("B", "\"x\""), ("C", "\"ok\"")), Ctx, null);

        r.Errors.Select(e => e.Name).ShouldBe(["A", "B"]);
        r.Parameters.Select(p => p.Name).ShouldBe(["C"]);
    }

    // ---- logging ----

    [Fact]
    public void Log_values_truncate_long_text_and_long_lists()
    {
        var text = Only(Bind(Def("Q", ReportParameterType.Text, d => d with { MaxLength = 400 }), ("Q", JsonSerializer.Serialize(new string('x', 300)))));
        var many = Only(Bind(Def("L", ReportParameterType.Lookup, d => d with { LookupKind = LookupKind.Matter, LookupMulti = true }), ("L", "[" + string.Join(",", Enumerable.Range(1, 150)) + "]")));

        text.LogValue.Length.ShouldBeLessThan(215);
        many.LogValue.ShouldContain("...(150)");
        many.LogValue.Length.ShouldBeLessThan(200);
    }

    [Fact]
    public void The_user_name_built_in_is_not_written_to_the_log_value()
    {
        var r = ParameterBinder.Bind([], new Dictionary<string, JsonElement>(), Ctx, new HashSet<string>(StringComparer.Ordinal) { "CURRENT_USER_NAME" });

        r.Parameters.Single().LogValue.ShouldNotContain("Ann");
    }

    [Fact]
    public void Placeholders_of_a_definition_follow_the_range_naming()
    {
        Def("P", ReportParameterType.DateRange).PlaceholderNames.ShouldBe(["P_FROM", "P_TO"]);
        Def("N", ReportParameterType.Number).PlaceholderNames.ShouldBe(["N"]);
        // the scanner's range proposal and the definition agree
        SqlScanner.Scan("SELECT 1 WHERE d >= :P_FROM AND d <= :P_TO").DateRangeCandidates.ShouldBe(["P"]);
    }
}

/// <summary>The 422 mapping and the version snapshot of the definitions (issue #694).</summary>
public class ParameterModelTests
{
    [Fact]
    public void Binder_errors_become_a_validation_error_keyed_by_parameter_name()
    {
        var error = ParameterErrors.ToError([
            new("DATE", ParameterErrorCodes.InvalidDate, "Enter a date as yyyy-MM-dd."),
            new("DATE", ParameterErrorCodes.RangeOrder, "x"),
            new("PODS", ParameterErrorCodes.TooMany, "Choose at most 200 values."),
        ]);

        error.Type.ShouldBe(MatterFlow.SharedKernel.Results.ErrorType.Validation);
        error.Code.ShouldBe("REPORT_PARAMETERS_INVALID");
        error.FieldErrors!.Keys.ShouldBe(["parameters.DATE", "parameters.PODS"]);
        error.FieldErrors["parameters.DATE"].Select(f => f.Code).ShouldBe(["INVALID_DATE", "RANGE_ORDER"]);
    }

    [Fact]
    public void Definitions_round_trip_through_the_version_snapshot()
    {
        var defs = new[]
        {
            new ReportParameterDefinition { Name = "PODS", Type = ReportParameterType.Multi, Label = "Pods", ValueType = ChoiceValueType.Int, OptionsKind = OptionsKind.Fixed, Options = [new("1", "Alpha")], MaxSelected = 50, Default = JsonDocument.Parse("\"myPods\"").RootElement.Clone() },
            new ReportParameterDefinition { Name = "PERIOD", Type = ReportParameterType.DateRange, Label = "Period", IsRequired = true },
            new ReportParameterDefinition { Name = "CLIENT", Type = ReportParameterType.Lookup, LookupKind = LookupKind.Client, Label = "Client" },
        };

        var json = ParameterDefinitionJson.Serialize(defs);
        var back = ParameterDefinitionJson.Deserialize(json);

        json.ShouldContain("\"type\":\"multi\"");
        json.ShouldContain("\"lookupKind\":\"client\"");
        back.Select(d => (d.Name, d.Type, d.IsRequired, d.LookupKind, d.ValueType, d.MaxSelected)).ShouldBe(defs.Select(d => (d.Name, d.Type, d.IsRequired, d.LookupKind, d.ValueType, d.MaxSelected)));
        back[0].Options.ShouldBe(defs[0].Options);
        back[0].Default!.Value.GetString().ShouldBe("myPods");
        ParameterDefinitionJson.Deserialize("[]").ShouldBeEmpty();
    }
}
